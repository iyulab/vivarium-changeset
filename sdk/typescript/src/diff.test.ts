import { test } from "node:test";
import { ChangesetError } from "./errors.ts";
import assert from "node:assert/strict";
import { applyUnifiedDiff, createUnifiedDiff, reverseApplyUnifiedDiff } from "./diff.ts";

/** node:assert's throws() returns nothing, and the whole point here is the payload. */
const refusal = (fn: () => unknown): ChangesetError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ChangesetError) return e;
    throw e;
  }
  throw new Error('expected a ChangesetError');
};

const cases: Array<[string, string, string]> = [
  ["modification", "a\nb\nc\nd\ne\nf\ng", "a\nb\nX\nd\ne\nf\nG"],
  ["creation", "", "line1\nline2"],
  ["deletion-to-empty", "line1\nline2", ""],
  ["append", "a\nb", "a\nb\nc"],
  ["prepend", "b\nc", "a\nb\nc"],
  ["identical", "same\ncontent", "same\ncontent"],
  ["distant-changes", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12", "ONE\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\nTWELVE"],
];

for (const [name, base, next] of cases) {
  test(`round-trip: ${name}`, () => {
    const diff = createUnifiedDiff(base, next);
    assert.equal(applyUnifiedDiff(base, diff), next, "forward apply");
    assert.equal(reverseApplyUnifiedDiff(next, diff), base, "reverse apply");
  });
}

test("identical content produces an empty diff", () => {
  assert.equal(createUnifiedDiff("x\ny", "x\ny"), "");
});

test("mismatched diff refuses to apply", () => {
  const diff = createUnifiedDiff("a\nb\nc", "a\nB\nc");
  const e = refusal(() => applyUnifiedDiff("totally\ndifferent\nbase", diff));
  assert.deepEqual(e.errors, [{ path: "", message: "diff does not match content at line 1" }]);
});
