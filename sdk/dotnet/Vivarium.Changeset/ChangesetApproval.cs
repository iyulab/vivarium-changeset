using System.Text.Json.Nodes;

namespace Vivarium.Changeset;

/// <summary>
/// Approval records (spec §7). The TypeScript SDK's <c>addApproval</c> is the same
/// operation; the cross-SDK vectors in <c>spec/fixtures/approval.json</c> hold them together.
/// </summary>
public static class ChangesetApproval
{
    /// <summary>
    /// Return a copy of a finalized document with one approval record appended.
    /// </summary>
    /// <remarks>
    /// The record's <c>fingerprint</c> is taken from the document, never passed in: it must
    /// name exactly what was reviewed, which is the one field a hand-written record gets
    /// wrong silently. Everything else is the caller's — <paramref name="approvedBy"/> is
    /// opaque here, and the caller supplies the clock, as <see cref="ChangesetBuilder"/>
    /// does for <c>createdAt</c>. <c>attestation</c> is reserved and absent in v0.
    /// <para>Refuses a document that carries no fingerprint (not finalized) or whose
    /// fingerprint no longer matches its contents (changed after finalizing), and refuses
    /// to emit a document that does not validate. Which approvals an applier trusts, and
    /// where they are kept, stay implementation-defined (spec §7).</para>
    /// </remarks>
    /// <param name="document">A finalized (fingerprinted) changeset document. It is not modified.</param>
    /// <param name="approvedBy">Who approved — an opaque identifier recorded as-is.</param>
    /// <param name="approvedAt">An RFC 3339 <c>date-time</c>, e.g. <c>DateTimeOffset.UtcNow.ToString("o")</c>.</param>
    /// <param name="comment">Optional reviewer comment; omitted from the record when <see langword="null"/>.</param>
    /// <returns>A new document equal to <paramref name="document"/> plus the appended approval record.</returns>
    /// <exception cref="ChangesetError">The document is not finalized, or changed after it was.</exception>
    /// <exception cref="ChangesetValidationException">The approved document would not validate.</exception>
    public static JsonObject Add(JsonObject document, string approvedBy, string approvedAt, string? comment = null)
    {
        if (document["fingerprint"] is not JsonValue v || !v.TryGetValue<string>(out var fingerprint))
            throw ChangesetError.At(ChangesetErrorSubject.Approval, "$.fingerprint",
                "absent — only a finalized document can be approved (spec §7)");
        if (!ChangesetFingerprint.Verify(document))
            throw ChangesetError.At(ChangesetErrorSubject.Approval, "$.fingerprint",
                "does not match the document's contents — it changed after it was finalized (spec §7)");

        var record = new JsonObject
        {
            ["fingerprint"] = fingerprint,
            ["approvedBy"] = approvedBy,
            ["approvedAt"] = approvedAt,
        };
        if (comment is not null) record["comment"] = comment;

        var approved = (JsonObject)document.DeepClone();
        switch (approved["approvals"])
        {
            case null when !approved.ContainsKey("approvals"):
                approved["approvals"] = new JsonArray(record);
                break;
            case JsonArray approvals:
                approvals.Add(record);
                break;
            // Anything else is left as it is so the validator names it below.
        }

        var result = ChangesetValidator.Validate(approved);
        if (!result.Valid) throw new ChangesetValidationException(result.Errors);
        return approved;
    }
}
