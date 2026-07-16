import { test } from "node:test";
import assert from "node:assert/strict";
import { applyUnifiedDiff, createUnifiedDiff, reverseApplyUnifiedDiff } from "./diff.ts";

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
  assert.throws(() => applyUnifiedDiff("totally\ndifferent\nbase", diff), RangeError);
});
