using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Vivarium.Changeset;

/// <summary>
/// Renders an offending value in a validation message exactly as the TypeScript
/// SDK's <c>JSON.stringify</c> does, so the two SDKs' messages are byte-identical.
/// <see cref="JsonNode.ToJsonString"/> is not that: its default encoder escapes
/// <c>+ &lt; &gt; &amp; '</c> and every non-ASCII character, and it keeps a number's
/// source spelling (<c>1.0</c>) where JavaScript prints the value (<c>1</c>).
/// </summary>
internal static class JsRepr
{
    /// <summary>
    /// The member <paramref name="key"/> of <paramref name="parent"/>: <c>undefined</c> when
    /// absent, <c>null</c> when present as JSON null — the distinction the indexer alone loses.
    /// </summary>
    public static string Member(JsonObject? parent, string key) =>
        parent is not null && parent.ContainsKey(key) ? Of(parent[key]) : "undefined";

    public static string Of(JsonNode? node)
    {
        var sb = new StringBuilder();
        Write(sb, node);
        return sb.ToString();
    }

    private static void Write(StringBuilder sb, JsonNode? node)
    {
        switch (node)
        {
            case null:
                sb.Append("null");
                return;
            case JsonArray arr:
                sb.Append('[');
                for (var i = 0; i < arr.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    Write(sb, arr[i]);
                }
                sb.Append(']');
                return;
            case JsonObject obj:
                // JavaScript enumerates integer-index keys first, ascending, then the rest in insertion order.
                var indexKeys = new List<(uint Index, string Key)>();
                var otherKeys = new List<string>();
                foreach (var (k, _) in obj)
                {
                    if (IsArrayIndex(k, out var idx)) indexKeys.Add((idx, k));
                    else otherKeys.Add(k);
                }
                indexKeys.Sort((a, b) => a.Index.CompareTo(b.Index));
                sb.Append('{');
                var first = true;
                foreach (var k in indexKeys.Select(e => e.Key).Concat(otherKeys))
                {
                    if (!first) sb.Append(',');
                    first = false;
                    Quote(sb, k);
                    sb.Append(':');
                    Write(sb, obj[k]);
                }
                sb.Append('}');
                return;
            case JsonValue v:
                switch (v.GetValueKind())
                {
                    case JsonValueKind.String: Quote(sb, v.GetValue<string>()); return;
                    case JsonValueKind.True: sb.Append("true"); return;
                    case JsonValueKind.False: sb.Append("false"); return;
                    case JsonValueKind.Number: sb.Append(Number(v)); return;
                    default: sb.Append("null"); return;
                }
        }
    }

    // ECMAScript QuoteJSONString: short escapes, other controls as lowercase \u00xx,
    // lone surrogates as lowercase \uxxxx, everything else verbatim.
    private static void Quote(StringBuilder sb, string s)
    {
        sb.Append('"');
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            switch (c)
            {
                case '"': sb.Append("\\\""); continue;
                case '\\': sb.Append("\\\\"); continue;
                case '\b': sb.Append("\\b"); continue;
                case '\f': sb.Append("\\f"); continue;
                case '\n': sb.Append("\\n"); continue;
                case '\r': sb.Append("\\r"); continue;
                case '\t': sb.Append("\\t"); continue;
            }
            if (c < 0x20) { sb.Append("\\u").Append(((int)c).ToString("x4")); continue; }
            if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]))
            {
                sb.Append(c).Append(s[++i]);
                continue;
            }
            if (char.IsSurrogate(c)) { sb.Append("\\u").Append(((int)c).ToString("x4")); continue; }
            sb.Append(c);
        }
        sb.Append('"');
    }

    // ECMAScript Number::toString over the parsed double. A value outside double range
    // is Infinity to JSON.parse, which JSON.stringify renders as null.
    private static string Number(JsonValue v)
    {
        if (!double.TryParse(v.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var x)
            || !double.IsFinite(x))
            return "null";
        if (x == 0) return "0";
        if (x < 0) return "-" + Positive(-x);
        return Positive(x);
    }

    private static string Positive(double x)
    {
        // Shortest round-trip digits: .NET's "R" gives them; reshape into digits + decimal point position.
        var r = x.ToString("R", CultureInfo.InvariantCulture);
        var exp = 0;
        var e = r.IndexOf('E');
        if (e >= 0) { exp = int.Parse(r[(e + 1)..], CultureInfo.InvariantCulture); r = r[..e]; }
        var dot = r.IndexOf('.');
        var intPart = dot >= 0 ? r[..dot] : r;
        var digits = intPart + (dot >= 0 ? r[(dot + 1)..] : "");
        var n = intPart.Length + exp;
        var lead = 0;
        while (lead < digits.Length - 1 && digits[lead] == '0') lead++;
        digits = digits[lead..].TrimEnd('0');
        n -= lead;
        var k = digits.Length;

        if (k <= n && n <= 21) return digits + new string('0', n - k);
        if (0 < n && n <= 21) return digits[..n] + "." + digits[n..];
        if (-6 < n && n <= 0) return "0." + new string('0', -n) + digits;
        var sign = n - 1 >= 0 ? "+" : "-";
        var mag = Math.Abs(n - 1).ToString(CultureInfo.InvariantCulture);
        return k == 1 ? $"{digits}e{sign}{mag}" : $"{digits[0]}.{digits[1..]}e{sign}{mag}";
    }

    private static bool IsArrayIndex(string key, out uint index) =>
        uint.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out index)
        && index != uint.MaxValue
        && index.ToString(CultureInfo.InvariantCulture) == key;
}
