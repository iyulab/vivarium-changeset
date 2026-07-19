using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Vivarium.Changeset;

/// <summary>
/// Result of layer-2 complete verification (spec §8): on success,
/// <see cref="NewContent"/> is exactly what the reviewer's diff described.
/// </summary>
public sealed record VerifyAgainstBaseResult(bool Ok, string? NewContent, IReadOnlyList<ValidationError> Errors);

/// <summary>
/// <c>verified-diff@0</c> dialect (spec §5.2.2): strict unified diff with
/// exact 1-based line numbers, no fuzz, no partial application, byte-faithful
/// newline handling (LF splits, CR is content, EOF-without-newline via the
/// <c>\ No newline at end of file</c> marker).
///
/// Deliberately separate from <see cref="UnifiedDiff"/>: <c>reviewDiff</c>
/// (whole-artifact@0) uses a lossless-split line model without markers;
/// mixing the two dialects in one engine would let documents of one profile
/// validate under the other's rules.
/// </summary>
public static partial class VerifiedDiff
{
    private const string NoEofMarker = "\\ No newline at end of file";

    [GeneratedRegex(@"^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$")]
    private static partial Regex HunkHeader();

    private sealed record Content(List<string> Lines, bool NoEof);

    private sealed class DiffOp
    {
        public char Kind;
        public required string Line;
        public bool NoEofBase;
        public bool NoEofNew;
    }

    private sealed class Hunk
    {
        public int AStart, ACount, BStart, BCount;
        public List<DiffOp> Ops = [];
    }

    private static Content ToContent(string s)
    {
        if (s.Length == 0) return new Content([], false);
        var parts = s.Split('\n').ToList();
        var noEof = parts[^1] != "";
        if (!noEof) parts.RemoveAt(parts.Count - 1);
        return new Content(parts, noEof);
    }

    private static string FromContent(Content c) =>
        c.Lines.Count == 0 ? "" : string.Join("\n", c.Lines) + (c.NoEof ? "" : "\n");

    /// <summary>
    /// Parse and structurally validate a verified-diff dialect string.
    /// Throws <see cref="FormatException"/> on anything outside the dialect
    /// (spec: fail-closed).
    /// </summary>
    private static List<Hunk> Parse(string diff)
    {
        if (string.IsNullOrEmpty(diff))
            throw new FormatException("empty diff: at least one hunk is required (no-op prohibition)");
        var raw = diff.Split('\n').ToList();
        if (raw[^1] == "") raw.RemoveAt(raw.Count - 1); // single trailing LF terminator
        var hunks = new List<Hunk>();
        Hunk? cur = null;
        DiffOp? lastOp = null;
        foreach (var line in raw)
        {
            var m = HunkHeader().Match(line);
            if (m.Success)
            {
                cur = new Hunk
                {
                    AStart = int.Parse(m.Groups[1].Value),
                    ACount = int.Parse(m.Groups[2].Value),
                    BStart = int.Parse(m.Groups[3].Value),
                    BCount = int.Parse(m.Groups[4].Value),
                };
                hunks.Add(cur);
                lastOp = null;
                continue;
            }
            if (line == NoEofMarker)
            {
                if (lastOp is null) throw new FormatException("no-newline marker without a preceding hunk line");
                if (lastOp.Kind == ' ') { lastOp.NoEofBase = true; lastOp.NoEofNew = true; }
                else if (lastOp.Kind == '-') lastOp.NoEofBase = true;
                else lastOp.NoEofNew = true;
                lastOp = null; // a second consecutive marker is malformed
                continue;
            }
            if (cur is null) throw new FormatException($"content before first hunk header: \"{line}\"");
            var kind = line.Length > 0 ? line[0] : '\0';
            if (kind is ' ' or '-' or '+')
            {
                lastOp = new DiffOp { Kind = kind, Line = line[1..] };
                cur.Ops.Add(lastOp);
                continue;
            }
            throw new FormatException($"line outside the dialect (no file headers, no garbage): \"{line}\"");
        }
        if (hunks.Count == 0) throw new FormatException("no hunks found");
        var prevEnd = 0; // 0-based exclusive end of the previous hunk's base range
        foreach (var h in hunks)
        {
            if (h.Ops.Count == 0) throw new FormatException("empty hunk");
            var aCount = h.Ops.Count(o => o.Kind != '+');
            var bCount = h.Ops.Count(o => o.Kind != '-');
            if (h.ACount != aCount || h.BCount != bCount)
                throw new FormatException($"hunk header counts (-{h.ACount},+{h.BCount}) do not match body (-{aCount},+{bCount})");
            if (h.ACount > 0 && h.AStart < 1) throw new FormatException("aStart must be >= 1 for non-empty base range");
            var start = h.ACount == 0 ? h.AStart : h.AStart - 1;
            if (start < prevEnd) throw new FormatException("hunks must be ascending and non-overlapping");
            prevEnd = start + h.ACount;
        }
        return hunks;
    }

