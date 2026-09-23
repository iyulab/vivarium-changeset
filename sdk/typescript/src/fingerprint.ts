import { ChangesetError, SUBJECT } from "./errors.ts";
import { canonicalBytes } from "./canonicalize.ts";
import { sha256Hex } from "./sha256.ts";

export const FINGERPRINT_PREFIX = "sha256:";

/**
 * Compute a changeset document's fingerprint (spec §6 / ADR-0002):
 * SHA-256 over the JCS canonical bytes of the document with the top-level
 * `fingerprint` and `approvals` members removed.
 */
export function fingerprintOf(document: Record<string, unknown>): string {
  const { fingerprint: _f, approvals: _a, ...content } = document;
  return FINGERPRINT_PREFIX + sha256Hex(canonicalBytes(content));
}

/**
 * Artifact fingerprint (spec §4): SHA-256 over the artifact's raw UTF-8
 * content bytes — artifact content is not JSON, so no JCS.
 */
export const artifactFingerprint = (content: string): string =>
  FINGERPRINT_PREFIX + sha256Hex(new TextEncoder().encode(content));

/** Return a copy of the document with its computed fingerprint stamped in. */
export function stampFingerprint<T extends Record<string, unknown>>(document: T): T & { fingerprint: string } {
  return { ...document, fingerprint: fingerprintOf(document) };
}

/**
 * Verify a document's embedded fingerprint. Unknown prefixes are rejected,
 * never guessed (ADR-0002).
 */
export function verifyFingerprint(document: Record<string, unknown>): boolean {
  const embedded = document["fingerprint"];
  if (typeof embedded !== "string") return false;
  if (!embedded.startsWith(FINGERPRINT_PREFIX)) {
    throw ChangesetError.at(SUBJECT.fingerprint, "$.fingerprint", `unsupported fingerprint prefix: ${embedded.split(":")[0]}:`);
  }
  return embedded === fingerprintOf(document);
}
