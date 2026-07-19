/**
 * Generates the conformance fixture corpus in spec/fixtures/ from the
 * reference implementation. Independent implementations (e.g. the .NET SDK)
 * must reproduce these byte-for-byte / hash-for-hash.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { canonicalize } from "../src/canonicalize.ts";
import { createUnifiedDiff } from "../src/diff.ts";
import { createVerifiedDiff } from "../src/verified-diff.ts";
import { fingerprintOf, stampFingerprint } from "../src/fingerprint.ts";

const outDir = fileURLToPath(new URL("../../../spec/fixtures/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const write = (name: string, value: unknown) =>
  writeFileSync(outDir + name, JSON.stringify(value, null, 2) + "\n", "utf8");

// --- canonicalization vectors (JCS edge cases: numbers, sorting, unicode) ---
const canonInputs: Record<string, unknown> = {
  "numbers": { a: 4.5, b: 1e30, c: 2e-3, d: 10.0, e: 0 },
  "key-sort-ascii": { b: 1, a: 2, "0": 3, "A": 4 },
  "key-sort-non-ascii": { "é": 1, z: 2, "à": 3 },
  "nested": { outer: { b: [true, null, "x"], a: { deep: [] } } },
  "string-escapes": { s: "line\nbreak \"quoted\" \\ € " },
};
write(
  "canonicalization.json",
  Object.entries(canonInputs).map(([name, input]) => ({
    name,
    input,
    canonical: canonicalize(input),
  }))
);

// --- fingerprint vectors ---
const minimal = {
  specVersion: "0.1.0",
  intent: "Add a due-date to the loan screen",
  provenance: {
    producedBy: "fixture-generator",
    createdAt: "2026-07-16T00:00:00Z",
    baseState: [{ kind: "schema", ref: "default", fingerprint: "sha256:" + "ab".repeat(32) }],
  },
  patches: {
    schema: [
      {
        op: "field.add",
        entity: "loan",
        field: { name: "dueDate", type: "date", required: false },
        explanation: "Stores the loan's due date",
      },
    ],
    ui: [],
    data: [],
  },
};
// cross-SDK interop vector: JCS number/string edges that differ most across
// language runtimes — independent SDKs must reproduce this hash exactly
const interopEdges = {
  specVersion: "0.1.0",
  intent:
    "cross-SDK interop vector: exercises JCS number and string edges — 1e+21, 1e-7, 0.30000000000000004, unicode keys, control chars",
  provenance: {
    producedBy: "interop-vector-generator",
    createdAt: "2026-07-16T12:00:00Z",
    baseState: [],
    editContext: {
      "é-key": 1e21,
      "à-key": 1e-7,
      "z-key": 0.1 + 0.2,
      text: 'line\nbreak\ttab "quote" \\ € bell emoji \u{1F600}',
      big: 9007199254740992,
      tiny: 5e-324,
      negative: -4.5,
      zero: 0,
    },
  },
  patches: {
    schema: [],
    ui: [],
    data: [
      {
        id: "noop",
        explanation: "interop vector payload",
        operations: [{ op: "insert", entity: "x", values: { n: 1e30 } }],
      },
    ],
  },
};
write("fingerprint.json", [
  { name: "minimal-schema-change", document: minimal, fingerprint: fingerprintOf(minimal) },
  { name: "interop-jcs-edges", document: interopEdges, fingerprint: fingerprintOf(interopEdges) },
]);

// --- gate cases ---
const stamped = stampFingerprint(minimal);
write("gate-approved-valid.json", {
  name: "approved-valid",
  expect: "apply-eligible",
  document: {
    ...stamped,
    approvals: [
      { fingerprint: stamped.fingerprint, approvedBy: "reviewer-1", approvedAt: "2026-07-16T01:00:00Z" },
    ],
  },
});
write("gate-tampered-content.json", {
  name: "tampered-content",
  expect: "must-refuse",
  note: "content edited after approval; embedded+approved fingerprint no longer matches recomputation",
  document: {
    ...stamped,
    intent: "Add a due-date to the loan screen (and quietly drop the audit table)",
    approvals: [
      { fingerprint: stamped.fingerprint, approvedBy: "reviewer-1", approvedAt: "2026-07-16T01:00:00Z" },
    ],
  },
});

// --- validation cases (full document incl. UI + data facets) ---
const baseContent = "export function LoanScreen() {\n  return <Form fields={[amount]} />;\n}";
const newContent = "export function LoanScreen() {\n  return <Form fields={[amount, dueDate]} />;\n}";
const artifactSha = (s: string) => "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");
const fullDoc = {
  specVersion: "0.1.0",
  intent: "Add a due-date to the loan screen",
  provenance: {
    producedBy: "fixture-generator",
    createdAt: "2026-07-16T00:00:00Z",
    baseState: [{ kind: "ui-artifact", ref: "screen-loans", fingerprint: artifactSha(baseContent) }],
  },
  patches: {
    schema: [
      {
        op: "field.add",
        entity: "loan",
        field: { name: "dueDate", type: "date", required: false },
        explanation: "Stores the loan's due date",
      },
    ],
    ui: [
      {
        profile: "whole-artifact@0",
        artifactId: "screen-loans",
        baseFingerprint: artifactSha(baseContent),
        newContent,
        reviewDiff: createUnifiedDiff(baseContent, newContent),
        explanation: "Renders the due-date field on the loan form",
      },
    ],
    data: [
      {
        id: "backfill-due-dates",
        explanation: "Seed a default due date for existing loans",
        operations: [{ op: "update", entity: "loan", where: { field: "dueDate", equals: null }, set: { dueDate: "2026-08-01" } }],
      },
    ],
  },
};
const inconsistentDiff = structuredClone(fullDoc);
inconsistentDiff.patches.ui[0].baseFingerprint = artifactSha("a different base the reviewer never saw");
const unknownMember = { ...structuredClone(fullDoc), vendorExtra: true } as Record<string, unknown>;

write("validation.json", [
  { name: "full-document-valid", expect: "valid", document: stampFingerprint(fullDoc) },
  { name: "inconsistent-review-diff", expect: "invalid", document: inconsistentDiff },
  { name: "unknown-top-level-member", expect: "invalid", document: unknownMember },
]);

// --- spec 0.2: verified-diff@0 dialect corpus (§5.2.2 required cases) ---
// Cases with layer "structural" embed the patch in a minimal 0.2 document and
// assert validate(); layer "complete" cases additionally supply a base and
// assert verifyAgainstBase / application (expected result in `applied`).
const vdPatch = (base: string, next: string, artifactId = "screen-loans") => ({
  profile: "verified-diff@0",
  artifactId,
  baseFingerprint: artifactSha(base),
  diff: createVerifiedDiff(base, next),
  newFingerprint: artifactSha(next),
  explanation: "fixture: transform base into next",
});
const vdDoc = (patch: Record<string, unknown>) => ({
  specVersion: "0.2.0",
  intent: "verified-diff fixture document",
  provenance: {
    producedBy: "fixture-generator",
    createdAt: "2026-07-19T00:00:00Z",
    baseState: [{
      kind: "ui-artifact",
      ref: patch.artifactId,
      // creation-rejected carries a null baseFingerprint — keep the baseState
      // entry itself well-formed so that case isolates the §5.2.2 failure
      fingerprint: typeof patch.baseFingerprint === "string" ? patch.baseFingerprint : "sha256:" + "ab".repeat(32),
    }],
  },
  patches: { schema: [], ui: [patch], data: [] },
});

const cleanBase = "const title = \"Loans\";\nexport function LoanScreen() {\n  return <Table title={title} />;\n}\n";
const cleanNext = "const title = \"Active loans\";\nexport function LoanScreen() {\n  return <Table title={title} />;\n}\n";
const crlfBase = "alpha\r\nbeta\ngamma\r\ndelta\n";
const crlfNext = "alpha\r\nbeta(2)\ngamma\r\ndelta\n";
const noEofBase = "line1\nline2";
const noEofNext = "line1\nline2 changed";
const multiBase = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
const multiNext = multiBase.replace("line 3", "line 3 (edited)").replace("line 27", "line 27 (edited)");

const contextMismatch = vdPatch(cleanBase, cleanNext);
contextMismatch.diff = contextMismatch.diff.replace(" export function", " export functiom");

const fpMismatchPatch = vdPatch(cleanBase, cleanNext);
const creationPatch = { ...vdPatch(cleanBase, cleanNext), baseFingerprint: null };
const noopPatch = { ...vdPatch(cleanBase, cleanNext), newFingerprint: artifactSha(cleanBase) };

write("verified-diff.json", [
  { name: "clean-apply", layer: "complete", expect: "applies",
    base: cleanBase, applied: cleanNext, patch: vdPatch(cleanBase, cleanNext) },
  { name: "context-mismatch", layer: "complete", expect: "rejected-against-base",
    note: "structurally valid; layer 2 ② fails — a context byte differs from the fingerprinted base",
    base: cleanBase, patch: contextMismatch },
  { name: "base-fingerprint-mismatch", layer: "complete", expect: "rejected-against-base",
    note: "structurally valid; layer 2 ① fails — supplied base drifted from baseFingerprint",
    base: cleanBase + "// drifted\n", patch: fpMismatchPatch },
  { name: "creation-rejected", layer: "structural", expect: "invalid",
    note: "baseFingerprint null — creation is whole-artifact@0's job",
    patch: creationPatch },
  { name: "noop-rejected", layer: "structural", expect: "invalid",
    note: "newFingerprint equals baseFingerprint",
    patch: noopPatch },
  { name: "crlf-mixed", layer: "complete", expect: "applies",
    base: crlfBase, applied: crlfNext, patch: vdPatch(crlfBase, crlfNext, "crlf-artifact") },
  { name: "eof-no-newline", layer: "complete", expect: "applies",
    base: noEofBase, applied: noEofNext, patch: vdPatch(noEofBase, noEofNext, "noeof-artifact") },
  // dialect-edge hardening beyond the 7 required cases (additive):
  { name: "multi-hunk-apply", layer: "complete", expect: "applies",
    base: multiBase, applied: multiNext, patch: vdPatch(multiBase, multiNext, "multi-artifact") },
  { name: "insert-at-start", layer: "complete", expect: "applies",
    note: "pure-insertion hunk before line 1 — header uses aStart 0, aCount 0",
    base: "a\nb\n", applied: "top\na\nb\n", patch: vdPatch("a\nb\n", "top\na\nb\n", "insert-artifact") },
  { name: "eof-state-change-only", layer: "complete", expect: "applies",
    note: "content bytes identical except the trailing newline — still a real, reviewable change",
    base: "a\nb", applied: "a\nb\n", patch: vdPatch("a\nb", "a\nb\n", "eofstate-artifact") },
  { name: "delete-to-empty", layer: "complete", expect: "applies",
    base: "only\n", applied: "", patch: vdPatch("only\n", "", "empty-artifact") },
].map((c) => ({ ...c, document: vdDoc(c.patch as Record<string, unknown>) })));

// --- spec 0.2: baseState tightening cases (§4) ---
const withBaseState = (baseState: unknown) => ({
  specVersion: "0.2.0",
  intent: "baseState tightening fixture",
  provenance: { producedBy: "fixture-generator", createdAt: "2026-07-19T00:00:00Z", baseState },
  patches: {
    schema: [{ op: "entity.remove", entity: "obsolete", explanation: "fixture payload" }],
    ui: [],
    data: [],
  },
});
write("base-state.json", [
  { name: "lineage-changeset-kind-valid", expect: "valid",
    document: withBaseState([{ kind: "changeset", ref: "cs-41", fingerprint: "sha256:" + "cd".repeat(32) }]) },
  { name: "unknown-kind-invalid", expect: "invalid",
    document: withBaseState([{ kind: "tenant", ref: "t-1", fingerprint: "sha256:" + "cd".repeat(32) }]) },
  { name: "malformed-entry-missing-fingerprint-invalid", expect: "invalid",
    document: withBaseState([{ kind: "schema", ref: "default" }]) },
  { name: "non-object-entry-invalid", expect: "invalid",
    document: withBaseState(["schema@default"]) },
]);

console.log("fixtures written to", outDir);
