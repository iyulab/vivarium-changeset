using System.Text.Json.Nodes;

namespace Vivarium.Changeset.Tests;

public class ChangesetValidatorTests
{
    private static JsonObject Valid() => (JsonObject)JsonNode.Parse("""
        {
          "specVersion": "0.1.0",
          "intent": "add a field",
          "provenance": { "producedBy": "t", "createdAt": "2026-07-16T00:00:00Z", "baseState": [] },
          "patches": {
            "schema": [
              { "op": "field.add", "entity": "loan",
                "field": { "name": "dueDate", "type": "date" },
                "explanation": "stores the due date" }
            ],
            "ui": [], "data": []
          }
        }
        """)!;

    private static IEnumerable<string> Paths(ValidationResult r) => r.Errors.Select(e => e.Path);

    [Fact]
    public void ValidDocumentPasses()
    {
        var r = ChangesetValidator.Validate(Valid());
        Assert.True(r.Valid, string.Join("; ", r.Errors.Select(e => $"{e.Path}: {e.Message}")));
    }

    [Fact]
    public void NonObjectDocumentIsRejected()
    {
        Assert.False(ChangesetValidator.Validate((JsonNode?)null).Valid);
        Assert.False(ChangesetValidator.Validate(JsonNode.Parse("[1]")).Valid);
        Assert.False(ChangesetValidator.Validate(JsonNode.Parse("\"str\"")).Valid);
    }

    [Fact]
    public void UnknownMembersViolateClosedModel()
    {
        var doc = Valid();
        doc["vendorExtra"] = true;
        Assert.Contains("$.vendorExtra", Paths(ChangesetValidator.Validate(doc)));
    }

    [Fact]
    public void UnsupportedSpecVersionIsRejected()
    {
        var doc = Valid();
        doc["specVersion"] = "9.9.9";
        Assert.Contains("$.specVersion", Paths(ChangesetValidator.Validate(doc)));
    }

    [Fact]
    public void EmptyPatchesAreRejected()
    {
        var doc = Valid();
        ((JsonObject)doc["patches"]!)["schema"] = new JsonArray();
        Assert.Contains("$.patches", Paths(ChangesetValidator.Validate(doc)));
    }

    [Fact]
    public void UnknownSchemaOpIsRejected()
    {
        var doc = Valid();
        ((JsonObject)doc["patches"]!["schema"]![0]!)["op"] = "table.drop";
        Assert.Contains("$.patches.schema[0].op", Paths(ChangesetValidator.Validate(doc)));
    }

    [Fact]
    public void UnknownLogicalTypeIsRejected()
    {
        var doc = Valid();
        ((JsonObject)doc["patches"]!["schema"]![0]!["field"]!)["type"] = "uuid";
        Assert.Contains("$.patches.schema[0]", Paths(ChangesetValidator.Validate(doc)));
    }

    [Fact]
    public void ReferenceTypeRequiresTarget()
    {
        var doc = Valid();
        ((JsonObject)doc["patches"]!["schema"]![0]!["field"]!)["type"] = "reference";
        Assert.False(ChangesetValidator.Validate(doc).Valid);
    }

    [Fact]
    public void MissingExplanationIsRejected()
    {
        var doc = Valid();
        ((JsonObject)doc["patches"]!["schema"]![0]!).Remove("explanation");
        Assert.False(ChangesetValidator.Validate(doc).Valid);
    }

    [Fact]
    public void ConsistentUiPatchPasses()
    {
        var baseContent = "old line\nshared";
        var newContent = "new line\nshared";
        var doc = Valid();
        ((JsonObject)doc["patches"]!)["ui"] = new JsonArray(new JsonObject
        {
            ["profile"] = "whole-artifact@0",
            ["artifactId"] = "a1",
            ["baseFingerprint"] = ChangesetFingerprint.OfArtifact(baseContent),
            ["newContent"] = newContent,
            ["reviewDiff"] = UnifiedDiff.Create(baseContent, newContent),
            ["explanation"] = "swap the first line",
        });
        var r = ChangesetValidator.Validate(doc);
        Assert.True(r.Valid, string.Join("; ", r.Errors.Select(e => $"{e.Path}: {e.Message}")));
    }

    [Fact]
    public void InconsistentReviewDiffIsRejected()
    {
        var baseContent = "old line\nshared";
        var newContent = "new line\nshared";
        var doc = Valid();
        ((JsonObject)doc["patches"]!)["ui"] = new JsonArray(new JsonObject
        {
            ["profile"] = "whole-artifact@0",
            ["artifactId"] = "a1",
            ["baseFingerprint"] = ChangesetFingerprint.OfArtifact("some other base"),
            ["newContent"] = newContent,
            ["reviewDiff"] = UnifiedDiff.Create(baseContent, newContent),
            ["explanation"] = "swap the first line",
        });
        Assert.Contains("$.patches.ui[0].reviewDiff", Paths(ChangesetValidator.Validate(doc)));
    }

