/**
 * `verified-diff@0` dialect (spec §5.2.2): strict unified diff with exact
 * 1-based line numbers, no fuzz, no partial application, byte-faithful
 * newline handling (LF splits, CR is content, EOF-without-newline via the
 * `\ No newline at end of file` marker).
 *
 * Deliberately separate from ./diff.ts: `reviewDiff` (whole-artifact@0)
 * uses a lossless-split line model without markers; mixing the two dialects
 * in one engine would let documents of one profile validate under the
 * other's rules.
 */

import { artifactFingerprint } from "./fingerprint.ts";
import type { ValidationError } from "./validate.ts";

const NO_EOF_MARKER = "\\ No newline at end of file";
const HEADER = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/;

interface Content { lines: string[]; noEof: boolean }

const toContent = (s: string): Content => {
  if (s === "") return { lines: [], noEof: false };
  const parts = s.split("\n");
  const noEof = parts[parts.length - 1] !== "";
  if (!noEof) parts.pop();
  return { lines: parts, noEof };
};

const fromContent = (c: Content): string =>
  c.lines.length === 0 ? "" : c.lines.join("\n") + (c.noEof ? "" : "\n");

interface DiffOp { kind: " " | "-" | "+"; line: string; noEofBase?: boolean; noEofNew?: boolean }
interface Hunk { aStart: number; aCount: number; bStart: number; bCount: number; ops: DiffOp[] }

/**
 * Parse and structurally validate a verified-diff dialect string.
 * Throws SyntaxError on anything outside the dialect (spec: fail-closed).
 */
export function parseVerifiedDiff(diff: string): Hunk[] {
  if (typeof diff !== "string" || diff === "") {
    throw new SyntaxError("empty diff: at least one hunk is required (no-op prohibition)");
  }
  const raw = diff.split("\n");
  if (raw[raw.length - 1] === "") raw.pop(); // single trailing LF terminator
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let lastOp: DiffOp | null = null;
  for (const line of raw) {
    const m = HEADER.exec(line);
    if (m) {
      cur = { aStart: +m[1], aCount: +m[2], bStart: +m[3], bCount: +m[4], ops: [] };
      hunks.push(cur);
      lastOp = null;
      continue;
    }
    if (line === NO_EOF_MARKER) {
      if (!lastOp) throw new SyntaxError("no-newline marker without a preceding hunk line");
      if (lastOp.kind === " ") { lastOp.noEofBase = true; lastOp.noEofNew = true; }
      else if (lastOp.kind === "-") lastOp.noEofBase = true;
      else lastOp.noEofNew = true;
      lastOp = null; // a second consecutive marker is malformed
      continue;
    }
    if (!cur) throw new SyntaxError(`content before first hunk header: ${JSON.stringify(line)}`);
    const kind = line[0];
    if (kind === " " || kind === "-" || kind === "+") {
      lastOp = { kind, line: line.slice(1) };
      cur.ops.push(lastOp);
      continue;
    }
    throw new SyntaxError(`line outside the dialect (no file headers, no garbage): ${JSON.stringify(line)}`);
  }
  if (hunks.length === 0) throw new SyntaxError("no hunks found");
  // counts, ordering, overlap
  let prevEnd = 0; // 0-based exclusive end of the previous hunk's base range
  for (const h of hunks) {
    if (h.ops.length === 0) throw new SyntaxError("empty hunk");
    const aCount = h.ops.filter((o) => o.kind !== "+").length;
    const bCount = h.ops.filter((o) => o.kind !== "-").length;
    if (h.aCount !== aCount || h.bCount !== bCount) {
      throw new SyntaxError(`hunk header counts (-${h.aCount},+${h.bCount}) do not match body (-${aCount},+${bCount})`);
    }
    if (h.aCount > 0 && h.aStart < 1) throw new SyntaxError("aStart must be >= 1 for non-empty base range");
    const start = h.aCount === 0 ? h.aStart : h.aStart - 1;
    if (start < prevEnd) throw new SyntaxError("hunks must be ascending and non-overlapping");
    prevEnd = start + h.aCount;
  }
  return hunks;
}

/**
 * Deterministic fail-closed application (spec §5.2.2): every context and
 * deletion line must equal the base line at its exact stated position, byte
 * for byte, including EOF-newline state. Throws on any mismatch.
 */
