using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Vivarium.Changeset;

/// <summary>
/// Changeset document fingerprint (spec §6 / ADR-0002): SHA-256 over the JCS
/// canonical bytes of the document with the top-level <c>fingerprint</c> and
/// <c>approvals</c> members removed.
/// </summary>
public static class ChangesetFingerprint
{
    /// <summary>The only fingerprint prefix this SDK reads or writes.</summary>
    public const string Prefix = "sha256:";

    /// <summary>
    /// Compute a document's fingerprint (spec §6). Any existing <c>fingerprint</c> and
    /// <c>approvals</c> are ignored, so the result is the same before and after stamping or approving.
    /// </summary>
    /// <param name="document">The changeset document. It is not modified.</param>
    /// <returns><c>sha256:</c> followed by the lowercase hex digest.</returns>
    public static string Of(JsonObject document)
    {
        var content = (JsonObject)document.DeepClone();
        content.Remove("fingerprint");
        content.Remove("approvals");
        using var doc = JsonDocument.Parse(content.ToJsonString());
        var bytes = JsonCanonicalizer.CanonicalBytes(doc.RootElement);
        return Prefix + Convert.ToHexStringLower(SHA256.HashData(bytes));
    }

    /// <summary>Compute a document's fingerprint (spec §6) from a parsed JSON element.</summary>
    /// <param name="document">The changeset document; must be a JSON object.</param>
    /// <returns><c>sha256:</c> followed by the lowercase hex digest.</returns>
    /// <exception cref="ArgumentException"><paramref name="document"/> is not a JSON object.</exception>
    public static string Of(JsonElement document) =>
        Of(JsonObject.Create(document) ?? throw new ArgumentException("document must be a JSON object", nameof(document)));

    /// <summary>Return a copy of the document with its computed fingerprint stamped in.</summary>
    public static JsonObject Stamp(JsonObject document)
    {
        var stamped = (JsonObject)document.DeepClone();
        stamped["fingerprint"] = Of(document);
        return stamped;
    }

    /// <summary>
    /// Verify a document's embedded fingerprint. Unknown prefixes are rejected,
    /// never guessed (ADR-0002).
    /// </summary>
    public static bool Verify(JsonObject document)
    {
        if (document["fingerprint"] is not JsonValue v || !v.TryGetValue<string>(out var embedded))
            return false;
        if (!embedded.StartsWith(Prefix, StringComparison.Ordinal))
            throw ChangesetError.At(ChangesetErrorSubject.Fingerprint, "$.fingerprint", $"unsupported fingerprint prefix: {embedded.Split(':')[0]}:");
        return embedded == Of(document);
    }

    /// <summary>Fingerprint of a UI artifact's raw content string (spec §5.2).</summary>
    public static string OfArtifact(string content) =>
        Prefix + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(content)));
}
