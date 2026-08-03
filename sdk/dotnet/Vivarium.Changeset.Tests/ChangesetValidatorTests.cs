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

    private static JsonObject WithDataOperation(string operationJson)
    {
        var doc = Valid();
        ((JsonObject)doc["patches"]!)["data"] = new JsonArray(new JsonObject
        {
            ["id"] = "p1",
            ["explanation"] = "e",
            ["operations"] = new JsonArray(JsonNode.Parse(operationJson)!),
        });
        return doc;
    }

    // spec §5.3 — per-op required members, closed member set, closed `where`.
    [Theory]
    [InlineData("""{ "op": "update", "entity": "loan" }""", "$.patches.data[0].operations[0].where")]
    [InlineData("""{ "op": "update", "entity": "loan" }""", "$.patches.data[0].operations[0].set")]
    [InlineData("""{ "op": "insert", "values": {} }""", "$.patches.data[0].operations[0].entity")]
    [InlineData("""{ "op": "delete", "entity": "" , "where": { "field": "f", "equals": 1 } }""", "$.patches.data[0].operations[0].entity")]
    [InlineData("""{ "op": "insert", "entity": "loan", "values": {}, "limit": 1 }""", "$.patches.data[0].operations[0].limit")]
    [InlineData("""{ "op": "insert", "entity": "loan", "values": "not-an-object" }""", "$.patches.data[0].operations[0].values")]
    [InlineData("""{ "op": "update", "entity": "loan", "where": { "field": "f", "equals": 1 }, "set": 7 }""", "$.patches.data[0].operations[0].set")]
    [InlineData("""{ "op": "delete", "entity": "loan", "where": { "sku": "SKU-1" } }""", "$.patches.data[0].operations[0].where.sku")]
    [InlineData("""{ "op": "delete", "entity": "loan", "where": { "field": "f", "equals": [1] } }""", "$.patches.data[0].operations[0].where.equals")]
    [InlineData("""{ "op": "delete", "entity": "loan", "where": { "field": "" , "equals": 1 } }""", "$.patches.data[0].operations[0].where.field")]
    [InlineData("""{ "op": "delete", "entity": "loan", "where": "sku = 1" }""", "$.patches.data[0].operations[0].where")]
    public void MalformedDataOperationIsRejected(string operationJson, string expectedPath)
    {
        Assert.Contains(expectedPath, Paths(ChangesetValidator.Validate(WithDataOperation(operationJson))));
    }

    [Theory]
    [InlineData("""{ "op": "insert", "entity": "loan", "values": { "amount": 1 } }""")]
    [InlineData("""{ "op": "update", "entity": "loan", "where": { "field": "f", "equals": null }, "set": { "amount": 1 } }""")]
    [InlineData("""{ "op": "delete", "entity": "loan", "where": { "field": "f", "equals": true } }""")]
    public void ConformingDataOperationIsAccepted(string operationJson)
    {
        Assert.True(ChangesetValidator.Validate(WithDataOperation(operationJson)).Valid);
    }

    [Fact]
    public void DataBaseStateKindRequires030()
    {
        var doc = Valid();
        ((JsonArray)doc["provenance"]!["baseState"]!).Add(new JsonObject
        {
            ["kind"] = "data",
            ["ref"] = "data",
            ["fingerprint"] = "sha256:" + new string('d', 64),
        });
        var index = ((JsonArray)doc["provenance"]!["baseState"]!).Count - 1;

        doc["specVersion"] = "0.2.0";
        Assert.Contains($"$.provenance.baseState[{index}].kind", Paths(ChangesetValidator.Validate(doc)));

        doc["specVersion"] = "0.3.0";
        Assert.True(ChangesetValidator.Validate(doc).Valid);
    }

    [Fact]
    public void VerifiedDiffProfileIsStillAllowedAbove020()
    {
        var doc = Valid();
        doc["specVersion"] = "0.3.0";
        ((JsonObject)doc["patches"]!)["ui"] = new JsonArray(new JsonObject
        {
            ["profile"] = "verified-diff@0",
            ["artifactId"] = "screen-1",
            ["baseFingerprint"] = "sha256:" + new string('a', 64),
            ["diff"] = "@@ -1,1 +1,1 @@\n-old\n+new\n",
            ["newFingerprint"] = "sha256:" + new string('b', 64),
            ["explanation"] = "edit",
        });
        Assert.True(ChangesetValidator.Validate(doc).Valid);
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
