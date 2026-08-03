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
  specVersion: "0.1.0",
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

const withDataOperation = (operation: unknown) => {
  const doc = validDoc();
  doc.patches.data = [{ id: "p1", explanation: "e", operations: [operation] }] as never;
  return doc;
};
const pathsOf = (doc: unknown) => validate(doc).errors.map((e) => e.path);

// spec §5.3 — per-op required members, closed member set, closed `where`.
test("malformed data operations are rejected at the paths that name the fix", () => {
  const cases: Array<[unknown, string]> = [
    [{ op: "update", entity: "loan" }, "$.patches.data[0].operations[0].where"],
    [{ op: "update", entity: "loan" }, "$.patches.data[0].operations[0].set"],
    [{ op: "insert", values: {} }, "$.patches.data[0].operations[0].entity"],
    [{ op: "delete", entity: "", where: { field: "f", equals: 1 } }, "$.patches.data[0].operations[0].entity"],
    [{ op: "insert", entity: "loan", values: {}, limit: 1 }, "$.patches.data[0].operations[0].limit"],
    [{ op: "insert", entity: "loan", values: "nope" }, "$.patches.data[0].operations[0].values"],
    [{ op: "update", entity: "loan", where: { field: "f", equals: 1 }, set: 7 }, "$.patches.data[0].operations[0].set"],
    [{ op: "delete", entity: "loan", where: { sku: "SKU-1" } }, "$.patches.data[0].operations[0].where.sku"],
    [{ op: "delete", entity: "loan", where: { field: "f", equals: [1] } }, "$.patches.data[0].operations[0].where.equals"],
    [{ op: "delete", entity: "loan", where: { field: "", equals: 1 } }, "$.patches.data[0].operations[0].where.field"],
    [{ op: "delete", entity: "loan", where: "sku = 1" }, "$.patches.data[0].operations[0].where"],
  ];
  for (const [operation, path] of cases) {
    assert.ok(pathsOf(withDataOperation(operation)).includes(path), `expected error at ${path} for ${JSON.stringify(operation)}`);
  }
});

test("conforming data operations are accepted", () => {
  const cases: unknown[] = [
    { op: "insert", entity: "loan", values: { amount: 1 } },
    { op: "update", entity: "loan", where: { field: "f", equals: null }, set: { amount: 1 } },
    { op: "delete", entity: "loan", where: { field: "f", equals: true } },
  ];
  for (const operation of cases) {
    const r = validate(withDataOperation(operation));
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  }
});

test("baseState kind 'data' requires specVersion 0.3.0 (spec §4)", () => {
  const doc = validDoc() as Record<string, unknown>;
  (doc.provenance as { baseState: unknown[] }).baseState = [
    { kind: "data", ref: "data", fingerprint: "sha256:" + "d".repeat(64) },
  ];
  doc.specVersion = "0.2.0";
  assert.ok(pathsOf(doc).includes("$.provenance.baseState[0].kind"));
  doc.specVersion = "0.3.0";
  assert.equal(validate(doc).valid, true);
});

test("verified-diff@0 stays allowed above 0.2.0 (gates are floors, not equalities)", () => {
  const doc = validDoc() as Record<string, unknown>;
  doc.specVersion = "0.3.0";
  (doc.patches as Record<string, unknown>).ui = [
    {
      profile: "verified-diff@0",
      artifactId: "screen-loans",
      baseFingerprint: sha(baseContent),
      diff: createUnifiedDiff(baseContent, newContent),
      newFingerprint: sha(newContent),
      explanation: "adds the field to the form",
    },
  ];
  const r = validate(doc);
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test("malformed shapes yield errors, never throw (validator contract)", () => {
  const base = () => validDoc() as unknown as Record<string, unknown>;
  const cases: Array<(d: Record<string, unknown>) => void> = [
    (d) => { (d.patches as Record<string, unknown>).schema = "not-an-array"; },
    (d) => { (d.patches as Record<string, unknown>).ui = 42; },
    (d) => { (d.patches as Record<string, unknown>).data = {}; },
    (d) => { (d.patches as Record<string, unknown>).schema = [null]; },
    (d) => { (d.patches as Record<string, unknown>).ui = ["nope"]; },
    (d) => { (d.patches as Record<string, unknown>).data = [null]; },
    (d) => { (d.patches as Record<string, unknown>).schema = [{ op: "entity.create", entity: "x", fields: [null], explanation: "e" }]; },
    (d) => { (d.patches as Record<string, unknown>).schema = [{ op: "entity.create", entity: "x", fields: 7, explanation: "e" }]; },
    (d) => { (d.patches as Record<string, unknown>).data = [{ id: "p", explanation: "e", operations: [null] }]; },
    (d) => { d.approvals = [null]; },
    (d) => { d.approvals = ["str"]; },
  ];
  for (const [i, mutate] of cases.entries()) {
    const doc = base();
    mutate(doc);
    const r = validate(doc); // must not throw
    assert.equal(r.valid, false, `case ${i} should be invalid`);
  }
});
