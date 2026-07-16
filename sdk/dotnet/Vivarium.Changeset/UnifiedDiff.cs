using System.Text.RegularExpressions;

namespace Vivarium.Changeset;

/// <summary>
/// Line-based unified diff: create, apply, reverse-apply.
///
/// Exists to implement the spec's UI-patch verification (§5.2): reverse-applying
/// <c>reviewDiff</c> to <c>newContent</c> recovers the base content, whose
/// fingerprint must match <c>baseFingerprint</c>. No "\ No newline" markers;
/// content is treated as a raw string, losslessly split on "\n" ("" ⇒ zero lines).
/// </summary>
public static partial class UnifiedDiff
{
    private readonly record struct Op(char Kind, string Line);

    [GeneratedRegex(@"^@@ -(\d+),(\d+) \+(\d+),(\d+) @@")]
    private static partial Regex HunkHeader();

    private static string[] ToLines(string s) => s.Length == 0 ? [] : s.Split('\n');

    /// <summary>Longest-common-subsequence keep/del/ins script (DP; fine at artifact scale).</summary>
    private static List<Op> Script(string[] a, string[] b)
    {
        int m = a.Length, n = b.Length;
        var dp = new uint[m + 1, n + 1];
        for (var i = m - 1; i >= 0; i--)
            for (var j = n - 1; j >= 0; j--)
                dp[i, j] = a[i] == b[j] ? dp[i + 1, j + 1] + 1 : Math.Max(dp[i + 1, j], dp[i, j + 1]);
        var ops = new List<Op>();
        int x = 0, y = 0;
        while (x < m && y < n)
        {
            if (a[x] == b[y]) { ops.Add(new Op(' ', a[x])); x++; y++; }
            else if (dp[x + 1, y] >= dp[x, y + 1]) { ops.Add(new Op('-', a[x])); x++; }
            else { ops.Add(new Op('+', b[y])); y++; }
        }
        while (x < m) ops.Add(new Op('-', a[x++]));
        while (y < n) ops.Add(new Op('+', b[y++]));
        return ops;
    }

    public static string Create(string baseContent, string next, int context = 3)
    {
        var ops = Script(ToLines(baseContent), ToLines(next));
        if (ops.TrueForAll(o => o.Kind == ' ')) return "";
        var outLines = new List<string>();
        var idx = 0;
        int aLine = 1, bLine = 1; // 1-based positions of ops[idx] in base/next
        while (idx < ops.Count)
        {
            if (ops[idx].Kind == ' ') { aLine++; bLine++; idx++; continue; }
            // hunk starts `context` lines before this change
            int start = idx, back = 0;
            while (start > 0 && ops[start - 1].Kind == ' ' && back < context) { start--; back++; }
            // extend forward until `2*context` consecutive keeps (hunk merge rule) or end
            int end = idx, keeps = 0;
            for (var k = idx; k < ops.Count; k++)
            {
                if (ops[k].Kind == ' ') { keeps++; if (keeps > 2 * context) break; }
                else { keeps = 0; end = k; }
            }
            var stop = Math.Min(ops.Count, end + 1 + context);
            var hunk = ops.GetRange(start, stop - start);
            int aStart = aLine - back, bStart = bLine - back;
            var aCount = hunk.Count(o => o.Kind != '+');
            var bCount = hunk.Count(o => o.Kind != '-');
            outLines.Add($"@@ -{(aCount == 0 ? aStart - 1 : aStart)},{aCount} +{(bCount == 0 ? bStart - 1 : bStart)},{bCount} @@");
            foreach (var o in hunk) outLines.Add(o.Kind + o.Line);
            // cursor = hunk start + hunk extent (the back-context keeps were already
            // counted once by the outer loop — recompute absolutely, don't re-add)
            aLine = aStart + aCount;
            bLine = bStart + bCount;
            idx = stop;
        }
        return string.Join("\n", outLines) + "\n";
    }

    private sealed record Hunk(int AStart, int ACount, int BStart, int BCount, List<Op> Ops);

    private static List<Hunk> Parse(string diff)
    {
        var hunks = new List<Hunk>();
        Hunk? cur = null;
        foreach (var raw in diff.Split('\n'))
        {
            var m = HunkHeader().Match(raw);
            if (m.Success)
            {
                cur = new Hunk(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value),
                               int.Parse(m.Groups[3].Value), int.Parse(m.Groups[4].Value), []);
                hunks.Add(cur);
            }
            else if (cur is not null && raw.Length > 0 && raw[0] is ' ' or '-' or '+')
            {
                cur.Ops.Add(new Op(raw[0], raw[1..]));
            }
            else if (raw != "")
            {
                throw new FormatException($"malformed diff line: \"{raw}\"");
            }
        }
        return hunks;
    }

    /// <summary>Apply a unified diff to <paramref name="baseContent"/> (forward). Throws on any mismatch.</summary>
    public static string Apply(string baseContent, string diff)
    {
        if (diff == "") return baseContent;
        var src = ToLines(baseContent);
        var outLines = new List<string>();
        var pos = 0; // 0-based cursor into src
        foreach (var h in Parse(diff))
        {
            var start = h.ACount == 0 ? h.AStart : h.AStart - 1;
            if (start < pos) throw new InvalidOperationException("overlapping hunks");
            for (var i = pos; i < start; i++) outLines.Add(src[i]);
            pos = start;
            foreach (var o in h.Ops)
            {
                if (o.Kind == '+') { outLines.Add(o.Line); continue; }
                if (pos >= src.Length || src[pos] != o.Line)
                    throw new InvalidOperationException($"diff does not match content at line {pos + 1}");
                if (o.Kind == ' ') outLines.Add(o.Line);
                pos++;
            }
        }
        for (var i = pos; i < src.Length; i++) outLines.Add(src[i]);
        return string.Join("\n", outLines);
    }

    /// <summary>Reverse-apply: given <paramref name="next"/> and the base→next diff, recover the base.</summary>
    public static string ReverseApply(string next, string diff)
    {
        if (diff == "") return next;
        var swapped = string.Join("\n", diff.Split('\n').Select(l =>
        {
            var m = HunkHeader().Match(l);
            if (m.Success)
                return $"@@ -{m.Groups[3].Value},{m.Groups[4].Value} +{m.Groups[1].Value},{m.Groups[2].Value} @@";
            if (l.StartsWith('-')) return "+" + l[1..];
            if (l.StartsWith('+')) return "-" + l[1..];
            return l;
        }));
        return Apply(next, swapped);
    }
}
