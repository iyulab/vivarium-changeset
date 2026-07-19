import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyVerifiedDiff,
  createVerifiedDiff,
  parseVerifiedDiff,
  verifyAgainstBase,
  type VerifiedDiffUiPatch,
} from "./verified-diff.ts";
import { artifactFingerprint } from "./fingerprint.ts";

const roundTrip = (base: string, next: string) => {
  const diff = createVerifiedDiff(base, next);
  assert.notEqual(diff, "", "expected a non-empty diff for differing contents");
  assert.equal(applyVerifiedDiff(base, diff), next);
  return diff;
};

test("round-trip: simple line change", () => {
  roundTrip("a\nb\nc\n", "a\nB\nc\n");
});

test("round-trip: insertion at start and deletion at end", () => {
  roundTrip("a\nb\n", "x\na\nb\n");
  roundTrip("a\nb\nc\n", "a\nb\n");
});

test("round-trip: mixed CRLF/LF is byte-faithful", () => {
  const base = "alpha\r\nbeta\ngamma\r\n";
  const next = "alpha\r\nbeta2\ngamma\r\n";
  const diff = roundTrip(base, next);
  assert.ok(diff.includes("-beta\n+beta2\n"), "CR must stay on CRLF lines only");
  assert.ok(diff.includes(" alpha\r\n"), "context line preserves its CR byte");
});

test("round-trip: no newline at end of file (both sides)", () => {
  const diff = roundTrip("line1\nline2", "line1\nline2!");
  const markers = diff.split("\n").filter((l) => l === "\\ No newline at end of file");
  assert.equal(markers.length, 2, "marker after the deleted and the added final line");
});

test("round-trip: EOF-newline state change alone produces a hunk", () => {
  roundTrip("a\nb", "a\nb\n");
  roundTrip("a\nb\n", "a\nb");
});

test("round-trip: appending after an incomplete final line", () => {
  roundTrip("a\nb", "a\nb\nc");
});

test("round-trip: empty base (creation-like content growth is still expressible)", () => {
  // structurally the dialect can express it; the *profile* forbids creation
  // via baseFingerprint null — that is validate()'s job, not the engine's.
  roundTrip("", "a\n");
  roundTrip("a\n", "");
});

test("create returns empty string for identical contents (caller must not emit)", () => {
  assert.equal(createVerifiedDiff("same\n", "same\n"), "");
});

test("apply is fail-closed: context mismatch", () => {
  const diff = "@@ -1,1 +1,1 @@\n-not-the-base\n+x\n";
  assert.throws(() => applyVerifiedDiff("actual\n", diff), /base mismatch/);
});

test("apply is fail-closed: no fuzz — exact line numbers required", () => {
  // hunk claims line 2 but the matching content is at line 1
  const diff = "@@ -2,1 +2,1 @@\n-a\n+A\n";
  assert.throws(() => applyVerifiedDiff("a\nb\n", diff), /base mismatch/);
});

test("apply is fail-closed: newline-state mismatch at EOF", () => {
  // base ends WITH newline, diff claims the deleted line was incomplete
  const diff = "@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n";
  assert.throws(() => applyVerifiedDiff("a\n", diff), /newline state mismatch/);
});

test("parse rejects: empty diff, headers, garbage, count mismatch, overlap", () => {
  assert.throws(() => parseVerifiedDiff(""), /at least one hunk/);
  assert.throws(() => parseVerifiedDiff("--- a\n+++ b\n@@ -1,1 +1,1 @@\n-a\n+b\n"), /outside the dialect|content before/);
  assert.throws(() => parseVerifiedDiff("@@ -1,1 +1,1 @@\n-a\n+b\ngarbage\n"), /outside the dialect/);
  assert.throws(() => parseVerifiedDiff("@@ -1,2 +1,1 @@\n-a\n+b\n"), /do not match body/);
  assert.throws(
    () => parseVerifiedDiff("@@ -1,1 +1,1 @@\n-a\n+A\n@@ -1,1 +2,1 @@\n-a\n+B\n"),
    /ascending and non-overlapping/
  );
});

test("parse rejects: git-style omitted counts are outside the dialect", () => {
  assert.throws(() => parseVerifiedDiff("@@ -1 +1 @@\n-a\n+b\n"), /outside the dialect|content before/);
});

test("property: random contents round-trip byte-exact", () => {
  // deterministic PRNG — fixtures stay reproducible, no Math.random
  let seed = 0xC0FFEE;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const alphabet = ["a", "b", "line", "x\r", "", "é€"];
  const randContent = () => {
    const n = Math.floor(rand() * 8);
    const lines = Array.from({ length: n }, () => alphabet[Math.floor(rand() * alphabet.length)]);
    let s = lines.join("\n");
    if (s !== "" && rand() < 0.7) s += "\n";
    return s;
  };
  for (let i = 0; i < 200; i++) {
    const base = randContent();
    const next = randContent();
    if (base === next) continue;
    const diff = createVerifiedDiff(base, next);
    assert.equal(applyVerifiedDiff(base, diff), next, `case ${i}: ${JSON.stringify({ base, next, diff })}`);
  }
});

test("verifyAgainstBase: layer-2 semantics", () => {
  const base = "const title = \"Loans\";\n";
  const next = "const title = \"Active loans\";\n";
  const patch: VerifiedDiffUiPatch = {
    profile: "verified-diff@0",
    artifactId: "screen-loans",
    baseFingerprint: artifactFingerprint(base),
    diff: createVerifiedDiff(base, next),
    newFingerprint: artifactFingerprint(next),
    explanation: "Rename the title",
  };
  const ok = verifyAgainstBase(patch, base);
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.newContent, next);

  const drifted = verifyAgainstBase(patch, "const title = \"Loans\"; // drifted\n");
  assert.ok(!drifted.ok && drifted.errors[0].message.includes("layer 2 ①"));

  const wrongNew = verifyAgainstBase({ ...patch, newFingerprint: artifactFingerprint("something else") }, base);
  assert.ok(!wrongNew.ok && wrongNew.errors[0].message.includes("layer 2 ②"));

  const badDiff = verifyAgainstBase({ ...patch, diff: "@@ -1,1 +1,1 @@\n-nope\n+x\n" }, base);
  assert.ok(!badDiff.ok && badDiff.errors[0].message.includes("does not apply"));
});
