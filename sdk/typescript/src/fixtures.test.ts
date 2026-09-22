import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./canonicalize.ts";
import { applyUnifiedDiff } from "./diff.ts";
import { ChangesetError } from "./errors.ts";
import { fingerprintOf, verifyFingerprint } from "./fingerprint.ts";
import { parseVerifiedDiff } from "./verified-diff.ts";

const fixturesDir = fileURLToPath(new URL("../../../spec/fixtures/", import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(fixturesDir + name, "utf8"));

test("canonicalization fixtures reproduce", () => {
  for (const { name, input, canonical } of load("canonicalization.json")) {
    assert.equal(canonicalize(input), canonical, `vector: ${name}`);
  }
});

test("fingerprint fixtures reproduce", () => {
  for (const { name, document, fingerprint } of load("fingerprint.json")) {
    assert.equal(fingerprintOf(document), fingerprint, `vector: ${name}`);
  }
});

test("gate fixture: approved-valid verifies", () => {
  const { document } = load("gate-approved-valid.json");
  assert.equal(verifyFingerprint(document), true);
  assert.equal(document.approvals[0].fingerprint, document.fingerprint);
});

test("gate fixture: tampered-content must refuse", () => {
  const { document } = load("gate-tampered-content.json");
  assert.equal(verifyFingerprint(document), false);
});

test("validation fixtures reproduce", async () => {
  const { validate } = await import("./validate.ts");
  for (const { name, expect, document } of load("validation.json")) {
    assert.equal(validate(document).valid, expect === "valid", `case: ${name}`);
  }
});

test("base-state tightening fixtures reproduce (spec §4, 0.2)", async () => {
  const { validate } = await import("./validate.ts");
  for (const { name, expect, document } of load("base-state.json")) {
    assert.equal(validate(document).valid, expect === "valid", `case: ${name}`);
  }
});

test("data patch fixtures reproduce (spec §5.3 + §4 data kind, 0.3)", async () => {
  const { validate } = await import("./validate.ts");
  for (const { name, expect, document } of load("data-patch.json")) {
    assert.equal(validate(document).valid, expect === "valid", `case: ${name}`);
  }
});

// Cross-SDK message parity: the exact {path, message} list a document produces
// is part of the contract — the validation error surface is the spec-delivery
// channel for authoring agents. This fixture is byte-identical across the .NET
// and TypeScript SDKs; the assertion is order-sensitive.
test("validation-message fixtures reproduce exact error lists", async () => {
  const { validate } = await import("./validate.ts");
  for (const { name, document, errors } of load("validation-messages.json")) {
    assert.deepEqual(validate(document).errors, errors, `case: ${name}`);
  }
});

test("verified-diff dialect fixtures reproduce (spec §5.2.2)", async () => {
  const { validate } = await import("./validate.ts");
  const { verifyAgainstBase } = await import("./verified-diff.ts");
  for (const c of load("verified-diff.json")) {
    const structuralValid = validate(c.document).valid;
    if (c.layer === "structural") {
      assert.equal(structuralValid, c.expect === "valid", `case: ${c.name} (structural)`);
      continue;
    }
    assert.equal(structuralValid, true, `case: ${c.name} must be structurally valid`);
    const result = verifyAgainstBase(c.patch, c.base);
    if (c.expect === "applies") {
      assert.ok(result.ok, `case: ${c.name} must verify against base`);
      assert.equal(result.ok && result.newContent, c.applied, `case: ${c.name} applied content`);
    } else {
      assert.ok(!result.ok, `case: ${c.name} must be rejected against base`);
    }
  }
});

/**
 * The refusal subject ("outside the verified-diff dialect", "cannot canonicalize",
 * …) is a literal duplicated in both SDKs. Two of the five were already locked by
 * the validation-message vectors; the other three could drift apart without
 * anything failing, because nothing compared them. These vectors compare them.
 *
 * Each `op` is the same probe on both sides. If the inputs ever diverge, the
 * messages diverge with them and this fails on one side — which is the point.
 */
const PROBES: Record<string, (v: any) => unknown> = {
  "verifiedDiff.parse": (v) => parseVerifiedDiff(v.input),
  "unifiedDiff.apply": (v) => applyUnifiedDiff(v.base, v.input),
  "fingerprint.verify": (v) => verifyFingerprint({ fingerprint: v.input, intent: "x" }),
  "canonicalize.nonFinite": () => canonicalize(Number.NaN),
};

test("refusal subjects and messages reproduce across the SDKs", () => {
  for (const vector of load("refusal-subjects.json")) {
    const probe = PROBES[vector.op];
    assert.ok(probe, `unknown probe: ${vector.op}`);
    let thrown: unknown;
    try {
      probe(vector);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof ChangesetError, `vector ${vector.name}: expected a ChangesetError, got ${thrown}`);
    const e = thrown as ChangesetError;
    assert.deepEqual(e.errors, vector.errors, `vector: ${vector.name}`);
    // The subject heads the rendered message; comparing the whole line keeps both
    // the subject and the rendering locked, not just one of them.
    const rendered = vector.errors
      .map((x: { path: string; message: string }) => (x.path === "" ? `  ${x.message}` : `  ${x.path}: ${x.message}`))
      .join("\n");
    assert.equal(e.message, `${vector.subject}:\n${rendered}`, `vector: ${vector.name}`);
  }
});
