using System.Text.Json.Nodes;

namespace Vivarium.Changeset;

/// <summary>One <c>provenance.baseState</c> entry (spec §4): a piece of the world the changeset was authored against.</summary>
/// <param name="Kind">One of <see cref="ChangesetValidator.BaseStateKinds"/>; <c>data</c> requires specVersion 0.3.0 or later.</param>
/// <param name="Ref">Non-empty name of the referenced state (adapter-defined for <c>schema</c> and <c>data</c>).</param>
/// <param name="Fingerprint">The state's <c>sha256:</c>-prefixed fingerprint.</param>
public sealed record BaseStateEntry(string Kind, string Ref, string Fingerprint);

/// <summary>
/// A whole document refused by the validator. One shape with every other refusal in
/// this SDK — a dialect parse failure carries the same <see cref="ChangesetError.Errors"/>
/// list — so a consumer handles "what went wrong and where" the same way whichever
/// raised it.
/// </summary>
public sealed class ChangesetValidationException(IReadOnlyList<ValidationError> errors)
    : ChangesetError(ChangesetErrorSubject.Validation, errors);

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

    /// <summary>
    /// Start a draft with empty facets and the lowest supported specVersion. Passing a
    /// <c>data</c> base-state entry raises the specVersion to 0.3.0 (spec §4).
    /// </summary>
    /// <param name="intent">One human-readable sentence of what the changeset accomplishes (spec §3).</param>
    /// <param name="producedBy">Opaque identifier of the producer — agent, tool, or human (spec §4).</param>
    /// <param name="createdAt">Caller supplies the clock — the SDK stays deterministic.</param>
    /// <param name="id">Optional producer-assigned document id; omitted when <see langword="null"/>.</param>
    /// <param name="baseState">The states the changeset was authored against; empty only for greenfield creation (spec §4).</param>
    /// <param name="editContext">Optional selection/screen context the change was made from, stored as-is (spec §4).</param>
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

    /// <summary>
    /// Append a logical schema operation (spec §5.1). The object is copied as given —
    /// its vocabulary and members are checked by <see cref="Finalize"/>, not here.
    /// </summary>
    /// <param name="op">The operation object, including its <c>op</c> and <c>explanation</c> members.</param>
    /// <returns>This builder, for chaining.</returns>
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

    /// <summary>
    /// Append a data patch (spec §5.3): one reviewable unit of run-once operations.
    /// The operations are copied as given and checked by <see cref="Finalize"/>, not here.
    /// </summary>
    /// <param name="id">Patch id, unique within the document; consumers use it for run-once bookkeeping.</param>
    /// <param name="explanation">What the patch does and why — carried once per patch, not per operation.</param>
    /// <param name="operations">The <c>insert</c> / <c>update</c> / <c>delete</c> operation objects, in order.</param>
    /// <returns>This builder, for chaining.</returns>
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