    /// <summary>Structural dialect check without application (layer 1).</summary>
    public static void ParseStrict(string diff) => Parse(diff);

    /// <summary>
    /// Deterministic fail-closed application (spec §5.2.2): every context and
    /// deletion line must equal the base line at its exact stated position,
    /// byte for byte, including EOF-newline state. Throws
    /// <see cref="FormatException"/> (dialect) or
    /// <see cref="InvalidOperationException"/> (mismatch).
    /// </summary>
    public static string Apply(string baseContent, string diff)
    {
        var hunks = Parse(diff);
        var src = ToContent(baseContent);
        var outLines = new List<string>();
        var outNoEof = false;
        var pos = 0; // 0-based cursor into src.Lines

        void Emit(string line, bool incomplete)
        {
            if (outNoEof) throw new InvalidOperationException("line after the no-newline marker on the new side");
            outLines.Add(line);
            if (incomplete) outNoEof = true;
        }

        foreach (var h in hunks)
        {
            var start = h.ACount == 0 ? h.AStart : h.AStart - 1;
            if (start > src.Lines.Count) throw new InvalidOperationException($"hunk at base line {h.AStart} starts beyond end of base");
            while (pos < start)
            {
                Emit(src.Lines[pos], src.NoEof && pos == src.Lines.Count - 1);
                pos++;
            }
            foreach (var o in h.Ops)
            {
                if (o.Kind == '+') { Emit(o.Line, o.NoEofNew); continue; }
                if (pos >= src.Lines.Count) throw new InvalidOperationException("hunk extends past end of base");
                if (src.Lines[pos] != o.Line)
                    throw new InvalidOperationException($"base mismatch at line {pos + 1} (exact-match dialect; no fuzz)");
                var baseIncomplete = src.NoEof && pos == src.Lines.Count - 1;
                if (baseIncomplete != o.NoEofBase)
                    throw new InvalidOperationException($"newline state mismatch at base line {pos + 1}");
                if (o.Kind == ' ') Emit(o.Line, o.NoEofNew);
                pos++;
            }
        }
        while (pos < src.Lines.Count)
        {
            Emit(src.Lines[pos], src.NoEof && pos == src.Lines.Count - 1);
            pos++;
        }
        return FromContent(new Content(outLines, outLines.Count > 0 && outNoEof));
    }

