import { test } from "node:test";
import assert from "node:assert/strict";
import { addDataPatch, addSchemaOp, addUiPatch, ChangesetValidationError, createChangeset, finalize } from "./builder.ts";
import { validate } from "./validate.ts";
import { verifyFingerprint } from "./fingerprint.ts";

const start = () =>
  createChangeset({ intent: "Add a due-date to the loan screen", producedBy: "test-suite", createdAt: "2026-07-16T00:00:00Z" });

test("built documents validate and verify end-to-end", () => {
  let draft = start();
  draft = addSchemaOp(draft, {
    op: "field.add",
    entity: "loan",
    field: { name: "dueDate", type: "date" },
    explanation: "stores the due date",
  });
  draft = addUiPatch(draft, {
    artifactId: "screen-loans",
    baseContent: "old source\nline two",
    newContent: "new source\nline two",
    explanation: "renders the field",
  });
  draft = addDataPatch(draft, { id: "seed", explanation: "seed rows", operations: [{ op: "insert", entity: "loan", values: {} }] });

  const doc = finalize(draft);
  assert.equal(validate(doc).valid, true);
  assert.equal(verifyFingerprint(doc), true);
  assert.match(doc.fingerprint, /^sha256:/);
});

test("creation UI patch is consistent by construction", () => {
  let draft = start();
  draft = addUiPatch(draft, { artifactId: "new-screen", baseContent: null, newContent: "brand new", explanation: "creates screen" });
  assert.equal(validate(finalize(draft)).valid, true);
});

test("finalize refuses invalid drafts with structured errors", () => {
  const draft = start(); // no patches at all → empty facets
  assert.throws(() => finalize(draft), ChangesetValidationError);
  try {
    finalize(draft);
  } catch (e) {
    assert.ok((e as ChangesetValidationError).errors.length > 0);
  }
});

test("builder is immutable — drafts can fork", () => {
  const base = start();
  const a = addDataPatch(base, { id: "a", explanation: "x", operations: [] });
  assert.equal(base.patches.data.length, 0);
  assert.equal(a.patches.data.length, 1);
});

test("verified-diff patch: derived, no-op-refusing, lifts specVersion to 0.2.0", async () => {
  const { addVerifiedDiffPatch } = await import("./builder.ts");
  let draft = start();
  assert.equal(draft.specVersion, "0.1.0"); // minimality: starts at the floor
  draft = addVerifiedDiffPatch(draft, {
    artifactId: "screen-loans",
    baseContent: "const title = \"Loans\";\n",
    newContent: "const title = \"Active loans\";\n",
    explanation: "rename title",
  });
  assert.equal(draft.specVersion, "0.2.0"); // lifted by the 0.2 feature
  const doc = finalize(draft);
  assert.equal(validate(doc).valid, true);
  assert.equal(verifyFingerprint(doc), true);

  assert.throws(
    () => addVerifiedDiffPatch(start(), { artifactId: "x", baseContent: "same\n", newContent: "same\n", explanation: "noop" }),
    ChangesetValidationError
  );
});
