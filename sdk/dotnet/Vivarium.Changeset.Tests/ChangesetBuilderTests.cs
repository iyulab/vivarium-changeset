using System.Text.Json.Nodes;

namespace Vivarium.Changeset.Tests;

public class ChangesetBuilderTests
{
    private static ChangesetBuilder Builder() => new(
        intent: "add a due date",
        producedBy: "test-suite",
        createdAt: "2026-07-16T00:00:00Z",
        baseState: [new BaseStateEntry("schema", "default", "sha256:" + new string('a', 64))]);

    [Fact]
    public void FinalizeEmitsValidatedStampedDocument()
    {
        var doc = Builder()
            .AddSchemaOp((JsonObject)JsonNode.Parse("""
                { "op": "field.add", "entity": "loan",
                  "field": { "name": "dueDate", "type": "date" },
                  "explanation": "stores the due date" }
                """)!)
            .Finalize();
        Assert.True(ChangesetFingerprint.Verify(doc));
        Assert.True(ChangesetValidator.Validate(doc).Valid);
    }

    [Fact]
    public void FinalizeRefusesInvalidDrafts()
    {
        // no patches at all → at-least-one-facet rule fails
        var ex = Assert.Throws<ChangesetValidationException>(() => Builder().Finalize());
        Assert.Contains(ex.Errors, e => e.Path == "$.patches");
    }

    [Fact]
    public void UiPatchIsConsistentByConstruction()
    {
        var doc = Builder()
            .AddUiPatch("screen-1", "old\ncontent", "new\ncontent", "rewrite the screen")
            .Finalize();
        Assert.True(ChangesetValidator.Validate(doc).Valid);
        var patch = (JsonObject)doc["patches"]!["ui"]![0]!;
        Assert.Equal(ChangesetFingerprint.OfArtifact("old\ncontent"), patch["baseFingerprint"]!.GetValue<string>());
    }

    [Fact]
    public void CreationUiPatchUsesNullBaseFingerprint()
    {
        var doc = Builder()
            .AddUiPatch("screen-1", null, "fresh content", "create the screen")
            .Finalize();
        Assert.True(ChangesetValidator.Validate(doc).Valid);
        var patch = (JsonObject)doc["patches"]!["ui"]![0]!;
        Assert.True(patch.ContainsKey("baseFingerprint"));
        Assert.Null(patch["baseFingerprint"]);
    }

    [Fact]
    public void DataPatchRoundTrips()
    {
        var doc = Builder()
            .AddDataPatch("backfill", "seed defaults",
                [(JsonObject)JsonNode.Parse("""
                    { "op": "update", "entity": "loan",
                      "where": { "field": "dueDate", "equals": null },
                      "set": { "dueDate": "2026-08-01" } }
                    """)!])
            .Finalize();
        Assert.True(ChangesetValidator.Validate(doc).Valid);
    }

    /// <summary>
    /// Before spec 0.3 this operation finalized cleanly — `op` was the only member
    /// validated, so an update with no predicate and no assignment reached a backend
    /// write path to fail there instead (spec §5.3).
    /// </summary>
    [Fact]
    public void DataPatchWithIncompleteOperationIsRefusedAtAuthoringTime()
    {
        var ex = Assert.Throws<ChangesetValidationException>(() => Builder()
            .AddDataPatch("backfill", "seed defaults",
                [(JsonObject)JsonNode.Parse("""{ "op": "update", "entity": "loan" }""")!])
            .Finalize());
        Assert.Contains(ex.Errors, e => e.Path == "$.patches.data[0].operations[0].where");
        Assert.Contains(ex.Errors, e => e.Path == "$.patches.data[0].operations[0].set");
    }

    [Fact]
    public void DataBaseStateEntryLiftsSpecVersionTo030()
    {
        var builder = new ChangesetBuilder("add a due date", "test", "2026-08-03T00:00:00Z",
            baseState: [new BaseStateEntry("data", "data", "sha256:" + new string('d', 64))]);
        Assert.Equal("0.3.0", builder.ToDraft()["specVersion"]!.GetValue<string>());

        // A 0.2 feature must not pull the stamp back down below what 0.3 content needs.
        var doc = builder
            .AddVerifiedDiffPatch("screen-1", "old\ncontent", "new\ncontent", "edit")
            .Finalize();
        Assert.Equal("0.3.0", doc["specVersion"]!.GetValue<string>());
        Assert.True(ChangesetValidator.Validate(doc).Valid);
    }

    [Fact]
    public void ToDraftIsACopyNotAView()
    {
        var builder = Builder();
        var draft = builder.ToDraft();
        draft["intent"] = "mutated";
        var doc = builder
            .AddSchemaOp((JsonObject)JsonNode.Parse("""
                { "op": "entity.remove", "entity": "loan", "explanation": "drop it" }
                """)!)
            .Finalize();
        Assert.Equal("add a due date", doc["intent"]!.GetValue<string>());
    }
}
