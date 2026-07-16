using System.Text.Json;
using System.Text.Json.Nodes;

namespace Vivarium.Changeset.Tests;

/// <summary>
/// Conformance harness over spec/fixtures — the same vectors the TypeScript SDK
/// runs. Passing these proves cross-SDK fingerprint agreement (fixture hashes
/// were produced independently).
/// </summary>
public class FixtureTests
{
    private static readonly string FixturesDir = FindFixturesDir();

    private static string FindFixturesDir()
    {
        // walk up from the test binary to the repo root's spec/fixtures
        var dir = AppContext.BaseDirectory;
        while (dir is not null)
        {
            var candidate = Path.Combine(dir, "spec", "fixtures");
            if (Directory.Exists(candidate)) return candidate;
            dir = Path.GetDirectoryName(dir);
        }
        throw new DirectoryNotFoundException("spec/fixtures not found above test binary");
    }

    private static JsonElement Load(string name)
    {
        var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(FixturesDir, name)));
        return doc.RootElement;
    }

    [Fact]
    public void CanonicalizationFixturesReproduce()
    {
        foreach (var vector in Load("canonicalization.json").EnumerateArray())
        {
            var name = vector.GetProperty("name").GetString();
            var canonical = JsonCanonicalizer.Canonicalize(vector.GetProperty("input"));
            Assert.Equal(vector.GetProperty("canonical").GetString(), canonical);
        }
    }

    [Fact]
    public void FingerprintFixturesReproduce()
    {
        foreach (var vector in Load("fingerprint.json").EnumerateArray())
        {
            var fingerprint = ChangesetFingerprint.Of(vector.GetProperty("document"));
            Assert.Equal(vector.GetProperty("fingerprint").GetString(), fingerprint);
        }
    }

    [Fact]
    public void GateFixtureApprovedValidVerifies()
    {
        var document = (JsonObject)JsonObject.Create(Load("gate-approved-valid.json").GetProperty("document"))!;
        Assert.True(ChangesetFingerprint.Verify(document));
        Assert.Equal(
            document["fingerprint"]!.GetValue<string>(),
            document["approvals"]![0]!["fingerprint"]!.GetValue<string>());
    }

    [Fact]
    public void GateFixtureTamperedContentMustRefuse()
    {
        var document = (JsonObject)JsonObject.Create(Load("gate-tampered-content.json").GetProperty("document"))!;
        Assert.False(ChangesetFingerprint.Verify(document));
    }

    [Fact]
    public void ValidationFixturesReproduce()
    {
        foreach (var vector in Load("validation.json").EnumerateArray())
        {
            var name = vector.GetProperty("name").GetString();
            var expectValid = vector.GetProperty("expect").GetString() == "valid";
            var result = ChangesetValidator.Validate(JsonNode.Parse(vector.GetProperty("document").GetRawText()));
            Assert.True(expectValid == result.Valid,
                $"case: {name} — expected {(expectValid ? "valid" : "invalid")}, errors: " +
                string.Join("; ", result.Errors.Select(e => $"{e.Path}: {e.Message}")));
        }
    }
}
