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
write("fingerprint.json", [
  { name: "minimal-schema-change", document: minimal, fingerprint: fingerprintOf(minimal) },
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

console.log("fixtures written to", outDir);
