# spec/ — The Vivarium Changeset Specification

The spec is the product; SDKs implement it, never the reverse.

- [`SPEC.md`](SPEC.md) — the normative specification (0.3.0).
- `fixtures/` — conformance corpus any independent implementation validates against.

## Design decisions (summary)

| Decision | Choice |
| --- | --- |
| Serialization | JSON only, I-JSON subset (RFC 7493) |
| Fingerprint | `sha256:` + SHA-256 over RFC 8785 (JCS) canonical bytes; `approvals` and `fingerprint` excluded from the hash |
| Reviewed-state | Spec-defined ApprovalRecord + mandatory applier verification; signatures reserved as an `attestation` extension slot |
| UI patches | Reviewability invariant; profiles: `whole-artifact@0` (self-verifying review diff) + `verified-diff@0` (0.2 — strict-dialect diff, deterministic fail-closed apply, two-layer verification) |
| Schema patches | Backend-neutral logical operation vocabulary; backend mapping is an adapter concern; no raw passthrough |
| Data patches | Run-once operations with per-`op` required members and a closed `where` (`{field, equals: <literal>}`, 0.3); expressions deferred (O-2) |
| Base state | Closed `kind` vocabulary — `schema` · `ui-artifact` · `changeset` (lineage, drift-exempt) · `data` (0.3); fingerprint units are adapter-defined |
