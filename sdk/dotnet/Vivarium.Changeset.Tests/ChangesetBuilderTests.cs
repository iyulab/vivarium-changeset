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
                [(JsonObject)JsonNode.Parse("""{ "op": "update", "entity": "loan" }""")!])
            .Finalize();
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
