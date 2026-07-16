/**
 * Line-based unified diff: create, apply, reverse-apply.
 *
 * Exists to implement the spec's UI-patch verification (§5.2): reverse-applying
 * `reviewDiff` to `newContent` recovers the base content, whose fingerprint must
 * match `baseFingerprint`. No "\ No newline" markers; content is treated as a
 * raw string, losslessly split on "\n" ("" ⇒ zero lines).
 */

type Op = { kind: " " | "-" | "+"; line: string };

const toLines = (s: string): string[] => (s === "" ? [] : s.split("\n"));
const fromLines = (lines: string[]): string => lines.join("\n");

/** Longest-common-subsequence keep/del/ins script (DP; fine at artifact scale). */
function script(a: string[], b: string[]): Op[] {
  const m = a.length, n = b.length;
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) ops.push({ kind: " ", line: a[i] }), i++, j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ kind: "-", line: a[i] }), i++;
    else ops.push({ kind: "+", line: b[j] }), j++;
  }
  while (i < m) ops.push({ kind: "-", line: a[i++] });
  while (j < n) ops.push({ kind: "+", line: b[j++] });
  return ops;
}

export function createUnifiedDiff(base: string, next: string, context = 3): string {
  const ops = script(toLines(base), toLines(next));
  if (ops.every((o) => o.kind === " ")) return "";
  // group changed regions with surrounding context into hunks
  const out: string[] = [];
  let idx = 0;
  let aLine = 1, bLine = 1; // 1-based positions of ops[idx] in base/next
  while (idx < ops.length) {
    if (ops[idx].kind === " ") { aLine++; bLine++; idx++; continue; }
    // hunk starts `context` lines before this change
    let start = idx, back = 0;
    while (start > 0 && ops[start - 1].kind === " " && back < context) start--, back++;
    // extend forward until `2*context` consecutive keeps (hunk merge rule) or end
    let end = idx, keeps = 0;
    for (let k = idx; k < ops.length; k++) {
      if (ops[k].kind === " ") { keeps++; if (keeps > 2 * context) break; }
      else { keeps = 0; end = k; }
    }
    const stop = Math.min(ops.length, end + 1 + context);
    const hunk = ops.slice(start, stop);
    const aStart = aLine - back, bStart = bLine - back;
    const aCount = hunk.filter((o) => o.kind !== "+").length;
    const bCount = hunk.filter((o) => o.kind !== "-").length;
    out.push(`@@ -${aCount === 0 ? aStart - 1 : aStart},${aCount} +${bCount === 0 ? bStart - 1 : bStart},${bCount} @@`);
    for (const o of hunk) out.push(o.kind + o.line);
    // cursor = hunk start + hunk extent (the back-context keeps were already
    // counted once by the outer loop — recompute absolutely, don't re-add)
    aLine = aStart + aCount;
    bLine = bStart + bCount;
    idx = stop;
  }
  return out.join("\n") + "\n";
}

interface Hunk { aStart: number; aCount: number; bStart: number; bCount: number; ops: Op[] }

function parseDiff(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  const lines = diff.split("\n");
  let cur: Hunk | null = null;
  for (const raw of lines) {
    const m = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(raw);
    if (m) {
      cur = { aStart: +m[1], aCount: +m[2], bStart: +m[3], bCount: +m[4], ops: [] };
      hunks.push(cur);
    } else if (cur && (raw.startsWith(" ") || raw.startsWith("-") || raw.startsWith("+"))) {
      cur.ops.push({ kind: raw[0] as Op["kind"], line: raw.slice(1) });
    } else if (raw !== "") {
      throw new SyntaxError(`malformed diff line: ${JSON.stringify(raw)}`);
    }
  }
  return hunks;
}

/** Apply a unified diff to `base` (forward). Throws on any mismatch. */
export function applyUnifiedDiff(base: string, diff: string): string {
  if (diff === "") return base;
  const src = toLines(base);
  const out: string[] = [];
  let pos = 0; // 0-based cursor into src
  for (const h of parseDiff(diff)) {
    const start = (h.aCount === 0 ? h.aStart : h.aStart - 1);
    if (start < pos) throw new RangeError("overlapping hunks");
    out.push(...src.slice(pos, start));
    pos = start;
    for (const o of h.ops) {
      if (o.kind === "+") { out.push(o.line); continue; }
      if (src[pos] !== o.line) {
        throw new RangeError(`diff does not match content at line ${pos + 1}`);
      }
      if (o.kind === " ") out.push(o.line);
      pos++;
    }
  }
  out.push(...src.slice(pos));
  return fromLines(out);
}

/** Reverse-apply: given `next` and the base→next diff, recover `base`. */
export function reverseApplyUnifiedDiff(next: string, diff: string): string {
  if (diff === "") return next;
  const swapped = diff
    .split("\n")
    .map((l) => {
      const m = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(l);
      if (m) return `@@ -${m[3]},${m[4]} +${m[1]},${m[2]} @@`;
      if (l.startsWith("-")) return "+" + l.slice(1);
      if (l.startsWith("+")) return "-" + l.slice(1);
      return l;
    })
    .join("\n");
  return applyUnifiedDiff(next, swapped);
}
