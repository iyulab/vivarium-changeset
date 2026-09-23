import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The SDK is documented to load in any ES module runtime, browsers included. A single
// `node:` import (or a Node-only global) anywhere in the shipped sources breaks that for
// every consumer at once, and nothing else in this suite would notice: every other test
// runs under Node, where the import succeeds.
test("shipped sources use no Node-only module or global", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const shipped = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(shipped.length > 0);
  const offenders: string[] = [];
  for (const file of shipped) {
    const code = readFileSync(dir + file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const [pattern, what] of [
      [/\bfrom\s+["']node:/, "a node: import"],
      [/\bimport\s*\(\s*["']node:/, "a dynamic node: import"],
      [/\brequire\s*\(/, "require()"],
      [/\bBuffer\b/, "the Buffer global"],
      [/\bprocess\./, "the process global"],
    ] as const) {
      if (pattern.test(code)) offenders.push(`${file}: ${what}`);
    }
  }
  assert.deepEqual(offenders, []);
});
