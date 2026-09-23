# Changelog

All notable changes to the changeset spec and its reference SDKs.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) ·
versioning: each SDK follows semver for its API, and the spec's version
moves only when the document format does. Every entry names the spec
version the SDKs implement. (Through 0.4.0 the spec and the SDKs versioned
together.)

## [0.5.0] — 2026-09-23

> Published as `@vivariumjs/changeset@0.5.0` (npm) and
> `Vivarium.Changeset 0.5.0` (NuGet), tags `ts-v0.5.0` / `dotnet-v0.5.0`.
> The SDKs implement **spec 0.4.0**, which is unchanged: this release adds
> SDK surface only, so documents and their fingerprints are the same.

### Added
- **Building an approval record** — `addApproval` (TypeScript) and
  `ChangesetApproval.Add` (.NET) take a finalized document and return a copy
  with one approval record appended (spec §7). The record's `fingerprint` is
  derived from the document, never passed in, so it names exactly what was
  reviewed. The caller supplies `approvedBy` and `approvedAt`, as it does
  `createdAt`.
- Refusals: a document without a fingerprint (never finalized), or whose
  fingerprint no longer matches its contents (changed after finalizing), is
  refused under the new subject `cannot approve`. The emitted document is
  validated, so an `approvedAt` that is not an RFC 3339 `date-time` is refused
  with the validator's message. `attestation` stays reserved and is not
  accepted.
- `spec/fixtures/approval.json` — cross-SDK vectors for the operation and its
  refusals, maintained by hand.

## [0.4.0] — 2026-09-23

> Published as `@vivariumjs/changeset@0.4.0` (npm) and
> `Vivarium.Changeset 0.4.0` (NuGet), tags `ts-v0.4.0` / `dotnet-v0.4.0`.
> Spec 0.4.0 is normative; both SDKs conform to it with byte-identical
> fingerprints and byte-identical validation messages.

### Added
- **Spec §5.4 — how one document's facets are applied, and what a removal takes with it.**
  A consumer applies additive schema operations before the document's data operations and
  removing ones after them, and a removal carries away the values stored under what it
  removes. Both were previously unstated, which left "retire this field and clear it
  everywhere" resting on each consumer's private assumption and could leave rows holding a
  member no schema declares. The clause constrains consumers, not documents: no member and
  no feature is added, document shape and stamping are unchanged, and documents of every
  `specVersion` are governed by it.
- **Open item O-5** — where `field.rename` / `field.retype` / `entity.rename` fall relative
  to data operations is deliberately left open; a rename adds and removes at once, so
  neither phase claims it, and no document combining the two has appeared yet.
- **Four cross-SDK vectors pin the refusal subjects** (`refusal-subjects.json`). Three of the
  five subject literals are raised by paths the validator never reaches, so nothing compared
  them and the two SDKs could have drifted into saying different things to the same consumer.
- Both SDKs accept `specVersion` `0.4.0`. Nothing stamps it — §9 has producers stamp the
  lowest version whose features they use, and 0.4.0 adds no document feature — but a
  validator that refused the current spec's own version would be its own contradiction.
- **`ChangesetError` — one located-failure shape for the whole SDK.** Parsing, canonicalization
  and fingerprint reading now raise it with the same `{ path, message }` list validation has
  always reported, so a caller reads "what went wrong and where" the same way whichever raised
  it. `ChangesetValidationError` / `ChangesetValidationException` extend it and are unchanged
  in what they carry.

### Changed
- **A dialect failure inside a UI patch is located inside the diff.** The validator used to
  splice the parser's sentence into one of its own, which reported every diff failure at
  `$.patches.ui[N].diff` however deep inside the diff it happened. Failures are now lifted with
  their own location — `$.patches.ui[0].diff.hunk[1]` — into the same flat error list. The same
  lift applies in `verifyAgainstBase`, which keeps its layer-2 framing on the message.
- **Timestamps are checked, not just typed (spec §4, §7 — tightened).** `provenance.createdAt`
  and `approvals[].approvedAt` were refused with "required RFC 3339 string" but only checked to
  be strings, so `"last tuesday"` validated. Both SDKs now check the RFC 3339 `date-time`
  grammar — the same rule in each, not a platform date parser, since the two platforms' parsers
  accept different non-RFC inputs — and refuse with
  `not an RFC 3339 date-time: "…" (expected YYYY-MM-DDTHH:MM:SS[.frac](Z|+HH:MM|-HH:MM), spec §4)`.
  Applies at every supported `specVersion`. `toISOString()`, `DateTimeOffset.ToString("o")` and a
  UTC `DateTime`'s `ToString("o")` conform; a `DateTime` of unspecified kind formats without an
  offset and is now refused.
