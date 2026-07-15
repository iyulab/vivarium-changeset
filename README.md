# Vivarium Changeset

> A versioned, fingerprinted contract for describing application change — schema, UI, and seed data as one reviewable, appliable unit.

**Status: design phase (pre-0.1).** This is a *specification-first* repository: the spec is the product, the SDKs are its reference companions. This document fixes purpose, scope, and non-negotiable properties of the format; the format's concrete shape is developed in `spec/` through ADRs.

---

## Why

When an AI agent modifies a live application, the change is never just one thing. "Add a due-date to the loan screen" is a schema change (a column), a data change (backfill), and a UI change (a field) — and they are only correct *together*. Applying them separately creates the worst failure mode a runtime-mutable platform can have: a schema the UI doesn't match, or a UI pointing at columns that don't exist.

Existing formats each cover a slice. SQL migration tools describe schema. UI code describes screens. Nothing describes *the whole change as one unit* that can be:

- **reviewed** before it touches anything,
- **fingerprinted** so what gets applied is provably what was reviewed,
- **applied atomically** so the application is never in a half-changed state,
- **carried between tools** written by different teams, in different languages, on different sides of an OSS/commercial boundary.

The changeset is that unit. It is the lingua franca of the Vivarium family — the reason four independent repos can compose without knowing each other's internals.

## What this repository contains

- **The specification.** A versioned document defining the changeset's structure, semantics, and invariants. The spec is normative; SDKs implement it.
- **The fingerprint scheme.** How a changeset's content-addressed hash is computed, and the review-gate semantics built on it.
- **Reference SDKs.** Libraries (initially .NET and TypeScript) for constructing, parsing, validating, diffing, and fingerprinting changesets. SDKs contain *no* apply logic.
- **Conformance fixtures.** A shared test corpus any independent implementation can validate against.

## What a changeset is

Conceptually, a changeset bundles three kinds of patch under one version and one fingerprint:

| Facet | Describes | Lineage |
| --- | --- | --- |
| **Schema patch** | Structural change to the data model | generalizes the reviewed-plan model proven in [Schemorph](https://github.com/iyulab/Schemorph) |
| **UI patch** | Change to screens/components | targets sandbox-runnable UI such as [Vivarium](../vivarium) output |
| **Data patch** | Seeds, backfills, one-off transformations | versioned, run-once, checksummed |

A changeset also carries provenance (who/what produced it, from which base state) so that "apply" can refuse when the world has drifted since review.

## What this repository is not

- **Not an engine.** Nothing in this repo connects to a database, renders UI, or applies anything. Apply semantics are specified here; apply *execution* lives in consumers such as [`vivarium-stage`](../vivarium-stage).
- **Not tied to any producer or consumer.** Agents produce changesets; humans can too. Stage applies them; other engines may as well. The contract must outlive any single implementation on either side.
- **Not a general-purpose diff format.** It describes application change in the Vivarium sense — schema + UI + data — nothing broader.

## Fixed principles

1. **The spec is the source of truth.** Implementations conform to the spec, never the reverse. Breaking changes to the format require a spec version bump and an ADR.
2. **Review-then-apply is built into the format.** Every changeset has a deterministic, content-addressed fingerprint. A conforming applier executes exactly a reviewed fingerprint or refuses. There is no "apply latest."
3. **One changeset, one atomic intent.** The facets of a changeset are meaningful together; the format must never encourage applying them separately.
4. **Machine-first, human-legible.** Agents are the primary authors and readers, but a human reviewer must be able to read a changeset and understand what will happen — every change carries an explanation slot.
5. **Zero dependencies, in both directions.** This repo depends on nothing in the family; everything in the family may depend on it. It is the one edge every arrow points at.

## Deliberately undecided

- Serialization (JSON, YAML, or multiple encodings over one model)
- Granularity of UI patches (whole-artifact replacement vs. fine-grained edits)
- How schema patches map onto specific backends (MorphDB operations, SQL, etc. — adapter concern)
- Signing/attestation beyond content fingerprints
- Additional SDK languages

## Relationship to the Vivarium family

`vivarium-changeset` is the family's dependency root. [`vivarium-agent`](../vivarium-agent) emits changesets; [`vivarium-stage`](../vivarium-stage) previews and applies them; [`vivarium`](../vivarium) exchanges UI patches through them. Horizontal dependencies between the other repos are forbidden — if two of them need to talk, the vocabulary they use is defined here.

Standalone use is a first-class scenario: any system that wants "reviewable, fingerprint-gated application change" can adopt the format without adopting anything else from the family.

## License

MIT. The specification is additionally intended to be openly implementable — independent, non-Vivarium implementations are welcome and the conformance fixtures exist to support them.