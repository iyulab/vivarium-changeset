export { canonicalize, canonicalBytes } from "./canonicalize.ts";
export { FINGERPRINT_PREFIX, fingerprintOf, stampFingerprint, verifyFingerprint } from "./fingerprint.ts";
export { createUnifiedDiff, applyUnifiedDiff, reverseApplyUnifiedDiff } from "./diff.ts";
export { validate, SUPPORTED_SPEC_VERSIONS } from "./validate.ts";
export type { ValidationError, ValidationResult } from "./validate.ts";
