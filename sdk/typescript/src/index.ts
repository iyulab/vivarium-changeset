export { canonicalize, canonicalBytes } from "./canonicalize.ts";
export { FINGERPRINT_PREFIX, fingerprintOf, stampFingerprint, verifyFingerprint } from "./fingerprint.ts";
export { createUnifiedDiff, applyUnifiedDiff, reverseApplyUnifiedDiff } from "./diff.ts";
export {
  parseVerifiedDiff,
  applyVerifiedDiff,
  createVerifiedDiff,
  verifyAgainstBase,
} from "./verified-diff.ts";
export type { VerifiedDiffUiPatch, VerifyAgainstBaseResult } from "./verified-diff.ts";
export { validate, SUPPORTED_SPEC_VERSIONS, BASE_STATE_KINDS } from "./validate.ts";
export type { ValidationResult } from "./validate.ts";
export { ChangesetError, SUBJECT } from "./errors.ts";
export type { ValidationError } from "./errors.ts";
export {
  createChangeset,
  addSchemaOp,
  addUiPatch,
  addVerifiedDiffPatch,
  addDataPatch,
  finalize,
  artifactFingerprint,
  ChangesetValidationError,
} from "./builder.ts";
export type { ChangesetDraft, BaseStateEntry } from "./builder.ts";
