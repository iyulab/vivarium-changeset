import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./canonicalize.ts";
import { fingerprintOf, verifyFingerprint } from "./fingerprint.ts";

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
