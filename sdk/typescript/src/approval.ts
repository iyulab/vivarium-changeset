import { ChangesetValidationError } from "./builder.ts";
import { ChangesetError, SUBJECT } from "./errors.ts";
import { verifyFingerprint } from "./fingerprint.ts";
import { validate } from "./validate.ts";

/** An approval record (spec §7). `attestation` is reserved and absent in v0. */
export interface ApprovalRecord {
  fingerprint: string;
  approvedBy: string;
  approvedAt: string;
  comment?: string;
}

/**
 * Return a copy of a finalized document with one approval record appended.
 *
 * The record's `fingerprint` is taken from the document, never passed in: it must
 * name exactly what was reviewed, which is the one field a hand-written record gets
 * wrong silently. Everything else is the caller's — `approvedBy` is opaque here,
 * and the caller supplies the clock, as `createChangeset` does for `createdAt`.
 *
 * Refuses a document that carries no fingerprint (not finalized) or whose
 * fingerprint no longer matches its contents (changed after finalizing), and
 * refuses to emit a document that does not validate. Which approvals an applier
 * trusts, and where they are kept, stay implementation-defined (spec §7).
 */
export function addApproval<T extends Record<string, unknown>>(
  document: T,
  approval: { approvedBy: string; approvedAt: string; comment?: string },
): T & { approvals: ApprovalRecord[] } {
  if (typeof document["fingerprint"] !== "string") {
    throw ChangesetError.at(SUBJECT.approval, "$.fingerprint", "absent — only a finalized document can be approved (spec §7)");
  }
  if (!verifyFingerprint(document)) {
    throw ChangesetError.at(
      SUBJECT.approval,
      "$.fingerprint",
      "does not match the document's contents — it changed after it was finalized (spec §7)",
    );
  }
  const record: ApprovalRecord = {
    fingerprint: document["fingerprint"],
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    ...(approval.comment !== undefined ? { comment: approval.comment } : {}),
  };
  const existing = document["approvals"];
  // A non-array `approvals` is left as it is so the validator names it below.
  const approvals = existing === undefined ? [record] : Array.isArray(existing) ? [...existing, record] : existing;
  const approved = { ...document, approvals } as T & { approvals: ApprovalRecord[] };
  const result = validate(approved);
  if (!result.valid) throw new ChangesetValidationError(result.errors);
  return approved;
}