    /// <summary>
    /// Reference emitter for the dialect (LCS, line-based). The final
    /// incomplete line is tokenized distinctly from its complete twin so that
    /// a change in EOF-newline state alone still produces a hunk. Returns ""
    /// for identical contents — the caller must not emit a patch (no-op ban).
    /// </summary>
    public static string Create(string baseContent, string newContent, int context = 3)
    {
        var a = ToContent(baseContent);
        var b = ToContent(newContent);
        static string[] Tokens(Content c) =>
            [.. c.Lines.Select((l, i) => (c.NoEof && i == c.Lines.Count - 1 ? "I" : "C") + l)];
        var ta = Tokens(a);
        var tb = Tokens(b);
        int m = ta.Length, n = tb.Length;
        var dp = new uint[m + 1, n + 1];
        for (var i = m - 1; i >= 0; i--)
            for (var j = n - 1; j >= 0; j--)
                dp[i, j] = ta[i] == tb[j] ? dp[i + 1, j + 1] + 1 : Math.Max(dp[i + 1, j], dp[i, j + 1]);
        var ops = new List<(char Kind, string Token)>();
        int x = 0, y = 0;
        while (x < m && y < n)
        {
            if (ta[x] == tb[y]) { ops.Add((' ', ta[x])); x++; y++; }
            else if (dp[x + 1, y] >= dp[x, y + 1]) { ops.Add(('-', ta[x])); x++; }
            else { ops.Add(('+', tb[y])); y++; }
        }
        while (x < m) ops.Add(('-', ta[x++]));
        while (y < n) ops.Add(('+', tb[y++]));
        if (ops.All(o => o.Kind == ' ')) return "";

        var outText = new List<string>();
        var idx = 0;
        int aLine = 1, bLine = 1;
        while (idx < ops.Count)
        {
            if (ops[idx].Kind == ' ') { aLine++; bLine++; idx++; continue; }
            int start = idx, back = 0;
            while (start > 0 && ops[start - 1].Kind == ' ' && back < context) { start--; back++; }
            int end = idx, keeps = 0;
            for (var k = idx; k < ops.Count; k++)
            {
                if (ops[k].Kind == ' ') { keeps++; if (keeps > 2 * context) break; }
                else { keeps = 0; end = k; }
            }
            var stop = Math.Min(ops.Count, end + 1 + context);
            var hunk = ops[start..stop];
            int aStart = aLine - back, bStart = bLine - back;
            var aCount = hunk.Count(o => o.Kind != '+');
            var bCount = hunk.Count(o => o.Kind != '-');
            outText.Add($"@@ -{(aCount == 0 ? aStart - 1 : aStart)},{aCount} +{(bCount == 0 ? bStart - 1 : bStart)},{bCount} @@");
            foreach (var o in hunk)
            {
                outText.Add(o.Kind + o.Token[1..]);
                if (o.Token[0] == 'I') outText.Add(NoEofMarker);
            }
            aLine = aStart + aCount;
            bLine = bStart + bCount;
            idx = stop;
        }
        return string.Join("\n", outText) + "\n";
    }

    /// <summary>
    /// Layer-2 complete verification (spec §8), given the base artifact
    /// content: ① fingerprint(base) equals <c>baseFingerprint</c>,
    /// ② deterministic application succeeds and fingerprint(result) equals
    /// <c>newFingerprint</c>. Appliers MUST run this before applying.
    /// Reports, never throws.
    /// </summary>
    public static VerifyAgainstBaseResult VerifyAgainstBase(JsonObject patch, string baseContent)
    {
        var errors = new List<ValidationError>();
        static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
        if (ChangesetFingerprint.OfArtifact(baseContent) != Str(patch["baseFingerprint"]))
        {
            errors.Add(new ValidationError("$.baseFingerprint",
                "supplied base content does not match baseFingerprint (spec §8 layer 2 ①)"));
            return new VerifyAgainstBaseResult(false, null, errors);
        }
        string newContent;
        try
        {
            newContent = Apply(baseContent, Str(patch["diff"]) ?? "");
        }
        catch (Exception e) when (e is FormatException or InvalidOperationException)
        {
            errors.Add(new ValidationError("$.diff", $"diff does not apply to base: {e.Message}"));
            return new VerifyAgainstBaseResult(false, null, errors);
        }
        if (ChangesetFingerprint.OfArtifact(newContent) != Str(patch["newFingerprint"]))
        {
            errors.Add(new ValidationError("$.newFingerprint",
                "applied result does not match newFingerprint (spec §8 layer 2 ②)"));
            return new VerifyAgainstBaseResult(false, null, errors);
        }
        return new VerifyAgainstBaseResult(true, newContent, errors);
    }
}
