import { test } from "node:test";
import assert from "node:assert/strict";
import { addApproval } from "./approval.ts";
import { addSchemaOp, createChangeset, finalize } from "./builder.ts";
import { fingerprintOf, verifyFingerprint } from "./fingerprint.ts";
import { validate } from "./validate.ts";

const finalized = () =>
  finalize(
    addSchemaOp(createChangeset({ intent: "Add a due date", producedBy: "test", createdAt: "2026-09-23T00:00:00Z" }), {
      op: "field.add",
      entity: "loan",
      field: { name: "dueDate", type: "date", required: false },
      explanation: "Stores the due date",
    }),
  );

test("approval leaves the fingerprint intact and the document valid", () => {
  const doc = finalized();
  const approved = addApproval(doc, { approvedBy: "reviewer-1", approvedAt: "2026-09-23T01:00:00Z" });
  assert.equal(approved.fingerprint, doc.fingerprint);
  assert.equal(fingerprintOf(approved), doc.fingerprint);
  assert.equal(verifyFingerprint(approved), true);
  assert.equal(validate(approved).valid, true);
  assert.deepEqual(approved.approvals, [
    { fingerprint: doc.fingerprint, approvedBy: "reviewer-1", approvedAt: "2026-09-23T01:00:00Z" },
  ]);
});

test("approval returns a copy — the input document is not touched", () => {
  const doc = finalized();
  const before = structuredClone(doc);
  const once = addApproval(doc, { approvedBy: "a", approvedAt: "2026-09-23T01:00:00Z" });
  addApproval(once, { approvedBy: "b", approvedAt: "2026-09-23T02:00:00Z" });
  assert.deepEqual(doc, before);
  assert.equal(once.approvals.length, 1);
});

test("an omitted comment adds no key", () => {
  const approved = addApproval(finalized(), { approvedBy: "a", approvedAt: "2026-09-23T01:00:00Z" });
  assert.equal(Object.hasOwn(approved.approvals[0], "comment"), false);
});
