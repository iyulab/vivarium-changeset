import { test } from "node:test";
import assert from "node:assert/strict";
import { applyUnifiedDiff, createUnifiedDiff, reverseApplyUnifiedDiff } from "./diff.ts";

/** Deterministic PRNG (mulberry32) — property tests must be reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(0x5eed);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const words = ["alpha", "beta", "", "  indented", "line", "duplicate", "duplicate", "x=1", "}"];

function randomContent(maxLines: number): string {
  const n = Math.floor(rnd() * (maxLines + 1));
  return Array.from({ length: n }, () => pick(words)).join("\n");
}

function mutate(content: string): string {
  const lines = content === "" ? [] : content.split("\n");
  const times = 1 + Math.floor(rnd() * 4);
  for (let k = 0; k < times; k++) {
    const op = pick(["ins", "del", "mod"]);
    const i = Math.floor(rnd() * (lines.length + (op === "ins" ? 1 : 0)));
    if (op === "ins") lines.splice(i, 0, pick(words));
    else if (lines.length > 0 && op === "del") lines.splice(Math.min(i, lines.length - 1), 1);
    else if (lines.length > 0) lines[Math.min(i, lines.length - 1)] = pick(words) + "!";
  }
  return lines.join("\n");
}

test("property: diff round-trips for 300 seeded random pairs", () => {
  for (let c = 0; c < 300; c++) {
    const base = randomContent(30);
    const next = rnd() < 0.5 ? mutate(base) : randomContent(30);
    const diff = createUnifiedDiff(base, next);
    assert.equal(applyUnifiedDiff(base, diff), next, `forward, case ${c}`);
    assert.equal(reverseApplyUnifiedDiff(next, diff), base, `reverse, case ${c}`);
  }
});
