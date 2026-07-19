using System.Text.Json.Nodes;

namespace Vivarium.Changeset.Tests;

public class VerifiedDiffTests
{
    private static string RoundTrip(string baseContent, string next)
    {
        var diff = VerifiedDiff.Create(baseContent, next);
        Assert.NotEqual("", diff);
        Assert.Equal(next, VerifiedDiff.Apply(baseContent, diff));
        return diff;
    }

    [Fact]
    public void RoundTripSimpleLineChange() => RoundTrip("a\nb\nc\n", "a\nB\nc\n");

    [Fact]
    public void RoundTripInsertionAtStartAndDeletionAtEnd()
    {
        RoundTrip("a\nb\n", "x\na\nb\n");
        RoundTrip("a\nb\nc\n", "a\nb\n");
    }

    [Fact]
    public void RoundTripMixedCrlfLfIsByteFaithful()
    {
        var diff = RoundTrip("alpha\r\nbeta\ngamma\r\n", "alpha\r\nbeta2\ngamma\r\n");
        Assert.Contains("-beta\n+beta2\n", diff);
        Assert.Contains(" alpha\r\n", diff);
    }

    [Fact]
    public void RoundTripNoNewlineAtEndOfFileBothSides()
    {
        var diff = RoundTrip("line1\nline2", "line1\nline2!");
        var markers = diff.Split('\n').Count(l => l == "\\ No newline at end of file");
        Assert.Equal(2, markers);
    }

    [Fact]
    public void RoundTripEofNewlineStateChangeAloneProducesHunk()
    {
        RoundTrip("a\nb", "a\nb\n");
        RoundTrip("a\nb\n", "a\nb");
    }

    [Fact]
    public void RoundTripAppendingAfterIncompleteFinalLine() => RoundTrip("a\nb", "a\nb\nc");

    [Fact]
    public void RoundTripEmptyBaseAndToEmpty()
    {
        RoundTrip("", "a\n");
        RoundTrip("a\n", "");
    }

    [Fact]
    public void CreateReturnsEmptyForIdenticalContents() => Assert.Equal("", VerifiedDiff.Create("same\n", "same\n"));

    [Fact]
    public void ApplyIsFailClosedOnContextMismatch() =>
        Assert.Throws<InvalidOperationException>(() => VerifiedDiff.Apply("actual\n", "@@ -1,1 +1,1 @@\n-not-the-base\n+x\n"));

    [Fact]
    public void ApplyIsFailClosedNoFuzz() =>
        Assert.Throws<InvalidOperationException>(() => VerifiedDiff.Apply("a\nb\n", "@@ -2,1 +2,1 @@\n-a\n+A\n"));

    [Fact]
    public void ApplyIsFailClosedOnNewlineStateMismatch() =>
        Assert.Throws<InvalidOperationException>(
            () => VerifiedDiff.Apply("a\n", "@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n"));

    [Fact]
    public void ParseRejectsDialectViolations()
    {
        Assert.Throws<FormatException>(() => VerifiedDiff.ParseStrict(""));
        Assert.Throws<FormatException>(() => VerifiedDiff.ParseStrict("--- a\n+++ b\n@@ -1,1 +1,1 @@\n-a\n+b\n"));
        Assert.Throws<FormatException>(() => VerifiedDiff.ParseStrict("@@ -1,1 +1,1 @@\n-a\n+b\ngarbage\n"));
        Assert.Throws<FormatException>(() => VerifiedDiff.ParseStrict("@@ -1,2 +1,1 @@\n-a\n+b\n"));
        Assert.Throws<FormatException>(() => VerifiedDiff.ParseStrict("@@ -1,1 +1,1 @@\n-a\n+A\n@@ -1,1 +2,1 @@\n-a\n+B\n"));
        Assert.Throws<FormatException>(() => VerifiedDiff.ParseStrict("@@ -1 +1 @@\n-a\n+b\n"));
    }

    [Fact]
    public void PropertyRandomContentsRoundTripByteExact()
    {
        // deterministic PRNG — mirrors the TypeScript property test
        var seed = 0xC0FFEE;
        double Rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / (double)0x7fffffff; }
        string[] alphabet = ["a", "b", "line", "x\r", "", "é€"];
        string RandContent()
        {
            var n = (int)(Rand() * 8);
            var lines = Enumerable.Range(0, n).Select(_ => alphabet[(int)(Rand() * alphabet.Length)]);
            var s = string.Join("\n", lines);
            if (s != "" && Rand() < 0.7) s += "\n";
            return s;
        }
        for (var i = 0; i < 200; i++)
        {
            var baseContent = RandContent();
            var next = RandContent();
            if (baseContent == next) continue;
            var diff = VerifiedDiff.Create(baseContent, next);
            Assert.Equal(next, VerifiedDiff.Apply(baseContent, diff));
        }
    }

    [Fact]
    public void VerifyAgainstBaseLayerTwoSemantics()
    {
        var baseContent = "const title = \"Loans\";\n";
        var next = "const title = \"Active loans\";\n";
        var patch = new JsonObject
        {
            ["profile"] = "verified-diff@0",
            ["artifactId"] = "screen-loans",
            ["baseFingerprint"] = ChangesetFingerprint.OfArtifact(baseContent),
            ["diff"] = VerifiedDiff.Create(baseContent, next),
            ["newFingerprint"] = ChangesetFingerprint.OfArtifact(next),
            ["explanation"] = "Rename the title",
        };
        var ok = VerifiedDiff.VerifyAgainstBase(patch, baseContent);
        Assert.True(ok.Ok);
        Assert.Equal(next, ok.NewContent);

        var drifted = VerifiedDiff.VerifyAgainstBase(patch, "const title = \"Loans\"; // drifted\n");
        Assert.False(drifted.Ok);
        Assert.Contains("layer 2 ①", drifted.Errors[0].Message);

        var wrongNew = (JsonObject)patch.DeepClone();
        wrongNew["newFingerprint"] = ChangesetFingerprint.OfArtifact("something else");
        var rejected = VerifiedDiff.VerifyAgainstBase(wrongNew, baseContent);
        Assert.False(rejected.Ok);
        Assert.Contains("layer 2 ②", rejected.Errors[0].Message);

        var badDiff = (JsonObject)patch.DeepClone();
        badDiff["diff"] = "@@ -1,1 +1,1 @@\n-nope\n+x\n";
        var notApplied = VerifiedDiff.VerifyAgainstBase(badDiff, baseContent);
        Assert.False(notApplied.Ok);
        Assert.Contains("does not apply", notApplied.Errors[0].Message);
    }

    [Fact]
    public void BuilderVerifiedDiffPatchDerivedNoOpRefusingLiftsSpecVersion()
    {
        var builder = new ChangesetBuilder("Rename title", "test-suite", "2026-07-19T00:00:00Z")
            .AddVerifiedDiffPatch("screen-loans", "const title = \"Loans\";\n", "const title = \"Active loans\";\n", "rename title");
        var doc = builder.Finalize();
        Assert.Equal("0.2.0", doc["specVersion"]!.GetValue<string>());
        Assert.True(ChangesetValidator.Validate(doc).Valid);
        Assert.True(ChangesetFingerprint.Verify(doc));

        Assert.Throws<ChangesetValidationException>(() =>
            new ChangesetBuilder("noop", "test-suite", "2026-07-19T00:00:00Z")
                .AddVerifiedDiffPatch("x", "same\n", "same\n", "noop"));
    }
}
