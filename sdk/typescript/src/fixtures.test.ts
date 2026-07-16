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