- **.NET validation messages quote offending values exactly as the TypeScript SDK does.**
  The .NET SDK rendered them with the default JSON encoder, which escapes `+ < > & '` and every
  non-ASCII character, keeps a number's source spelling (`1.0`), and printed an explicit `null`
  as `undefined`. Messages for such values differed between the SDKs despite the parity vectors,
  which had never exercised them. Now pinned by six new vectors.
- **TypeScript: `field.add` with a falsy non-null `field` (`0`, `""`, `false`) is refused.** It was
  skipped by a truthiness test and validated; the .NET SDK already refused it.

### Removed
- **Parsing and verification no longer raise the built-in types.** `SyntaxError`, `RangeError`,
  `TypeError` (TypeScript) and `FormatException`, `InvalidOperationException`,
  `ArgumentException`, `ArgumentOutOfRangeException` (.NET) are replaced by `ChangesetError` at
  every consumer-facing throw site. Code that caught the built-in types will not catch these.

> **Upgrade note**: catch `ChangesetError` and read `.errors` / `.Errors`. The message text of
> each individual failure is unchanged — only its carrier, and the fact that it now has a path.
> Two exceptions, both listed under Changed: timestamps that are not RFC 3339 `date-time`s are
> now refused (a document that validated may not), and .NET messages quoting a value with
> non-ASCII or HTML-sensitive characters, a non-canonical number, or `null` now render it as
> the TypeScript SDK does.

## [0.3.0] — 2026-08-06

> Published as `@vivariumjs/changeset@0.3.0` (npm) and
> `Vivarium.Changeset 0.3.0` (NuGet), tags `ts-v0.3.0` / `dotnet-v0.3.0`.
> Spec 0.3.0 is normative; both SDKs conform to it with byte-identical
> fingerprints.

### Added
- **Spec §4 — `baseState.kind: "data"`**, symmetric with `schema`. A changeset that
  changes data can now declare the data state it was authored against; before this it
  could not, so a drift-detecting consumer had nothing to check and applied stale data
  proposals without complaint. Gated on `specVersion` 0.3.0.
- **Spec §5.3 — normative prose.** The section defined data operations by example only.
  It now states the per-`op` required members, the closed `where` form, and the
  literal-only rule the example implied.
- **SDKs — `data` base entries raise the draft's `specVersion` to 0.3.0** at authoring
  time, the same §9 minimality automation `verified-diff@0` already had.
- **Conformance corpus — `spec/fixtures/data-patch.json`**, 12 vectors both SDKs run.
- **Conformance corpus — `spec/fixtures/validation-messages.json`**, asserting the
  exact, order-sensitive `{path, message}` list in both SDKs. The existing corpus only
  compared the `valid` boolean, so message text could drift apart between the SDKs
  unnoticed; it had.
- **SDKs — `UI_PATCH_PROFILES` / `UiPatchProfiles`** names the closed `patches.ui[]`
  profile vocabulary, which had no exported name.
- **Spec — open item O-4**: finer `data` fingerprint granularity (per-entity, per-row).
  0.3 fingerprints the facet as a whole.

### Changed
- **Tightened — data operation bodies (spec §5.3).** `op` was the only member the
  validators checked; `entity`, `where`, `set`, and `values` were unvalidated, so a
  malformed data patch passed validation, sealed into the fingerprint, and failed later
  inside a backend write path. Operations now carry exactly their `op`'s members, and
  `where` is closed to `{ field, equals: <literal> }`. The schema facet has always been
  validated this way — one document should not hold two standards of rigor.
  **Migration**: documents whose data operations use another shape are now invalid at
  every supported `specVersion`. A tightening describes what was always malformed, so it
  is not version-gated.

