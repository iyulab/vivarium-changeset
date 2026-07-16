using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Vivarium.Changeset;

/// <summary>
/// RFC 8785 (JCS) canonicalization (spec ADR-0002).
///
/// JCS defines number and string serialization as ECMAScript's own
/// JSON.stringify semantics. Unlike JS, .NET's formatters do not produce that
/// form natively, so this file carries two deliberate reimplementations:
/// the ECMAScript Number::toString layout over .NET's shortest round-trip
/// digits, and the JSON.stringify string escaper (System.Text.Json's encoders
/// over-escape and cannot be used).
/// </summary>
public static class JsonCanonicalizer
{
    public static string Canonicalize(JsonElement value)
    {
        var sb = new StringBuilder();
        WriteCanonical(sb, value);
        return sb.ToString();
    }

    public static string Canonicalize(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return Canonicalize(doc.RootElement);
    }

    /// <summary>Canonical UTF-8 bytes — the exact input to the fingerprint hash.</summary>
    public static byte[] CanonicalBytes(JsonElement value) =>
        Encoding.UTF8.GetBytes(Canonicalize(value));

    private static void WriteCanonical(StringBuilder sb, JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Null:
                sb.Append("null");
                break;
            case JsonValueKind.True:
                sb.Append("true");
                break;
            case JsonValueKind.False:
                sb.Append("false");
                break;
            case JsonValueKind.String:
                WriteString(sb, value.GetString()!);
                break;
            case JsonValueKind.Number:
                // I-JSON: all numbers are IEEE 754 doubles (spec ADR-0001).
                sb.Append(FormatNumber(value.GetDouble()));
                break;
            case JsonValueKind.Array:
                sb.Append('[');
                var firstItem = true;
                foreach (var item in value.EnumerateArray())
                {
                    if (!firstItem) sb.Append(',');
                    firstItem = false;
                    WriteCanonical(sb, item);
                }
                sb.Append(']');
                break;
            case JsonValueKind.Object:
                sb.Append('{');
                var members = new List<JsonProperty>();
                foreach (var p in value.EnumerateObject()) members.Add(p);
                // JCS: sort by UTF-16 code units = ordinal comparison.
                members.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
                var firstMember = true;
                foreach (var m in members)
                {
                    if (!firstMember) sb.Append(',');
                    firstMember = false;
                    WriteString(sb, m.Name);
                    sb.Append(':');
                    WriteCanonical(sb, m.Value);
                }
                sb.Append('}');
                break;
            default:
                throw new ArgumentException($"value is not JSON-representable: {value.ValueKind}");
        }
    }

    /// <summary>ECMAScript JSON.stringify string escaping (JCS §3.2.2.2).</summary>
    internal static void WriteString(StringBuilder sb, string s)
    {
        sb.Append('"');
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\t': sb.Append("\\t"); break;
                case '\n': sb.Append("\\n"); break;
                case '\f': sb.Append("\\f"); break;
                case '\r': sb.Append("\\r"); break;
                default:
                    if (c < 0x20)
                    {
                        sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else if (char.IsSurrogate(c) && !IsPairedSurrogate(s, i))
                    {
                        // well-formed JSON.stringify (ES2019): lone surrogates escape
                        sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        sb.Append(c);
                    }
                    break;
            }
        }
        sb.Append('"');
    }

    private static bool IsPairedSurrogate(string s, int i) =>
        char.IsHighSurrogate(s[i])
            ? i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])
            : i > 0 && char.IsHighSurrogate(s[i - 1]);

    /// <summary>
    /// ECMAScript Number::toString(10) layout (ECMA-262 §6.1.6.1.20) over .NET's
    /// shortest round-trip digits — the number form JCS normatively requires.
    /// </summary>
    internal static string FormatNumber(double d)
    {
        if (double.IsNaN(d) || double.IsInfinity(d))
            throw new ArgumentOutOfRangeException(nameof(d), "I-JSON forbids NaN and Infinity (spec ADR-0001)");
        if (d == 0) return "0"; // covers -0 per ECMAScript
        if (d < 0) return "-" + FormatNumber(-d);

        // Shortest round-trip representation, then re-layout per ECMAScript rules.
        var repr = d.ToString("R", CultureInfo.InvariantCulture);
        var (digits, n) = ParseDigits(repr); // value = 0.<digits> × 10^n
        var k = digits.Length;

        if (k <= n && n <= 21)
            return digits + new string('0', n - k);
        if (0 < n && n <= 21)
            return digits[..n] + "." + digits[n..];
        if (-6 < n && n <= 0)
            return "0." + new string('0', -n) + digits;

        var mantissa = k == 1 ? digits : digits[..1] + "." + digits[1..];
        var exp = n - 1;
        return mantissa + "e" + (exp >= 0 ? "+" : "-") + Math.Abs(exp).ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>Split a .NET "R" formatted positive double into significand digits and decimal exponent.</summary>
    private static (string Digits, int N) ParseDigits(string repr)
    {
        var exp = 0;
        var eIdx = repr.IndexOfAny(['E', 'e']);
        if (eIdx >= 0)
        {
            exp = int.Parse(repr[(eIdx + 1)..], CultureInfo.InvariantCulture);
            repr = repr[..eIdx];
        }
        var dotIdx = repr.IndexOf('.');
        string digits;
        int n;
        if (dotIdx >= 0)
        {
            digits = repr[..dotIdx] + repr[(dotIdx + 1)..];
            n = dotIdx + exp;
        }
        else
        {
            digits = repr;
            n = repr.Length + exp;
        }
        var lead = 0;
        while (lead < digits.Length - 1 && digits[lead] == '0') { lead++; n--; }
        digits = digits[lead..].TrimEnd('0');
        if (digits.Length == 0) { digits = "0"; n = 1; }
        return (digits, n);
    }
}
