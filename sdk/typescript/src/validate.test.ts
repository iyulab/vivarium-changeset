import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createUnifiedDiff } from "./diff.ts";
import { stampFingerprint } from "./fingerprint.ts";
import { validate } from "./validate.ts";

const baseContent = "export function Screen() {\n  return <Form />;\n}";
const newContent = "export function Screen() {\n  return <Form dueDate />;\n}";
const sha = (s: string) => "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");

const validDoc = () => ({
  specVersion: "0.1.0-draft",
  intent: "Add a due-date to the loan screen",
  provenance: { producedBy: "test", createdAt: "2026-07-16T00:00:00Z", baseState: [] },
  patches: {
    schema: [
      { op: "field.add", entity: "loan", field: { name: "dueDate", type: "date" }, explanation: "stores due date" },
    ],
    ui: [
      {
        profile: "whole-artifact@0",
        artifactId: "screen-loans",
        baseFingerprint: sha(baseContent),
        newContent,
        reviewDiff: createUnifiedDiff(baseContent, newContent),
        explanation: "adds the field to the form",
      },
    ],
    data: [],
  },
});

test("a well-formed document validates", () => {
  const r = validate(validDoc());
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
});

test("stamped fingerprint validates; tampered does not", () => {
  const stamped = stampFingerprint(validDoc());
  assert.equal(validate(stamped).valid, true);
  const tampered = { ...stamped, intent: "changed after review" };
  assert.equal(validate(tampered).valid, false);
});

test("unknown top-level member is rejected (closed model)", () => {
  const r = validate({ ...validDoc(), vendorExtra: 1 });
  assert.equal(r.valid, false);
  assert.match(r.errors[0].message, /unknown member/);
});

test("empty facets are rejected", () => {
  const doc = validDoc();
  doc.patches = { schema: [], ui: [], data: [] } as never;
  assert.equal(validate(doc).valid, false);
});

test("missing explanation is rejected", () => {
  const doc = validDoc();
  delete (doc.patches.schema[0] as Record<string, unknown>).explanation;
  assert.equal(validate(doc).valid, false);
});

test("unknown schema op and unknown logical type are rejected", () => {
  const doc = validDoc();
  (doc.patches.schema[0] as Record<string, unknown>).op = "table.drop-all";
  assert.equal(validate(doc).valid, false);
  const doc2 = validDoc();
  ((doc2.patches.schema[0] as Record<string, unknown>).field as Record<string, unknown>).type = "uuid";
  assert.equal(validate(doc2).valid, false);
});

test("inconsistent review diff is rejected (spec §5.2)", () => {
  const doc = validDoc();
  (doc.patches.ui[0] as Record<string, unknown>).baseFingerprint = sha("some other base entirely");
  const r = validate(doc);
  assert.equal(r.valid, false);
  assert.match(r.errors[0].message, /inconsistent|does not apply/);
});

test("creation patch must diff from empty", () => {
  const doc = validDoc();
  const ui = doc.patches.ui[0] as Record<string, unknown>;
  ui.baseFingerprint = null;
  const r = validate(doc); // diff is base→new, not empty→new
  assert.equal(r.valid, false);
  const ok = validDoc();
  const ui2 = ok.patches.ui[0] as Record<string, unknown>;
  ui2.baseFingerprint = null;
  ui2.reviewDiff = createUnifiedDiff("", newContent);
  assert.equal(validate(ok).valid, true);
});

test("duplicate data patch ids are rejected", () => {
  const doc = validDoc();
  doc.patches.data = [
    { id: "seed", explanation: "x", operations: [] },
    { id: "seed", explanation: "y", operations: [] },
  ] as never;
  assert.equal(validate(doc).valid, false);
});
