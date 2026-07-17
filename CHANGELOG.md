# Changelog

All notable changes to the changeset spec and its reference SDKs.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) ·
versioning: the spec and the reference SDKs version together while both
are pre-1.0.

## [Unreleased]

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
