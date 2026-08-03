using System.Text.Json.Nodes;

namespace Vivarium.Changeset;

public sealed record BaseStateEntry(string Kind, string Ref, string Fingerprint);

public sealed class ChangesetValidationException : Exception
{
    public IReadOnlyList<ValidationError> Errors { get; }

    public ChangesetValidationException(IReadOnlyList<ValidationError> errors)
        : base("changeset failed validation:\n" + string.Join("\n", errors.Select(e => $"  {e.Path}: {e.Message}")))
    {
        Errors = errors;
    }
}

/// <summary>
/// Authoring helper. The builder's job is to make invalid documents hard to
/// construct: review diffs and base fingerprints are computed, never hand-written,
/// and <see cref="Finalize"/> refuses to emit anything that does not validate.
/// There is no apply logic here and never will be.
/// </summary>
public sealed class ChangesetBuilder
{
    private readonly JsonObject _draft;

    /// <summary>
    /// Spec §9 minimality, automated: a draft carries the <em>lowest</em> specVersion its
    /// contents require. Features raise the floor and never lower it — a draft that already
    /// needs 0.3 does not fall back to 0.2 when a 0.2 feature is added.
    /// </summary>
    private void Lift(string required)
    {
        var versions = ChangesetValidator.SupportedSpecVersions;
        var current = _draft["specVersion"]!.GetValue<string>();
        if (Array.IndexOf(versions, required) > Array.IndexOf(versions, current))
            _draft["specVersion"] = required;
    }

    /// <param name="createdAt">Caller supplies the clock — the SDK stays deterministic.</param>
    public ChangesetBuilder(
        string intent,
        string producedBy,
        string createdAt,
        string? id = null,
        IEnumerable<BaseStateEntry>? baseState = null,
        JsonNode? editContext = null)
    {
        var entries = (baseState ?? []).ToArray();
        var provenance = new JsonObject
        {
            ["producedBy"] = producedBy,
            ["createdAt"] = createdAt,
            ["baseState"] = new JsonArray(
                entries.Select(b => (JsonNode)new JsonObject
                {
                    ["kind"] = b.Kind,
                    ["ref"] = b.Ref,
                    ["fingerprint"] = b.Fingerprint,
                }).ToArray()),
        };
        if (editContext is not null) provenance["editContext"] = editContext;

        _draft = new JsonObject
        {
            ["specVersion"] = ChangesetValidator.SupportedSpecVersions[0],
        };
        if (id is not null) _draft["id"] = id;
        _draft["intent"] = intent;
        _draft["provenance"] = provenance;
        _draft["patches"] = new JsonObject
        {
            ["schema"] = new JsonArray(),
            ["ui"] = new JsonArray(),
            ["data"] = new JsonArray(),
        };

        // `data` baseState entries are a 0.3 feature (spec §4).
        if (entries.Any(b => b.Kind == "data")) Lift("0.3.0");
    }

    private JsonArray FacetArray(string name) => (JsonArray)((JsonObject)_draft["patches"]!)[name]!;

    public ChangesetBuilder AddSchemaOp(JsonObject op)
    {
        FacetArray("schema").Add(op.DeepClone());
        return this;
    }

    /// <summary>Base fingerprint and review diff are derived from the contents — by construction consistent.</summary>
    public ChangesetBuilder AddUiPatch(string artifactId, string? baseContent, string newContent, string explanation)
    {
        var baseText = baseContent ?? "";
        FacetArray("ui").Add(new JsonObject
        {
            ["profile"] = "whole-artifact@0",
            ["artifactId"] = artifactId,
            ["baseFingerprint"] = baseContent is null ? null : ChangesetFingerprint.OfArtifact(baseText),
            ["newContent"] = newContent,
            ["reviewDiff"] = UnifiedDiff.Create(baseText, newContent),
            ["explanation"] = explanation,
        });
        return this;
    }

    /// <summary>
    /// verified-diff@0 (spec §5.2.2): diff and both fingerprints are derived
    /// from the contents — by construction consistent. Refuses no-ops at
    /// authoring time. Adding one raises the draft's specVersion to at least
    /// 0.2.0 (the lowest version the document now requires — spec §9
    /// minimality, automated).
    /// </summary>
    public ChangesetBuilder AddVerifiedDiffPatch(string artifactId, string baseContent, string newContent, string explanation)
    {
        var diff = VerifiedDiff.Create(baseContent, newContent);
        if (diff == "")
            throw new ChangesetValidationException(
                [new ValidationError("$.patches.ui", "no-op verified-diff patch: contents are identical (spec §5.2.2)")]);
        FacetArray("ui").Add(new JsonObject
        {
            ["profile"] = "verified-diff@0",
            ["artifactId"] = artifactId,
            ["baseFingerprint"] = ChangesetFingerprint.OfArtifact(baseContent),
            ["diff"] = diff,
            ["newFingerprint"] = ChangesetFingerprint.OfArtifact(newContent),
            ["explanation"] = explanation,
        });
        Lift("0.2.0");
        return this;
    }

    public ChangesetBuilder AddDataPatch(string id, string explanation, IEnumerable<JsonObject> operations)
    {
        FacetArray("data").Add(new JsonObject
        {
            ["id"] = id,
            ["explanation"] = explanation,
            ["operations"] = new JsonArray(operations.Select(o => (JsonNode)o.DeepClone()).ToArray()),
        });
        return this;
    }

    /// <summary>Current draft state (deep copy — the builder stays authoritative).</summary>
    public JsonObject ToDraft() => (JsonObject)_draft.DeepClone();

    /// <summary>Validate and stamp. Emits a conforming, fingerprinted document — or throws.</summary>
    public JsonObject Finalize()
    {
        var result = ChangesetValidator.Validate(_draft);
        if (!result.Valid) throw new ChangesetValidationException(result.Errors);
        return ChangesetFingerprint.Stamp(_draft);
    }
}
