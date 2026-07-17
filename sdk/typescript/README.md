# @vivarium/changeset — TypeScript reference SDK

Construct, canonicalize, fingerprint, and validate [Vivarium Changeset](../../spec/SPEC.md)
documents. **Contains no apply logic** — appliers (e.g. vivarium-stage) are consumers of
this format, not part of this SDK.

Zero runtime dependencies. Requires Node ≥ 23.6 (native TypeScript execution).

## Usage

```ts
import {
  createChangeset, addSchemaOp, addUiPatch, finalize,
  validate, verifyFingerprint,
} from "@vivarium/changeset";

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
const result = validate(doc);   // spec §8 — structure, vocabulary, diff consistency
if (!result.valid) {
  throw new Error(`refusing changeset: ${result.errors.map((e) => e.path).join(", ")}`);
}
if (!verifyFingerprint(doc)) {  // spec §6 — content-addressed integrity
  throw new Error("refusing changeset: fingerprint mismatch");
}
```

## Surface

| Module | Exports |
| --- | --- |
| canonicalize | `canonicalize`, `canonicalBytes` — RFC 8785 (JCS) |
| fingerprint | `fingerprintOf`, `stampFingerprint`, `verifyFingerprint`, `FINGERPRINT_PREFIX` |
| diff | `createUnifiedDiff`, `applyUnifiedDiff`, `reverseApplyUnifiedDiff` |
| validate | `validate`, `SUPPORTED_SPEC_VERSIONS` |
| builder | `createChangeset`, `addSchemaOp`, `addUiPatch`, `addDataPatch`, `finalize`, `artifactFingerprint` |

## Conformance

`npm test` runs the unit suite plus the shared [`spec/fixtures/`](../../spec/fixtures/)
corpus. Independent implementations should reproduce those fixtures exactly;
`npm run generate-fixtures` regenerates them from this reference implementation.