- **SDKs — a rejection now names the vocabulary it is rejecting against.** Every
  closed-vocabulary rejection enumerates the accepted values — `specVersion`,
  `baseState.kind`, schema and data operations, logical types, UI patch profiles — so
  `unsupported specVersion: "0.1"` became `unsupported specVersion: "0.1" (supported:
  0.1.0, 0.2.0, 0.3.0)`, and the author sees the typo instead of guessing. The offending
  value is rendered as JSON, so a string (`"0.1"`) is visibly distinct from a number
  (`0.1`). No acceptance change: every document valid before is valid now.

### Fixed
- **SDKs — a `patches`/`provenance` member of the wrong type is no longer reported as
  missing.** A member that is present but, say, an array collapsed into `... is
  required`, which sends the author looking for something they already sent; it now
  reads `... must be an object ...`. This also closed a divergence between the SDKs —
  for `patches: [array]` the .NET SDK said `patches is required` while the TypeScript
  SDK emitted unknown-member noise.
- **SDKs — adding a `verified-diff@0` patch no longer lowers a draft's `specVersion`.**
  It assigned `0.2.0` outright rather than raising a floor; on a draft that already
  required more, the stamp would fall below what the document needs. Version gates are
  now floors on both the authoring and the validating side (`verified-diff@0` requires
  0.2.0 *or later*).

## [0.2.0] — 2026-07-19

> Published as `@vivariumjs/changeset@0.2.0` (npm) and
> `Vivarium.Changeset 0.2.0` (NuGet), tags `ts-v0.2.0` / `dotnet-v0.2.0`.
> Spec 0.2.0 is normative; both SDKs conform to it with byte-identical
> fingerprints.
>
> The first npm publish (`@vivariumjs/changeset@0.1.0`, 2026-07-17) shipped
> with the SDK changes below included; the `v0.1.0` git tag predates them
> (it tagged the spec). The npm scope is `@vivariumjs` — the `@vivarium`
> org name was already taken on npm.
>
> The first NuGet publish (`Vivarium.Changeset 0.1.0`, 2026-07-19) shipped
> the same SDK content, verified consumable from the registry. Release tags
> now name their artifact — `ts-v*` for npm, `dotnet-v*` for NuGet — because
> a single tag coupled the two registries: a packaging-only change to one SDK
> forced a no-op republish of the other (the .NET publish was blocked by npm
> 409 on the already-published 0.1.0). The SDKs still conform to one spec
> version with byte-identical fingerprints; that invariant is enforced by the
> shared fixture corpus on every push, not by shipping them together.

### Changed
- SDK (TypeScript): the package now ships built JavaScript — `exports`
  points at `dist/*.js` + `*.d.ts` (built by `prepack`; strict-mode tsc
  with rewritten `.ts` import extensions) instead of raw TypeScript
  source. Raw-`.ts` exports were unimportable from inside `node_modules`
  (Node refuses type stripping there), so a registry/tarball install of
  0.1.0 could not be imported at all. Runtime dependencies remain zero;
  sibling `file:` consumers build once (`npm ci && npm run build`).
- SDK READMEs (both): the consuming-side verification examples now check
  the results and refuse on failure — `validate`/`verifyFingerprint`
  (`ChangesetValidator.Validate`/`ChangesetFingerprint.Verify`) report,
  they do not throw; the previous bare-statement examples silently
  accepted tampered changesets. Usage examples are now self-contained and
  executed against the packed package in CI (`readme-consumer-smoke`).

### Added
- **SDK (.NET) 0.2.0**: spec 0.2 parity with the TypeScript SDK —
  `VerifiedDiff` dialect engine (`Create` / `Apply` / `ParseStrict` /
  `VerifyAgainstBase`), validator layer-1 verified-diff checks + `baseState`
  structural validation + `BaseStateKinds`, builder
  `AddVerifiedDiffPatch` with the same no-op refusal and specVersion lift.
  Reproduces the TypeScript-generated `verified-diff.json` and
  `base-state.json` corpora exactly (cross-SDK dialect agreement).
