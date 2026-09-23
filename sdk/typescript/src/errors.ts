/**
 * One located-failure shape for the whole SDK.
 *
 * Validation has reported `{ path, message }` since 0.1, and consumers act on it
 * without reading prose. Parsing and verification — the dialect parser, the
 * canonicalizer, the fingerprint reader — reported the same class of failure as
 * bare `SyntaxError` / `RangeError` with the location inside the sentence, so the
 * only way to act on one was to parse English. The validator felt this first: it
 * caught a dialect failure and spliced the message into its own, which located the
 * error at the patch and threw away where inside the diff it happened.
 *
 * Both now raise {@link ChangesetError}, so "where" is a field in either case.
 */

/** One rendered line: an empty path means the subject as a whole, not a nameless member. */
const render = (e: ValidationError): string => (e.path === "" ? `  ${e.message}` : `  ${e.path}: ${e.message}`);

/** A single located failure. `path` is JSON-pointer-ish, rooted at `$` for a whole document. */
export interface ValidationError {
  path: string;
  message: string;
}

/**
 * A refusal carrying the located reasons behind it.
 *
 * `subject` names what was refused ("changeset failed validation", "verified-diff
 * dialect") and heads the rendered message; `errors` is the part a consumer reads.
 * A parse refusal usually carries exactly one — parsers stop at the first thing
 * they cannot read — while validation reports every failure it found.
 */
export class ChangesetError extends Error {
  readonly errors: ValidationError[];

  constructor(subject: string, errors: ValidationError[]) {
    super(`${subject}:\n` + errors.map(render).join("\n"));
    this.name = "ChangesetError";
    this.errors = errors;
  }

  /** The common case: one failure, known location. */
  static at(subject: string, path: string, message: string): ChangesetError {
    return new ChangesetError(subject, [{ path, message }]);
  }

  /**
   * Re-root these errors under `prefix` — how a caller that owns a wider document
   * lifts a fragment's failures into its own list without nesting them. The dialect
   * parser says `hunk[2]`; the validator says `$.patches.ui[0].diff.hunk[2]`.
   */
  rebase(prefix: string): ValidationError[] {
    return this.errors.map((e) => ({
      path: e.path === "" ? prefix : `${prefix}.${e.path}`,
      message: e.message,
    }));
  }
}

/** The subject strings, fixed so both SDKs and the cross-SDK fixtures agree on them. */
export const SUBJECT = {
  validation: "changeset failed validation",
  dialect: "outside the verified-diff dialect",
  unifiedDiff: "outside the unified-diff dialect",
  canonicalization: "cannot canonicalize",
  fingerprint: "cannot read fingerprint",
  approval: "cannot approve",
} as const;
