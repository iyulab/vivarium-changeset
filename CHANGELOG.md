# Changelog

All notable changes to the changeset spec and its reference SDKs.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) ·
versioning: the spec and the reference SDKs version together while both
are pre-1.0.

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
