# Vivarium Changeset Specification

**Version: 0.1.0-draft** · Status: working draft — normative once tagged 0.1.0.

The key words MUST, MUST NOT, SHOULD, MAY are to be interpreted as in RFC 2119.

## 1. Scope

A **changeset** describes one atomic intent of application change — schema, UI, and data
facets that are only correct together — as a single reviewable, fingerprinted JSON
document. This spec defines the document model, the fingerprint, and the approval-gate
semantics. It does NOT define how changes are applied (consumer concern, e.g.
vivarium-stage) or how they are authored (producer concern, e.g. vivarium-agent).

## 2. Encoding

A changeset document is a single JSON text, UTF-8, constrained to I-JSON (RFC 7493).
JSON is the only encoding — it is the only widely-deployed format with a standardized
canonical form (RFC 8785), which the fingerprint (§6) depends on. Members not defined by this spec
MUST be rejected by validators (closed model in v0 — forward compatibility is handled by
`specVersion`, not by ignoring unknowns a reviewer never saw).

## 3. Document model

```json
{
  "specVersion": "0.1.0-draft",
  "id": "optional-producer-assigned-string",
  "intent": "Add a due-date to the loan screen",
  "provenance": { ... },        // §4
  "patches": {
    "schema": [ ... ],          // §5.1, MAY be empty
    "ui":     [ ... ],          // §5.2, MAY be empty
    "data":   [ ... ]           // §5.3, MAY be empty
  },
  "fingerprint": "sha256:...",  // §6 — excluded from its own hash
  "approvals": [ ... ]          // §7 — excluded from the hash
}
```

- `intent` (REQUIRED): one human-readable sentence of what this changeset accomplishes.
- At least one facet array MUST be non-empty.
- There is no mechanism to apply a subset of `patches` — the document is the atomic unit
  (fixed principle 3).

## 4. Provenance

```json
{
  "producedBy": "opaque producer identifier (agent, tool, or human)",
  "createdAt": "RFC 3339 timestamp",
  "baseState": [
    { "kind": "schema",      "ref": "default",   "fingerprint": "sha256:..." },
    { "kind": "ui-artifact", "ref": "artifact-7", "fingerprint": "sha256:..." }
  ],
  "editContext": { }
}
```

- `baseState` (REQUIRED, MAY be empty only for greenfield creation): the world this
  changeset was authored against. A consumer that detects drift from `baseState` MUST
  refuse to apply (drift refuses, never guesses).
- How a `schema` base fingerprint is computed from a live backend is adapter-defined but
  MUST be deterministic for a given state. *(Open item O-1: a recommended canonical
  schema-snapshot form may be specified in a later minor.)*
- `ui-artifact` fingerprints are `sha256:` + hex SHA-256 over the artifact's raw UTF-8
  content bytes (no JCS — artifact content is not JSON).
- `editContext` (OPTIONAL): the serialized selection/screen context the change was made
  from, opaque to this spec (its shape is the renderer's published contract).

## 5. Facets

Every patch object in every facet carries a REQUIRED `explanation` string — what this
individual change does and why (fixed principle 4).

### 5.1 Schema patches — logical operations

Backend-neutral logical operations; mapping onto a concrete backend is an adapter
concern, outside this spec. There is **no raw/native passthrough** — a change
inexpressible in this vocabulary is grounds to extend the vocabulary (spec minor bump),
never to bypass review. The v0 vocabulary:

| `op` | Required members |
| --- | --- |
| `entity.create` | `entity`, `fields[]` (each: `name`, `type`, `required?`, `default?`) |
| `entity.rename` | `entity`, `newName` |
| `entity.remove` | `entity` |
| `field.add` | `entity`, `field` (`name`, `type`, `required?`, `default?`) |
| `field.rename` | `entity`, `field`, `newName` |
| `field.retype` | `entity`, `field`, `newType` |
| `field.remove` | `entity`, `field` |
| `constraint.add` | `entity`, `constraint` (`kind`: `unique` \| `required`, `fields[]`) |
| `constraint.remove` | `entity`, `constraint` (same shape) |

Logical field types (v0): `string`, `number`, `boolean`, `date`, `datetime`,
`reference` (with `target` entity), `json`. Adapters map these to backend types and MUST
refuse operations or types they cannot represent.

### 5.2 UI patches — v0 whole-artifact profile

Invariant: every UI patch MUST be review-representable — a reviewer must be able to see
*what changes*, not just that something changed. Additional profiles (e.g. fine-grained
structural edits) may be added in later minors; all must satisfy the invariant.

```json
{
  "profile": "whole-artifact@0",
  "artifactId": "screen-loans",
  "baseFingerprint": "sha256:... | null (creation)",
  "newContent": "…full artifact source…",
  "reviewDiff": "…unified diff, base → newContent…",
  "explanation": "Adds the due-date field below the amount input"
}
```

**Diff verification (self-contained — no artifact store required):** validators MUST
reverse-apply `reviewDiff` to `newContent`, recovering the base content, and verify that
the recovered base's artifact fingerprint equals `baseFingerprint` (creation: the
recovered base MUST be empty and `baseFingerprint` MUST be `null`). An inconsistent diff
is a validation failure — a diff the reviewer read that doesn't match what will land is
precisely what the fingerprint gate exists to stop.

### 5.3 Data patches

Run-once, reviewable data operations. v0 keeps expressions out — literal values only:

```json
{
  "id": "backfill-due-dates",
  "explanation": "Seed default due dates for existing loans",
  "operations": [
    { "op": "insert", "entity": "…", "values": { } },
    { "op": "update", "entity": "…", "where": { "field": "…", "equals": … }, "set": { } },
    { "op": "delete", "entity": "…", "where": { "field": "…", "equals": … } }
  ]
}
```

`id` is unique within the document; consumers use it for run-once bookkeeping.
*(Open item O-2: transformation expressions are deferred until demand proves out.)*

## 6. Fingerprint

1. Take the document with the `fingerprint` and `approvals` members removed.
2. Canonicalize per RFC 8785 (JCS); encode UTF-8.
3. `fingerprint = "sha256:" + lowercase-hex(SHA-256(bytes))`.

Implementations MUST reject unknown fingerprint prefixes.

## 7. Approvals and the gate

`approvals` is an array of ApprovalRecords (`fingerprint`, `approvedBy`, `approvedAt`,
`comment?`, `attestation?` — the last a reserved extension slot, absent in v0). Approval
records live outside the fingerprint envelope so that an approval can reference the
fingerprint without changing it.

**Gate**: a conforming applier MUST recompute the fingerprint (§6), MUST verify it equals
the `fingerprint` of an approval record it trusts, and MUST refuse otherwise. There is no
"apply latest". Trust policy and approval storage are implementation-defined.

## 8. Validation summary

A document is valid iff: well-formed I-JSON; no unknown members; `specVersion` supported;
`intent` present; ≥1 non-empty facet; every patch has `explanation`; schema ops and types
are from the v0 vocabulary; UI patches satisfy the diff-consistency check; data patch
`id`s unique; `fingerprint`, if present, matches recomputation.

## 9. Spec versioning

`specVersion` follows semver, pre-1.0: additions = minor, anything breaking requires a
spec ADR and a minor bump with explicit migration notes. Implementations MUST reject
documents whose major.minor they do not support. This spec never implies a 1.0 timeline.

## Open items

- **O-1** Canonical schema-snapshot form for `baseState` schema fingerprints (§4).
- **O-2** Data transformation expressions (§5.3).
- **O-3** Conformance fixtures directory (`fixtures/`) — required cases enumerated in
  ADR-0002/0003/0004; to be populated alongside the reference SDKs.
