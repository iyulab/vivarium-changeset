# Vivarium Changeset Specification

**Version: 0.2.0** · Status: normative — shipped in both reference SDKs
(`ts-v0.2.0` / `dotnet-v0.2.0`, 2026-07-19). The spec carries no separate
0.2.0 tag: release tags now name their artifact, because one shared tag
coupled the two registries. Differences from 0.1.0 (tagged 2026-07-16) are
listed in [Changes from 0.1.0](#changes-from-010).

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
  "specVersion": "0.1.0",
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
- Each `baseState` entry MUST be an object with exactly the members `kind`, `ref`,
  `fingerprint`: `kind` one of the closed vocabulary below, `ref` a non-empty string,
  `fingerprint` a `sha256:`-prefixed string. A malformed entry is a **validation
  failure** — validators MUST reject it (never crash on it), and MUST reject unknown
  `kind` values (closed model; vocabulary additions are a spec minor).
- `kind` vocabulary (0.2): `schema` — a live backend schema state · `ui-artifact` — a
  UI artifact's content · `changeset` — **authoring lineage**: the changeset document
  this one was derived or rebased from.
- **Lineage drift exemption**: `kind: "changeset"` entries record authoring lineage,
  not live state. The drift-refusal requirement above does NOT apply to them — a
  consumer MUST NOT refuse solely because a lineage changeset is absent from, or
  unknown to, the live system.
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

### 5.2 UI patches — profiles

Invariant: every UI patch MUST be review-representable — a reviewer must be able to see
*what changes*, not just that something changed. All profiles must satisfy the
invariant. The profile is chosen per patch; 0.2 defines two:

| Profile | Natural use | Self-contained validation |
| --- | --- | --- |
| `whole-artifact@0` | creation, large rewrites | **yes** — no artifact store required |
| `verified-diff@0` | surgical modification of an existing base | structural only — **complete** validation requires the base content (§8) |

The self-containedness relaxation for `verified-diff@0` is deliberate: the applier
holds the live base by definition, the producer holds `baseState`, and the drift gate
requires base agreement anyway. Profile *choice* is a producer concern outside this
spec (guidance: local edits → `verified-diff@0`; creation and wholesale rework — or a
producer that cannot emit a reliable diff — → `whole-artifact@0`).

#### 5.2.1 `whole-artifact@0`

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

#### 5.2.2 `verified-diff@0`

```json
{
  "profile": "verified-diff@0",
  "artifactId": "screen-loans",
  "baseFingerprint": "sha256:…",
  "diff": "…unified diff (dialect below), base → new…",
  "newFingerprint": "sha256:…",
  "explanation": "Rename the table title only"
}
```

- `baseFingerprint` MUST be a `sha256:` string — **never `null`**. Creation is
  `whole-artifact@0`'s job; a diff expresses a transformation of an existing base.
- `newFingerprint` (REQUIRED): the artifact fingerprint (§4) of the content produced by
  applying `diff` to the base.
- **No-op prohibition**: `diff` MUST contain at least one hunk AND `newFingerprint`
  MUST NOT equal `baseFingerprint`. A patch that changes nothing is a validation
  failure — "nothing" is not a reviewable change.
- Application is **deterministic and fail-closed**: any malformed hunk, context
  mismatch, or out-of-order hunk is an application failure. There is no fuzzing, no
  offset search, no partial application — either the whole diff applies exactly, or
  the patch is rejected.

##### Diff dialect (normative)

`diff` MUST conform to the following restricted unified-diff dialect. Both directions
are pinned — producers MUST emit it and appliers MUST reject anything outside it:

- The diff is a sequence of hunks only — no `---`/`+++` file headers, no index lines,
  no trailing garbage. Every line is a hunk header, a hunk body line, or the
  no-newline marker.
- Hunk header: `@@ -aStart,aCount +bStart,bCount @@` — counts are always explicit
  (`,1` is never omitted), nothing follows the closing `@@`.
- Hunk body lines begin with exactly one of ` ` (context), `-` (deletion), `+`
  (addition); the remainder of the line is content.
- **Line model**: content is split into lines at each LF (U+000A); the LF terminates a
  line and is not part of its content. CR (U+000D) is ordinary content — a
  CRLF-terminated line's content ends with a CR byte. Application is byte-faithful:
  no newline normalization of any kind (mixed CRLF/LF content must round-trip, or the
  fingerprint equations cannot hold). Empty content has zero lines.
- **Trailing newline**: if content does not end with LF, its final line is
  *incomplete*: a diff body line representing an incomplete final line MUST be
  immediately followed by the marker line `\ No newline at end of file`. Appliers MUST
  honor the marker (a `+` line followed by the marker yields content without a
  trailing LF); a body line without the marker is LF-terminated.
- Line numbers are 1-based and MUST be **exact** against the base — `baseFingerprint`
  pins the base, so line numbers are trustworthy and context re-search does not
  exist. For a pure-insertion hunk (`aCount` = 0), `aStart` is the base line *after
  which* insertion occurs (0 = insert before the first line); pure-deletion hunks
  (`bCount` = 0) mirror this on the new side.
- Hunks MUST be ordered by ascending base position and MUST NOT overlap.
- Every context and deletion line MUST equal the base line at its stated position,
  byte for byte. Any mismatch is an application failure.

Conformance corpus (`fixtures/`) — required cases for this dialect: clean apply ·
context mismatch · base-fingerprint mismatch · creation rejected (`baseFingerprint`
null) · no-op rejected · mixed CRLF/LF · no newline at end of file.

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

## 8. Validation — two layers

Validation is layered by what it needs. Implementations MUST keep the layers distinct
(a document-only validation and a base-supplied verification are different operations
with different answers), and MUST NOT report a `verified-diff@0` patch as fully
verified on structural checks alone.

**Layer 1 — structural validity (document alone).** A document is structurally valid
iff: well-formed I-JSON; no unknown members; `specVersion` supported; `intent` present;
≥1 non-empty facet; every patch has `explanation`; `baseState` entries are structurally
well-formed with known `kind` (§4); schema ops and types are from the v0 vocabulary;
`whole-artifact@0` patches satisfy the self-contained diff-consistency check (§5.2.1);
`verified-diff@0` patches have a non-null `baseFingerprint`, a `diff` that parses under
the dialect (§5.2.2) with ≥1 hunk, and `newFingerprint ≠ baseFingerprint`; data patch
`id`s unique; `fingerprint`, if present, matches recomputation.

**Layer 2 — complete verification (base supplied).** For each `verified-diff@0` patch,
given the base artifact content: ① the base content's artifact fingerprint MUST equal
`baseFingerprint`; ② deterministic application of `diff` MUST succeed and the result's
artifact fingerprint MUST equal `newFingerprint`. An applier MUST perform layer 2
before applying. (`whole-artifact@0` needs no layer 2 — its diff check is
self-contained in layer 1.)

The reviewability invariant holds through the layers: for `verified-diff@0` the `diff`
itself is the review surface, and the two fingerprint equations guarantee that what the
reviewer read is exactly what lands.

## 9. Spec versioning

`specVersion` follows semver, pre-1.0: additions = minor, anything breaking requires a
spec ADR and a minor bump with explicit migration notes. Implementations MUST reject
documents whose major.minor they do not support. This spec never implies a 1.0 timeline.

Because unsupported versions are rejected, the stamp itself forces consumer upgrades —
so producers SHOULD stamp the **lowest** `specVersion` whose features the document
actually uses (a document using no 0.2 feature SHOULD carry `0.1.0`). This decouples
ecosystem-wide upgrades from profile adoption.

## Changes from 0.1.0

- **Added — `verified-diff@0` UI patch profile (§5.2.2)**: additive. Documents that do
  not use it are unaffected; `whole-artifact@0` is unchanged and remains the creation
  path.
- **Tightened — `baseState` structural validation and closed `kind` vocabulary (§4)**:
  entries are now structurally validated and `kind` is closed to
  `schema | ui-artifact | changeset`. Migration: documents with malformed entries or
  other `kind` values — which lenient 0.1 validators may have passed — are invalid
  under 0.2. Such entries were outside the documented 0.1 model; producers emitting
  them must move the information to `editContext` (opaque) or propose a vocabulary
  addition.
- **Codified — lineage drift exemption (§4)**: `kind:"changeset"` entries are exempt
  from drift refusal. This matches existing consumer behavior; no document changes.
- **Restated — validation as two layers (§8)**: layer 1 equals the 0.1 "valid iff"
  list (plus the additions above); layer 2 is new surface for `verified-diff@0` only.
- **Producer guidance — specVersion minimality (§9, SHOULD)**.

## Open items

- **O-1** Canonical schema-snapshot form for `baseState` schema fingerprints (§4).
- **O-2** Data transformation expressions (§5.3).
- **O-3** ~~Conformance fixtures directory (`fixtures/`)~~ — resolved: populated since
  the 0.1 reference SDKs; 0.2 adds the `verified-diff@0` dialect corpus.
