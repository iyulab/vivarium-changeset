# Changelog

All notable changes to the changeset spec and its reference SDKs.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) ·
versioning: the spec and the reference SDKs version together while both
are pre-1.0.

## [Unreleased]

### Fixed
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
