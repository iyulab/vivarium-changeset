/**
 * Authoring helpers. The builder's job is to make invalid documents hard to
 * construct: review diffs and base fingerprints are computed, never hand-written,
 * and finalize() refuses to emit anything that does not validate.
 * There is no apply logic here and never will be.
 */
import { createUnifiedDiff } from "./diff.ts";
import { createVerifiedDiff } from "./verified-diff.ts";
import { artifactFingerprint, stampFingerprint } from "./fingerprint.ts";
import { validate, SUPPORTED_SPEC_VERSIONS, type ValidationError } from "./validate.ts";

export { artifactFingerprint } from "./fingerprint.ts";

export interface BaseStateEntry { kind: string; ref: string; fingerprint: string }
export interface ChangesetDraft {
  specVersion: string;
  id?: string;
  intent: string;
  provenance: { producedBy: string; createdAt: string; baseState: BaseStateEntry[]; editContext?: unknown };
  patches: { schema: unknown[]; ui: unknown[]; data: unknown[] };
}

export class ChangesetValidationError extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super("changeset failed validation:\n" + errors.map((e) => `  ${e.path}: ${e.message}`).join("\n"));
    this.errors = errors;
  }
}

export function createChangeset(init: {
  intent: string;
  producedBy: string;
  createdAt: string; // caller supplies the clock — the SDK stays deterministic
  id?: string;
  baseState?: BaseStateEntry[];
  editContext?: unknown;
}): ChangesetDraft {
  return {
    specVersion: SUPPORTED_SPEC_VERSIONS[0],
    ...(init.id !== undefined ? { id: init.id } : {}),
    intent: init.intent,
    provenance: {
      producedBy: init.producedBy,
      createdAt: init.createdAt,
      baseState: init.baseState ?? [],
      ...(init.editContext !== undefined ? { editContext: init.editContext } : {}),
    },
    patches: { schema: [], ui: [], data: [] },
  };
}

export function addSchemaOp(draft: ChangesetDraft, op: Record<string, unknown>): ChangesetDraft {
  return { ...draft, patches: { ...draft.patches, schema: [...draft.patches.schema, op] } };
}

/** Base fingerprint and review diff are derived from the contents — by construction consistent. */
export function addUiPatch(
  draft: ChangesetDraft,
  patch: { artifactId: string; baseContent: string | null; newContent: string; explanation: string }
): ChangesetDraft {
  const base = patch.baseContent ?? "";
  const ui = {
    profile: "whole-artifact@0",
    artifactId: patch.artifactId,
    baseFingerprint: patch.baseContent === null ? null : artifactFingerprint(base),
    newContent: patch.newContent,
    reviewDiff: createUnifiedDiff(base, patch.newContent),
    explanation: patch.explanation,
  };
  return { ...draft, patches: { ...draft.patches, ui: [...draft.patches.ui, ui] } };
}

/**
 * verified-diff@0 (spec §5.2.2): diff and both fingerprints are derived from
 * the contents — by construction consistent. Refuses no-ops at authoring
 * time. Adding one lifts the draft's specVersion to 0.2.0 (the lowest
 * version the document now requires — spec §9 minimality, automated).
 */
export function addVerifiedDiffPatch(
  draft: ChangesetDraft,
  patch: { artifactId: string; baseContent: string; newContent: string; explanation: string }
): ChangesetDraft {
  const diff = createVerifiedDiff(patch.baseContent, patch.newContent);
  if (diff === "") {
    throw new ChangesetValidationError([
      { path: "$.patches.ui", message: "no-op verified-diff patch: contents are identical (spec §5.2.2)" },
    ]);
  }
  const ui = {
    profile: "verified-diff@0",
    artifactId: patch.artifactId,
    baseFingerprint: artifactFingerprint(patch.baseContent),
    diff,
    newFingerprint: artifactFingerprint(patch.newContent),
    explanation: patch.explanation,
  };
  return {
    ...draft,
    specVersion: "0.2.0",
    patches: { ...draft.patches, ui: [...draft.patches.ui, ui] },
  };
}

export function addDataPatch(
  draft: ChangesetDraft,
  patch: { id: string; explanation: string; operations: Record<string, unknown>[] }
): ChangesetDraft {
  return { ...draft, patches: { ...draft.patches, data: [...draft.patches.data, patch] } };
}

/** Validate and stamp. Emits a conforming, fingerprinted document — or throws. */
export function finalize(draft: ChangesetDraft): Record<string, unknown> & { fingerprint: string } {
  const result = validate(draft as unknown as Record<string, unknown>);
  if (!result.valid) throw new ChangesetValidationError(result.errors);
  return stampFingerprint(draft as unknown as Record<string, unknown>);
}
