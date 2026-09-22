import { test } from "node:test";
import { ChangesetError } from "./errors.ts";
import assert from "node:assert/strict";
import { canonicalize } from "./canonicalize.ts";

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

test("number serialization follows ES semantics (JCS normative form)", () => {
  assert.equal(canonicalize(4.5), "4.5");
  assert.equal(canonicalize(1e30), "1e+30");
  assert.equal(canonicalize(2e-3), "0.002");
  assert.equal(canonicalize(10.0), "10");
  assert.equal(canonicalize(-0), "0");
});

test("member ordering is insertion-order independent (UTF-16 code unit sort)", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({ a: 2, b: 1 }), '{"a":2,"b":1}');
  // "z" (U+007A) sorts before "é" (U+00E9) in code-unit order
  assert.equal(canonicalize({ "é": 1, z: 2 }), '{"z":2,"é":1}');
});

test("undefined members are dropped; undefined array items become null", () => {
  assert.equal(canonicalize({ a: 1, gone: undefined }), '{"a":1}');
  assert.equal(canonicalize([1, undefined, 3]), "[1,null,3]");
});

test("nested structures canonicalize recursively", () => {
  assert.equal(
    canonicalize({ outer: { b: [true, null], a: "x" } }),
    '{"outer":{"a":"x","b":[true,null]}}'
  );
});

// These used to assert the built-in type (RangeError / TypeError), which told a
// caller nothing it could act on. What matters is that the refusal carries the
// same located-failure list every other refusal in this SDK carries.
test("I-JSON violations are rejected", () => {
  for (const value of [Number.NaN, Infinity]) {
    const e = refusal(() => canonicalize(value));
    assert.deepEqual(e.errors, [{ path: "", message: "I-JSON forbids NaN and Infinity (spec ADR-0001)" }]);
  }
});

test("non-JSON values are rejected", () => {
  const e = refusal(() => canonicalize(() => 1));
  assert.deepEqual(e.errors, [{ path: "", message: "value is not JSON-representable: function" }]);
});
