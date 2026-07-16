using System.Text.Json.Nodes;

namespace Vivarium.Changeset.Tests;

public class ChangesetFingerprintTests
{
    private static JsonObject MinimalDocument() => (JsonObject)JsonNode.Parse("""
        {
          "specVersion": "0.1.0",
          "intent": "test",
          "provenance": { "producedBy": "t", "createdAt": "2026-07-16T00:00:00Z", "baseState": [] },
          "patches": { "schema": [], "ui": [], "data": [] }
        }
        """)!;

    [Fact]
    public void FingerprintExcludesFingerprintAndApprovals()
    {
        var doc = MinimalDocument();
        var bare = ChangesetFingerprint.Of(doc);
        var stamped = ChangesetFingerprint.Stamp(doc);
        stamped["approvals"] = new JsonArray();
        Assert.Equal(bare, ChangesetFingerprint.Of(stamped));
    }

    [Fact]
    public void StampThenVerifyHolds()
    {
        var stamped = ChangesetFingerprint.Stamp(MinimalDocument());
        Assert.True(ChangesetFingerprint.Verify(stamped));
    }

    [Fact]
    public void TamperingBreaksVerification()
    {
        var stamped = ChangesetFingerprint.Stamp(MinimalDocument());
        stamped["intent"] = "tampered";
        Assert.False(ChangesetFingerprint.Verify(stamped));
    }

    [Fact]
    public void MissingFingerprintFailsVerification()
    {
        Assert.False(ChangesetFingerprint.Verify(MinimalDocument()));
    }

    [Fact]
    public void UnknownPrefixIsRejectedNeverGuessed()
    {
        var doc = MinimalDocument();
        doc["fingerprint"] = "sha512:abc";
        Assert.Throws<ArgumentException>(() => ChangesetFingerprint.Verify(doc));
    }

    [Fact]
    public void FingerprintIsKeyOrderIndependent()
    {
        var reordered = (JsonObject)JsonNode.Parse("""
            {
              "patches": { "data": [], "ui": [], "schema": [] },
              "provenance": { "baseState": [], "createdAt": "2026-07-16T00:00:00Z", "producedBy": "t" },
              "intent": "test",
              "specVersion": "0.1.0"
            }
            """)!;
        Assert.Equal(ChangesetFingerprint.Of(MinimalDocument()), ChangesetFingerprint.Of(reordered));
    }
}