    [Fact]
    public void CreationPatchMustDiffFromEmpty()
    {
        var doc = Valid();
        ((JsonObject)doc["patches"]!)["ui"] = new JsonArray(new JsonObject
        {
            ["profile"] = "whole-artifact@0",
            ["artifactId"] = "a1",
            ["baseFingerprint"] = null,
            ["newContent"] = "hello",
            ["reviewDiff"] = UnifiedDiff.Create("not empty", "hello"),
            ["explanation"] = "create artifact",
        });
        Assert.Contains("$.patches.ui[0].reviewDiff", Paths(ChangesetValidator.Validate(doc)));
    }

    [Fact]
    public void DuplicateDataPatchIdsAreRejected()
    {
        var doc = Valid();
        JsonObject DataPatch() => new()
        {
            ["id"] = "p1",
            ["explanation"] = "e",
            ["operations"] = new JsonArray(new JsonObject { ["op"] = "insert" }),
        };
        ((JsonObject)doc["patches"]!)["data"] = new JsonArray(DataPatch(), DataPatch());
        Assert.Contains("$.patches.data[1].id", Paths(ChangesetValidator.Validate(doc)));
    }

    [Fact]
    public void UnknownDataOperationIsRejected()
    {
        var doc = Valid();
        ((JsonObject)doc["patches"]!)["data"] = new JsonArray(new JsonObject
        {
            ["id"] = "p1",
            ["explanation"] = "e",
            ["operations"] = new JsonArray(new JsonObject { ["op"] = "truncate" }),
        });
        Assert.Contains("$.patches.data[0].operations[0].op", Paths(ChangesetValidator.Validate(doc)));
    }

    [Fact]
    public void EmbeddedFingerprintMismatchIsRejected()
    {
        var doc = Valid();
        doc["fingerprint"] = "sha256:" + new string('0', 64);
        Assert.Contains("$.fingerprint", Paths(ChangesetValidator.Validate(doc)));
    }

    [Fact]
    public void StampedDocumentValidates()
    {
        var r = ChangesetValidator.Validate(ChangesetFingerprint.Stamp(Valid()));
        Assert.True(r.Valid, string.Join("; ", r.Errors.Select(e => $"{e.Path}: {e.Message}")));
    }

    [Theory]
    [InlineData("""{ "schema": "not-an-array", "ui": [], "data": [] }""")]
    [InlineData("""{ "schema": [], "ui": 42, "data": [] }""")]
    [InlineData("""{ "schema": [], "ui": [], "data": {} }""")]
    [InlineData("""{ "schema": [null], "ui": [], "data": [] }""")]
    [InlineData("""{ "schema": [], "ui": ["nope"], "data": [] }""")]
    [InlineData("""{ "schema": [], "ui": [], "data": [null] }""")]
    [InlineData("""{ "schema": [{ "op": "entity.create", "entity": "x", "fields": [null], "explanation": "e" }], "ui": [], "data": [] }""")]
    [InlineData("""{ "schema": [{ "op": "entity.create", "entity": "x", "fields": 7, "explanation": "e" }], "ui": [], "data": [] }""")]
    [InlineData("""{ "schema": [], "ui": [], "data": [{ "id": "p", "explanation": "e", "operations": [null] }] }""")]
    public void MalformedShapesYieldErrorsNeverThrow(string patchesJson)
    {
        var doc = Valid();
        doc["patches"] = JsonNode.Parse(patchesJson);
        Assert.False(ChangesetValidator.Validate(doc).Valid);
    }

    [Theory]
    [InlineData("[null]")]
    [InlineData("[\"str\"]")]
    public void MalformedApprovalItemsYieldErrorsNeverThrow(string approvalsJson)
    {
        var doc = Valid();
        doc["approvals"] = JsonNode.Parse(approvalsJson);
        Assert.False(ChangesetValidator.Validate(doc).Valid);
    }

    [Fact]
    public void MalformedApprovalsAreRejected()
    {
        var doc = Valid();
        doc["approvals"] = new JsonArray(new JsonObject { ["approvedBy"] = "r1", ["extra"] = 1 });
        var paths = Paths(ChangesetValidator.Validate(doc)).ToList();
        Assert.Contains("$.approvals[0].fingerprint", paths);
        Assert.Contains("$.approvals[0].extra", paths);
    }
}
