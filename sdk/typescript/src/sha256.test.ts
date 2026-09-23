import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Hex } from "./sha256.ts";
import { artifactFingerprint } from "./fingerprint.ts";

// node:crypto is the oracle here and nowhere else — the SDK itself must not import it.
const oracle = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Deterministic PRNG (mulberry32) — property tests must be reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("FIPS 180-4 test vectors", () => {
  const ascii = (s: string) => new TextEncoder().encode(s);
  assert.equal(sha256Hex(ascii("")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex(ascii("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(
    sha256Hex(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
});

test("every length around the padding boundaries matches the platform hash", () => {
  // 55/56 decide whether the length fits the last block; 63/64/65 cross a block.
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 1000, 65536]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
    assert.equal(sha256Hex(bytes), oracle(bytes), `length ${n}`);
  }
});

test("property: 500 seeded random inputs match the platform hash", () => {
  const rnd = mulberry32(0x5a256);
  for (let c = 0; c < 500; c++) {
    const bytes = Uint8Array.from({ length: Math.floor(rnd() * 300) }, () => Math.floor(rnd() * 256));
    assert.equal(sha256Hex(bytes), oracle(bytes), `case ${c}`);
  }
});

test("artifact fingerprints hash UTF-8, including multi-byte and lone surrogates", () => {
  for (const content of ["", "plain", "한글 화면", "emoji 🧪", "lone \ud800 surrogate", "a\r\nb\n"]) {
    const expected = "sha256:" + createHash("sha256").update(content, "utf8").digest("hex");
    assert.equal(artifactFingerprint(content), expected, JSON.stringify(content));
  }
});
