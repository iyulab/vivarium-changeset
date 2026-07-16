import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize } from "./canonicalize.ts";

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

test("I-JSON violations are rejected", () => {
  assert.throws(() => canonicalize(Number.NaN), RangeError);
  assert.throws(() => canonicalize(Infinity), RangeError);
});

test("non-JSON values are rejected", () => {
  assert.throws(() => canonicalize(() => 1), TypeError);
});