- **SDK (TypeScript) 0.2.0**: spec 0.2 implementation — `verified-diff@0`
  dialect engine (`createVerifiedDiff` / `applyVerifiedDiff` /
  `parseVerifiedDiff`: exact line numbers, no fuzz, byte-faithful CR/LF,
  EOF marker) with the layer-2 verifier `verifyAgainstBase`; `validate`
  gains layer-1 verified-diff checks, `baseState` structural validation +
  closed `kind` vocabulary (`BASE_STATE_KINDS`), and 0.2.0 in
  `SUPPORTED_SPEC_VERSIONS`; builder gains `addVerifiedDiffPatch`
  (derived diff + fingerprints, refuses no-ops, lifts the draft's
  specVersion to 0.2.0 per §9 minimality). `artifactFingerprint` moved to
  the fingerprint module (re-exported unchanged). New conformance corpora:
  `verified-diff.json` (11 dialect cases — the 7 spec-required plus
  multi-hunk, insert-at-start, EOF-state-change-only, delete-to-empty
  hardening) + `base-state.json` (§4 tightening) — generated from the
  reference implementation.
- **Spec 0.2.0** (`spec/SPEC.md`): second UI patch profile `verified-diff@0` —
  strict unified-diff dialect (exact line numbers, no fuzz, byte-faithful
  newline handling with `\ No newline at end of file` marker), no-op
  prohibition (≥1 hunk and `newFingerprint ≠ baseFingerprint`),
  deterministic fail-closed application, and two-layer validation
  (structural / base-supplied complete). Tightened `baseState`: structural
  validation + closed `kind` vocabulary (`schema | ui-artifact |
  changeset`) with the lineage (`changeset`) drift exemption codified.
  Producer guidance: specVersion minimality (SHOULD). Migration notes in
  SPEC.md §Changes from 0.1.0.
- **.NET reference SDK** (`sdk/dotnet`, `Vivarium.Changeset`, net10.0):
  same surface as the TypeScript SDK — JCS canonicalization (ECMAScript
  number/string forms reimplemented over .NET), fingerprint (+ stamp /
  verify), validation (§8), unified diff engine with reverse-apply
  verification, authoring builder that refuses to finalize invalid
  documents. 59 tests, no runtime dependencies beyond the BCL.
- **Conformance fixtures**: `interop-jcs-edges` fingerprint vector —
  JCS number/string edge cases (1e+21, 1e-7, double artifacts, denormal
  minimum, unicode keys, control characters, surrogate pairs) generated
  by the TypeScript SDK and reproduced by the .NET SDK, proving
  cross-SDK fingerprint agreement.

### Fixed
- **Publish workflow**: both registry jobs are now rerun-safe and fail
  with actionable messages. npm publish skips when the version is already
  live (a rerun after a flaky verification died on "cannot publish over
  previously published versions" — observed on ts-v0.2.0); NuGet push
  gains `--skip-duplicate`. The registry verification loops fail
  explicitly on exhaustion instead of falling through to a confusing
  module-not-found, the npm loop uses `--prefer-online` so the runner's
  cache cannot re-serve an earlier 404 packument, and the npm retry
  window grows to ~10 minutes to cover observed propagation lag.
- SDK (TypeScript): `validate` now returns validation errors instead of
  throwing on malformed shapes — non-array facets, non-object patch /
  approval / operation items, and non-array `entity.create` fields
  (the validator's contract is to report, not crash). Both SDKs also now
  reject a non-array `fields` member on `entity.create`.
- SDK (TypeScript): the authoring builder surface (`createChangeset`,
  `addUiPatch`, `addDataPatch`, `addSchemaOp`, `finalize`,
  `artifactFingerprint`, `ChangesetValidationError`) is now exported from
  the package entry point.

## [0.1.0] — 2026-07-16

First tagged release of the boundary contract.

### Added
- **Spec 0.1.0** (`spec/SPEC.md`, normative): closed core model
  (`specVersion`, `intent`, `provenance`, `patches`, `fingerprint`,
  `approvals`), provenance with `baseState` drift semantics, three facets
  (schema / ui / data), canonical serialization via RFC 8785 (JCS) with
  `sha256:`-prefixed fingerprints and a normative hash boundary, approval
  records bound to fingerprints with an attestation extension slot, the
  `whole-artifact@0` UI patch profile with a mandatory self-verifying
  review diff, the logical schema operation vocabulary (backend mapping is
  adapter territory), and validation rules (§8).
- **TypeScript reference SDK** (`sdk/typescript`): canonicalize,
  fingerprint (+ verify), validate, unified diff engine with reverse-apply
  verification, authoring builder. 40 tests.
- **Conformance fixtures**: JCS edge cases, fingerprint vectors, gate
  cases — shared across SDK implementations.
