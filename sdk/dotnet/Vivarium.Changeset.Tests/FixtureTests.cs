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

    [Fact]
    public void ValidationMessageFixturesReproduce()
    {
        // Cross-SDK message parity: the exact (path, message) list a document
        // produces is part of the contract — the validation error surface is the
        // spec-delivery channel for authoring agents. This fixture is byte-identical
        // across the .NET and TypeScript SDKs; the assertion is order-sensitive.
        foreach (var vector in Load("validation-messages.json").EnumerateArray())
        {
            var name = vector.GetProperty("name").GetString();
            var result = ChangesetValidator.Validate(JsonNode.Parse(vector.GetProperty("document").GetRawText()));
            var expected = vector.GetProperty("errors").EnumerateArray()
                .Select(e => (Path: e.GetProperty("path").GetString()!, Message: e.GetProperty("message").GetString()!))
                .ToList();
            var actual = result.Errors.Select(e => (e.Path, e.Message)).ToList();
            Assert.True(expected.SequenceEqual(actual),
                $"case: {name}\n  expected: {string.Join(" | ", expected.Select(e => $"{e.Path}: {e.Message}"))}" +
                $"\n  actual:   {string.Join(" | ", actual.Select(e => $"{e.Path}: {e.Message}"))}");
        }
    }

    [Fact]
    public void BaseStateTighteningFixturesReproduce()
    {
        foreach (var vector in Load("base-state.json").EnumerateArray())
        {
            var name = vector.GetProperty("name").GetString();
            var expectValid = vector.GetProperty("expect").GetString() == "valid";
            var result = ChangesetValidator.Validate(JsonNode.Parse(vector.GetProperty("document").GetRawText()));
            Assert.True(expectValid == result.Valid,
                $"case: {name} — expected {(expectValid ? "valid" : "invalid")}, errors: " +
                string.Join("; ", result.Errors.Select(e => $"{e.Path}: {e.Message}")));
        }
    }

    [Fact]
    public void DataPatchFixturesReproduce()
    {
        foreach (var vector in Load("data-patch.json").EnumerateArray())
        {
            var name = vector.GetProperty("name").GetString();
            var expectValid = vector.GetProperty("expect").GetString() == "valid";
            var result = ChangesetValidator.Validate(JsonNode.Parse(vector.GetProperty("document").GetRawText()));
            Assert.True(expectValid == result.Valid,
                $"case: {name} — expected {(expectValid ? "valid" : "invalid")}, errors: " +
                string.Join("; ", result.Errors.Select(e => $"{e.Path}: {e.Message}")));
        }
    }

    [Fact]
    public void VerifiedDiffDialectFixturesReproduce()
    {
        foreach (var vector in Load("verified-diff.json").EnumerateArray())
        {
            var name = vector.GetProperty("name").GetString();
            var layer = vector.GetProperty("layer").GetString();
            var expect = vector.GetProperty("expect").GetString();
            var document = JsonNode.Parse(vector.GetProperty("document").GetRawText());
            var structural = ChangesetValidator.Validate(document);
            if (layer == "structural")
            {
                Assert.True((expect == "valid") == structural.Valid, $"case: {name} (structural)");
                continue;
            }
            Assert.True(structural.Valid, $"case: {name} must be structurally valid — errors: " +
                string.Join("; ", structural.Errors.Select(e => $"{e.Path}: {e.Message}")));
            var patch = (JsonObject)JsonNode.Parse(vector.GetProperty("patch").GetRawText())!;
            var baseContent = vector.GetProperty("base").GetString()!;
            var result = VerifiedDiff.VerifyAgainstBase(patch, baseContent);
            if (expect == "applies")
            {
                Assert.True(result.Ok, $"case: {name} must verify against base — errors: " +
                    string.Join("; ", result.Errors.Select(e => $"{e.Path}: {e.Message}")));
                Assert.Equal(vector.GetProperty("applied").GetString(), result.NewContent);
            }
            else
            {
                Assert.False(result.Ok, $"case: {name} must be rejected against base");
            }
        }
    }
    /// <summary>
    /// The refusal subject ("outside the verified-diff dialect", "cannot canonicalize",
    /// ...) is a literal duplicated in both SDKs. Two of the five were already locked by
    /// the validation-message vectors; the other three could drift apart without anything
    /// failing, because nothing compared them. These vectors compare them.
    ///
    /// Each op is the same probe on both sides. If the inputs ever diverge, the messages
    /// diverge with them and this fails on one side — which is the point.
    /// </summary>
    [Fact]
    public void RefusalSubjectsReproduceAcrossTheSdks()
    {
        foreach (var vector in Load("refusal-subjects.json").EnumerateArray())
        {
            var name = vector.GetProperty("name").GetString()!;
            var op = vector.GetProperty("op").GetString()!;
            var input = vector.TryGetProperty("input", out var i) ? i.GetString()! : "";

            var thrown = Record.Exception(() => Probe(op, input, vector));
            var error = Assert.IsAssignableFrom<ChangesetError>(thrown);

            var expected = vector.GetProperty("errors").EnumerateArray()
                .Select(e => (Path: e.GetProperty("path").GetString()!, Message: e.GetProperty("message").GetString()!))
                .ToArray();
            Assert.Equal(expected.Length, error.Errors.Count);
            for (var k = 0; k < expected.Length; k++)
            {
                Assert.Equal(expected[k].Path, error.Errors[k].Path);
                Assert.Equal(expected[k].Message, error.Errors[k].Message);
            }

            // The subject heads the rendered message; comparing the whole line keeps both
            // the subject and the rendering locked, not just one of them.
            var rendered = string.Join("\n", expected.Select(e =>
                e.Path.Length == 0 ? $"  {e.Message}" : $"  {e.Path}: {e.Message}"));
            Assert.Equal($"{vector.GetProperty("subject").GetString()}:\n{rendered}", error.Message);
            Assert.NotNull(name);
        }
    }

    private static void Probe(string op, string input, JsonElement vector)
    {
        switch (op)
        {
            case "verifiedDiff.parse":
                VerifiedDiff.ParseStrict(input);
                break;
            case "unifiedDiff.apply":
                UnifiedDiff.Apply(vector.GetProperty("base").GetString()!, input);
                break;
            case "fingerprint.verify":
                ChangesetFingerprint.Verify(new JsonObject { ["fingerprint"] = input, ["intent"] = "x" });
                break;
            case "canonicalize.nonFinite":
                JsonCanonicalizer.FormatNumber(double.NaN);
                break;
            default:
                throw new Xunit.Sdk.XunitException($"unknown probe: {op}");
        }
    }

}
