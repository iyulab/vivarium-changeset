using System.Text.Json.Nodes;

namespace Vivarium.Changeset.Tests;

public class ChangesetApprovalTests
{
    private static JsonObject Finalized() => new ChangesetBuilder(
            intent: "add a due date",
            producedBy: "test-suite",
            createdAt: "2026-09-23T00:00:00Z")
        .AddSchemaOp((JsonObject)JsonNode.Parse("""
            { "op": "field.add", "entity": "loan",
              "field": { "name": "dueDate", "type": "date" },
              "explanation": "stores the due date" }
            """)!)
        .Finalize();

    [Fact]
    public void ApprovalLeavesTheFingerprintIntactAndTheDocumentValid()
    {
        var doc = Finalized();
        var approved = ChangesetApproval.Add(doc, "reviewer-1", "2026-09-23T01:00:00Z");

        Assert.Equal(doc["fingerprint"]!.GetValue<string>(), approved["fingerprint"]!.GetValue<string>());
        Assert.Equal(doc["fingerprint"]!.GetValue<string>(), ChangesetFingerprint.Of(approved));
        Assert.True(ChangesetFingerprint.Verify(approved));
        Assert.True(ChangesetValidator.Validate(approved).Valid);
        Assert.True(JsonNode.DeepEquals(
            new JsonArray(new JsonObject
            {
                ["fingerprint"] = doc["fingerprint"]!.GetValue<string>(),
                ["approvedBy"] = "reviewer-1",
                ["approvedAt"] = "2026-09-23T01:00:00Z",
            }),
            approved["approvals"]));
    }

    [Fact]
    public void ApprovalReturnsACopy()
    {
        var doc = Finalized();
        var before = doc.DeepClone();
        var once = ChangesetApproval.Add(doc, "a", "2026-09-23T01:00:00Z");
        ChangesetApproval.Add(once, "b", "2026-09-23T02:00:00Z");

        Assert.True(JsonNode.DeepEquals(before, doc));
        Assert.Single(once["approvals"]!.AsArray());
    }

    [Fact]
    public void AnOmittedCommentAddsNoKey()
    {
        var approved = ChangesetApproval.Add(Finalized(), "a", "2026-09-23T01:00:00Z");
        Assert.False(approved["approvals"]![0]!.AsObject().ContainsKey("comment"));
    }

    [Fact]
    public void RoundTripFormatOfADateTimeOffsetIsAccepted()
    {
        // What the doc comment tells a .NET caller to pass.
        var at = new DateTimeOffset(2026, 9, 23, 1, 0, 0, TimeSpan.FromHours(9)).ToString("o");
        var approved = ChangesetApproval.Add(Finalized(), "a", at);
        Assert.Equal(at, approved["approvals"]![0]!["approvedAt"]!.GetValue<string>());
    }
}
