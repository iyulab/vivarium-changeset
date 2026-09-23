# Vivarium Changeset Specification

**Version: 0.4.0** · Status: normative. The spec carries no separate version
tag: release tags name their artifact (`ts-v*` / `dotnet-v*`), because one
shared tag coupled the two registries. Differences from the preceding minors
are listed in [Changes from 0.3.0](#changes-from-030),
[Changes from 0.2.0](#changes-from-020) and [Changes from 0.1.0](#changes-from-010).

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

- `createdAt` (REQUIRED): when the document was produced, as an RFC 3339 `date-time`
  (RFC 3339 §5.6, with the §5.7 restrictions — a real calendar day, hours `00`–`23`).
  `T` and `Z` are case-insensitive; the offset is REQUIRED (`Z` or `±HH:MM` — a local
  time without one is not a point in time); a space in place of `T` is not admitted.
  Validators MUST reject a value outside that grammar.
- `baseState` (REQUIRED, MAY be empty only for greenfield creation): the world this
  changeset was authored against. A consumer that detects drift from `baseState` MUST
  refuse to apply (drift refuses, never guesses).
- Each `baseState` entry MUST be an object with exactly the members `kind`, `ref`,
  `fingerprint`: `kind` one of the closed vocabulary below, `ref` a non-empty string,
  `fingerprint` a `sha256:`-prefixed string. A malformed entry is a **validation
  failure** — validators MUST reject it (never crash on it), and MUST reject unknown
  `kind` values (closed model; vocabulary additions are a spec minor).
- `kind` vocabulary: `schema` — a live backend schema state · `ui-artifact` — a
  UI artifact's content · `changeset` — **authoring lineage**: the changeset document
  this one was derived or rebased from · `data` (0.3) — a live backend **data** state,
  exactly symmetric with `schema`.
- **`data` requires `specVersion` 0.3.0 or later.** A document that declares an earlier
  version and carries a `data` entry MUST be rejected — the same rule the
  `verified-diff@0` profile follows (§5.2.2), and the mechanism that makes the
  producer guidance in §9 enforceable rather than advisory.
- A changeset whose `patches.data` is non-empty SHOULD declare the data base it was
  authored against. A drift-detecting consumer can only check what the document
  declares; an undeclared facet is an unchecked facet, not a safe one.
- **Lineage drift exemption**: `kind: "changeset"` entries record authoring lineage,
  not live state. The drift-refusal requirement above does NOT apply to them — a
  consumer MUST NOT refuse solely because a lineage changeset is absent from, or
  unknown to, the live system.
- How a `schema` or `data` base fingerprint is computed from a live backend, and what
  `ref` names, are adapter-defined but MUST be deterministic for a given state. For
  `data` the unit is the **data facet as a whole** in 0.3 — the granularity an adapter
  already publishes. *(Open item O-1: a recommended canonical schema-snapshot form.
  Open item O-4: finer data granularity — per-entity or per-row.)*
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

`id` is unique within the document; consumers use it for run-once bookkeeping. The
`explanation` is carried once per patch, not per operation — a data patch is one
reviewable unit of work.

**The example above is illustrative; the rules below are normative.** Each operation
object MUST carry exactly the members its `op` defines — no more (closed model, §2) and
no fewer:

| `op` | REQUIRED members |
| --- | --- |
| `insert` | `op`, `entity`, `values` |
| `update` | `op`, `entity`, `where`, `set` |
| `delete` | `op`, `entity`, `where` |

- `entity` MUST be a non-empty string naming the entity the operation targets. Resolving
  it against a live backend is an adapter concern.
- `values` and `set` MUST be JSON objects. Their members are field names; their values
  are the literals to write. This spec does not constrain those literals — the schema
  facet and the backend do.
- `where` MUST be an object with exactly the members `field` and `equals`: `field` a
  non-empty string, `equals` a JSON **literal** — string, number, boolean, or null. It
  selects the rows whose `field` equals that literal, and nothing else. Arrays, objects,
  operators, and multi-clause predicates are outside 0.x (see O-2).

A validator MUST reject an operation that violates any of the above. Data is the facet
where a malformed patch is hardest to see and most expensive to land: it passes review
as prose, seals into the fingerprint, and fails inside a backend write path. The
strictness here is deliberately the same as the schema facet's (§5.1) — one document
MUST NOT hold two standards of rigor.

*(Open item O-2: transformation expressions and richer predicates are deferred until
demand proves out.)*

### 5.4 Applying one document — order, and what a removal takes with it

A changeset is applied as one unit (§7), but its facets are not independent: a data
operation can only mean something against a particular schema. Through 0.3.0 this spec
said nothing about which schema that is, and the gap was not academic — it decides
whether "retire this field and clear it everywhere" is one coherent change or a
contradiction. Independent implementations were each guessing, consistently by
accident rather than by contract.

**Order.** Within one document, a consumer MUST apply:

1. **schema operations that add** — `entity.create`, `field.add`, `constraint.add`;
2. then **data operations** (§5.3);
3. then **schema operations that remove** — `field.remove`, `entity.remove`,
   `constraint.remove`.

This is the expand-then-contract shape every schema migration converges on, and both
halves earn their place. Adding first is what lets one document create an entity and
populate it, or add a field and backfill it — the data operations address a schema the
same document just widened. Removing last is what lets one document address a field on
its way out: the rows are still there to be read, selected, and rewritten while the
data operations run, and the column goes afterwards. Reverse either half and an
ordinary change becomes unexpressible.

UI patches (§5.2) are not ordered against the other two. They address artifacts, not
rows, so nothing observable depends on where they fall.

**What `field.remove` and `entity.remove` take with them.** A removal MUST carry away
the values stored under what it removes: after `field.remove`, no row of that entity
retains a member of that name; after `entity.remove`, no rows of that entity remain.
A consumer MUST NOT leave values behind under a name the schema no longer declares.
The alternative — dropping the declaration and keeping the cells — produces rows
carrying members that nothing in the schema explains, which no later document can
address, because every operation in this vocabulary names a declared field.

It follows that clearing a field's values before removing it in the same document is
**permitted but unnecessary**: a producer MAY emit those writes (they are ordinary
data operations against a schema that still declares the field), and a consumer MUST
reach the same final state whether or not it does.

**Applies to every document.** This clause states what a consumer does with the
vocabulary; it adds no member and no feature, so it binds documents of every
`specVersion`, and a 0.3.0-stamped document is unaffected in shape or stamping (§9).

*(Open item O-5: `field.rename`, `field.retype` and `entity.rename` are ordered by
neither half above — a rename both removes a name and adds one. No fixture or
production document has yet combined them with data operations in a single document,
so the ordering is left open rather than guessed at. Until it is settled, a producer
SHOULD NOT put a rename or retype in the same document as data operations that
address the renamed or retyped target.)*

## 6. Fingerprint

1. Take the document with the `fingerprint` and `approvals` members removed.
2. Canonicalize per RFC 8785 (JCS); encode UTF-8.
3. `fingerprint = "sha256:" + lowercase-hex(SHA-256(bytes))`.

Implementations MUST reject unknown fingerprint prefixes.

## 7. Approvals and the gate

`approvals` is an array of ApprovalRecords (`fingerprint`, `approvedBy`, `approvedAt`,
`comment?`, `attestation?` — the last a reserved extension slot, absent in v0). Approval
records live outside the fingerprint envelope so that an approval can reference the
fingerprint without changing it. `approvedAt` MUST be an RFC 3339 `date-time` under the
same rule as `createdAt` (§4) — it is the only record of when a review happened, and a
free-form value cannot be compared across the tools that read it.

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
well-formed with known `kind` (§4); `createdAt` and every `approvedAt` are RFC 3339
`date-time`s (§4, §7); schema ops and types are from the v0 vocabulary;
`whole-artifact@0` patches satisfy the self-contained diff-consistency check (§5.2.1);
`verified-diff@0` patches have a non-null `baseFingerprint`, a `diff` that parses under
the dialect (§5.2.2) with ≥1 hunk, and `newFingerprint ≠ baseFingerprint`; data patch
`id`s unique and every data operation carries exactly its `op`'s members with a
well-formed `where` (§5.3); `fingerprint`, if present, matches recomputation.

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
ecosystem-wide upgrades from profile adoption. Where a feature would be silently
misread by an older consumer, the spec makes that SHOULD checkable by gating the
feature on its version — `verified-diff@0` on 0.2 (§5.2.2), `baseState.kind: "data"`
on 0.3 (§4). Tightenings are never gated: a rule about what was always malformed
applies at every version a validator supports.

## Changes from 0.3.0

- **Facet application order, and removal semantics (§5.4, MUST)**. A document's
  additive schema operations apply before its data operations, and its removing schema
  operations after them; a removal carries away the values stored under what it
  removes. Both were previously unstated, which left "retire this field and clear it
  everywhere" resting on each consumer's private assumption. The clause constrains
  consumers, not documents: nothing about a document's shape or stamping changes, and
  0.3.0-stamped documents are governed by it like any other (§9).
- **Tightened — timestamps (§4, §7)**: `createdAt` and `approvedAt` were described as
  RFC 3339 but only required to be strings, so `"last tuesday"` validated. Both are now
  checked against the RFC 3339 `date-time` grammar at every supported `specVersion` —
  a tightening, not a feature (§9). Migration: documents carrying any other timestamp
  form are invalid — including a local time without an offset, which some platform
  formatters emit for values of unspecified time zone.
- **Open item O-5** records what §5.4 deliberately does not settle — where a rename or
  retype falls relative to data operations.

## Changes from 0.2.0

- **Added — `baseState.kind: "data"` (§4)**: additive vocabulary, gated on
  `specVersion` 0.3.0. A changeset that changes data can now declare the data state it
  was authored against, exactly as it already could for schema. 0.2 excluded this kind
  for lack of a use case; data-only changesets are the use case — they had no way to
  say what they stood on, so a drift-detecting consumer had nothing to check and
  refused nothing. Migration: none. Producers that begin emitting `data` entries MUST
  stamp 0.3.0, and consumers of those documents will start refusing stale proposals
  that previously applied — the intended effect, not a regression.
- **Tightened — data operation bodies (§5.3)**: `op` was the only member 0.2 validators
  checked; `entity`, `where`, `set`, and `values` were unvalidated. Operations now
  carry exactly their `op`'s members, and `where` is closed to
  `{ field, equals: <literal> }`. Migration: documents whose data operations use another
  shape — most plausibly a key/value `where` map — are invalid at every supported
  `specVersion`. Such documents were already outside the §5.3 model; they did not fail
  earlier, they failed later, in a backend write path.
- **Documented — §5.3 was normative only by example.** The operation table, the literal
  rule, and the closed `where` form state in prose what the JSON example implied.
- **Open item O-4 added** — finer `data` fingerprint granularity (§4).

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
- **O-2** Data transformation expressions and richer `where` predicates (§5.3).
- **O-3** ~~Conformance fixtures directory (`fixtures/`)~~ — resolved: populated since
  the 0.1 reference SDKs; 0.2 adds the `verified-diff@0` dialect corpus, 0.3 the data
  patch corpus, 0.4 the RFC 3339 `date-time` corpus (`timestamps.json` — expectations
  written from RFC 3339 §5.6–5.7, not generated by either SDK).
- **O-5** Ordering of `field.rename` / `field.retype` / `entity.rename` against data
  operations in the same document (§5.4). A rename is additive and removing at once,
  so neither phase claims it. Left open until a document that needs both appears.
- **O-4** Finer `data` base granularity (§4). 0.3 fingerprints the data facet as a
  whole, so any data change drifts every data-declaring proposal. Per-entity or per-row
  units would narrow that, at the cost of an adapter contract for computing them —
  deferred until the coarse unit is shown to refuse too much.