export function applyVerifiedDiff(base: string, diff: string): string {
  const hunks = parseVerifiedDiff(diff);
  const src = toContent(base);
  const out: string[] = [];
  let outNoEof = false;
  let pos = 0; // 0-based cursor into src.lines
  const emit = (line: string, incomplete: boolean) => {
    if (outNoEof) throw new RangeError("line after the no-newline marker on the new side");
    out.push(line);
    if (incomplete) outNoEof = true;
  };
  for (const h of hunks) {
    const start = h.aCount === 0 ? h.aStart : h.aStart - 1;
    if (start > src.lines.length) throw new RangeError(`hunk at base line ${h.aStart} starts beyond end of base`);
    while (pos < start) {
      emit(src.lines[pos], src.noEof && pos === src.lines.length - 1);
      pos++;
    }
    for (const o of h.ops) {
      if (o.kind === "+") { emit(o.line, o.noEofNew === true); continue; }
      if (pos >= src.lines.length) throw new RangeError("hunk extends past end of base");
      if (src.lines[pos] !== o.line) {
        throw new RangeError(`base mismatch at line ${pos + 1} (exact-match dialect; no fuzz)`);
      }
      const baseIncomplete = src.noEof && pos === src.lines.length - 1;
      if (baseIncomplete !== (o.noEofBase === true)) {
        throw new RangeError(`newline state mismatch at base line ${pos + 1}`);
      }
      if (o.kind === " ") emit(o.line, o.noEofNew === true);
      pos++;
    }
  }
  while (pos < src.lines.length) {
    emit(src.lines[pos], src.noEof && pos === src.lines.length - 1);
    pos++;
  }
  return fromContent({ lines: out, noEof: out.length > 0 && outNoEof });
}

/**
 * Reference emitter for the dialect (LCS, line-based). The final incomplete
 * line is tokenized distinctly from its complete twin so that a change in
 * EOF-newline state alone still produces a hunk.
 */
export function createVerifiedDiff(base: string, next: string, context = 3): string {
  const a = toContent(base);
  const b = toContent(next);
  const tokens = (c: Content): string[] =>
    c.lines.map((l, i) => (c.noEof && i === c.lines.length - 1 ? "I" : "C") + l);
  const ta = tokens(a), tb = tokens(b);
  const m = ta.length, n = tb.length;
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  type Tok = { kind: " " | "-" | "+"; token: string };
  const ops: Tok[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (ta[i] === tb[j]) { ops.push({ kind: " ", token: ta[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ kind: "-", token: ta[i] }); i++; }
    else { ops.push({ kind: "+", token: tb[j] }); j++; }
  }
  while (i < m) ops.push({ kind: "-", token: ta[i++] });
  while (j < n) ops.push({ kind: "+", token: tb[j++] });
  if (ops.every((o) => o.kind === " ")) return ""; // no-op: caller must not emit a patch
  const out: string[] = [];
  let idx = 0, aLine = 1, bLine = 1;
  while (idx < ops.length) {
    if (ops[idx].kind === " ") { aLine++; bLine++; idx++; continue; }
    let start = idx, back = 0;
    while (start > 0 && ops[start - 1].kind === " " && back < context) { start--; back++; }
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
    for (const o of hunk) {
      out.push(o.kind + o.token.slice(1));
      const incomplete = o.token[0] === "I";
      if (incomplete) out.push(NO_EOF_MARKER);
    }
    aLine = aStart + aCount;
    bLine = bStart + bCount;
    idx = stop;
  }
  return out.join("\n") + "\n";
}

export interface VerifiedDiffUiPatch {
  profile: "verified-diff@0";
  artifactId: string;
  baseFingerprint: string;
  diff: string;
  newFingerprint: string;
  explanation: string;
}

export type VerifyAgainstBaseResult =
  | { ok: true; newContent: string }
  | { ok: false; errors: ValidationError[] };

/**
 * Layer-2 complete verification (spec §8), given the base artifact content:
 * ① fingerprint(base) === baseFingerprint, ② deterministic application
 * succeeds and fingerprint(result) === newFingerprint. Appliers MUST run
 * this before applying. Reports, never throws.
 */
export function verifyAgainstBase(
  patch: VerifiedDiffUiPatch,
  baseContent: string
): VerifyAgainstBaseResult {
  const errors: ValidationError[] = [];
  if (artifactFingerprint(baseContent) !== patch.baseFingerprint) {
    errors.push({
      path: "$.baseFingerprint",
      message: "supplied base content does not match baseFingerprint (spec §8 layer 2 ①)",
    });
    return { ok: false, errors };
  }
  let newContent: string;
  try {
    newContent = applyVerifiedDiff(baseContent, patch.diff);
  } catch (e) {
    errors.push({ path: "$.diff", message: `diff does not apply to base: ${(e as Error).message}` });
    return { ok: false, errors };
  }
  if (artifactFingerprint(newContent) !== patch.newFingerprint) {
    errors.push({
      path: "$.newFingerprint",
      message: "applied result does not match newFingerprint (spec §8 layer 2 ②)",
    });
    return { ok: false, errors };
  }
  return { ok: true, newContent };
}
