using System.Globalization;
using System.Text.RegularExpressions;

namespace Vivarium.Changeset;

/// <summary>
/// RFC 3339 <c>date-time</c> (§5.6), with the §5.7 calendar restrictions — the one
/// timestamp form the spec admits (§4 <c>createdAt</c>, §7 <c>approvedAt</c>).
/// </summary>
/// <remarks>
/// A grammar check, deliberately not <see cref="DateTimeOffset.TryParse(string, out DateTimeOffset)"/>:
/// the platform parsers of the two SDKs each accept inputs outside RFC 3339 (and
/// different ones). The TypeScript SDK implements this same rule; the cross-SDK
/// vectors hold them together. <c>T</c>/<c>Z</c> are case-insensitive (RFC 5234 §2.3),
/// digits are ASCII only (hence <c>[0-9]</c>, not <c>\d</c>), the end anchor is <c>\z</c>
/// (<c>$</c> would admit a trailing newline), and seconds admit a leap second (<c>60</c>).
/// </remarks>
internal static partial class Rfc3339
{
    /// <summary>The expected form, as the validator names it when it refuses one.</summary>
    public const string Form = "YYYY-MM-DDTHH:MM:SS[.frac](Z|+HH:MM|-HH:MM)";

    [GeneratedRegex(@"^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?(?:[Zz]|[+-]([0-9]{2}):([0-9]{2}))\z", RegexOptions.CultureInvariant)]
    private static partial Regex DateTime();

    public static bool IsDateTime(string value)
    {
        var m = DateTime().Match(value);
        if (!m.Success) return false;
        int G(int i) => int.Parse(m.Groups[i].Value, CultureInfo.InvariantCulture);
        int year = G(1), month = G(2), day = G(3);
        if (month < 1 || month > 12) return false;
        if (day < 1 || day > System.DateTime.DaysInMonth(year == 0 ? 2000 : year, month)) return false;
        if (G(4) > 23 || G(5) > 59 || G(6) > 60) return false;
        if (m.Groups[7].Success && (G(7) > 23 || G(8) > 59)) return false;
        return true;
    }
}
