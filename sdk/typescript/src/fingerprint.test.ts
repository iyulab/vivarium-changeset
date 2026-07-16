import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintOf, stampFingerprint, verifyFingerprint } from "./fingerprint.ts";

const doc = () => ({
  specVersion: "0.1.0",
  intent: "test changeset",
  provenance: { producedBy: "test", createdAt: "2026-07-16T00:00:00Z", baseState: [] },
  patches: { schema: [], ui: [], data: [{ id: "seed", explanation: "seed", operations: [] }] },
});

test("fingerprint has the sha256: hex form", () => {
  assert.match(fingerprintOf(doc()), /^sha256:[0-9a-f]{64}$/);
});

test("approvals and fingerprint members are outside the hash envelope", () => {
  const base = fingerprintOf(doc());
  const withApproval = {
    ...doc(),
    fingerprint: "sha256:" + "0".repeat(64),
    approvals: [{ fingerprint: base, approvedBy: "alice", approvedAt: "2026-07-16T01:00:00Z" }],
  };
  assert.equal(fingerprintOf(withApproval), base);
});

test("stamp then verify round-trips", () => {
  assert.equal(verifyFingerprint(stampFingerprint(doc())), true);
});

test("tampering after stamping is detected", () => {
  const stamped = stampFingerprint(doc());
  const tampered = { ...stamped, intent: "something else entirely" };
  assert.equal(verifyFingerprint(tampered), false);
});

test("documents without a fingerprint do not verify", () => {
  assert.equal(verifyFingerprint(doc()), false);
});

test("unknown fingerprint prefixes are rejected, never guessed", () => {
  const bad = { ...doc(), fingerprint: "md5:abc" };
  assert.throws(() => verifyFingerprint(bad), RangeError);
});
