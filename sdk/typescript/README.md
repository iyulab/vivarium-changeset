# @vivariumjs/changeset — TypeScript reference SDK

Construct, canonicalize, fingerprint, and validate [Vivarium Changeset](https://github.com/iyulab/vivarium-changeset/blob/main/spec/SPEC.md)
documents. **Contains no apply logic** — appliers (e.g. vivarium-stage) are consumers of
this format, not part of this SDK.

Zero runtime dependencies. The package ships built ES modules (`dist/`, emitted by
`npm run build` / `prepack`); working in this repo runs the TypeScript source
directly and requires Node ≥ 23.6.

## Usage

```ts
import {
  createChangeset, addSchemaOp, addUiPatch, finalize,
  validate, verifyFingerprint,
} from "@vivariumjs/changeset";

// the artifact's current source, and the source the agent proposes
const currentSource = "export function LoanScreen() { /* current */ }";
const nextSource = "export function LoanScreen() { /* renders dueDate */ }";

let draft = createChangeset({
  intent: "Add a due-date to the loan screen",
  producedBy: "my-agent",
  createdAt: new Date().toISOString(),
});

draft = addSchemaOp(draft, {
  op: "field.add",
  entity: "loan",
  field: { name: "dueDate", type: "date" },
  explanation: "Stores the loan's due date",
});

draft = addUiPatch(draft, {
  artifactId: "screen-loans",
  baseContent: currentSource,   // null for creation
  newContent: nextSource,       // review diff + base fingerprint are derived, never hand-written
  explanation: "Renders the due-date field",
});

const doc = finalize(draft);    // validates, stamps fingerprint — or throws with structured errors
```

Verifying on the consuming side. Unlike `finalize`, these APIs **report — they do not
throw**; a conforming applier checks the results and refuses on failure (spec §7):

```ts
const result = validate(doc);   // spec §8 layer 1 — structure, vocabulary, diff consistency
if (!result.valid) {
  throw new Error(`refusing changeset: ${result.errors.map((e) => e.path).join(", ")}`);
}
if (!verifyFingerprint(doc)) {  // spec §6 — content-addressed integrity
  throw new Error("refusing changeset: fingerprint mismatch");
}
```

### `verified-diff@0` UI patches (spec 0.2)

Surgical edits ride as a strict-dialect unified diff instead of a full artifact
re-emission. `validate` covers the document-only layer; before applying, an applier
MUST run the base-supplied layer (spec §8 layer 2):

```ts
import { createVerifiedDiff, verifyAgainstBase, artifactFingerprint } from "@vivariumjs/changeset";

const base = "const title = \"Loans\";\n";
const next = "const title = \"Active loans\";\n";
const patch = {
  profile: "verified-diff@0" as const,
  artifactId: "screen-loans",
  baseFingerprint: artifactFingerprint(base),
  diff: createVerifiedDiff(base, next), // deterministic, fail-closed dialect (spec §5.2.2)
  newFingerprint: artifactFingerprint(next),
  explanation: "Rename the title only",
};

const verdict = verifyAgainstBase(patch, base); // ① base fingerprint ② apply + result fingerprint
if (!verdict.ok) throw new Error("refusing patch: " + verdict.errors[0].message);
verdict.newContent; // exactly what the reviewer's diff described
```

## Surface

| Module | Exports |
| --- | --- |
| canonicalize | `canonicalize`, `canonicalBytes` — RFC 8785 (JCS) |
| fingerprint | `fingerprintOf`, `stampFingerprint`, `verifyFingerprint`, `FINGERPRINT_PREFIX` |
| diff | `createUnifiedDiff`, `applyUnifiedDiff`, `reverseApplyUnifiedDiff` |
| verified-diff | `createVerifiedDiff`, `applyVerifiedDiff`, `parseVerifiedDiff`, `verifyAgainstBase` — spec §5.2.2 dialect |
| validate | `validate`, `SUPPORTED_SPEC_VERSIONS`, `BASE_STATE_KINDS` |
| builder | `createChangeset`, `addSchemaOp`, `addUiPatch`, `addDataPatch`, `finalize`, `artifactFingerprint` |

## Conformance

`npm test` runs the unit suite plus the shared [`spec/fixtures/`](https://github.com/iyulab/vivarium-changeset/tree/main/spec/fixtures)
corpus. Independent implementations should reproduce those fixtures exactly;
`npm run generate-fixtures` regenerates them from this reference implementation.
