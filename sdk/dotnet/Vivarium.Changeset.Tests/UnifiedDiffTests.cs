namespace Vivarium.Changeset.Tests;

public class UnifiedDiffTests
{
    private const string Base = "line one\nline two\nline three\nline four\nline five";

    [Fact]
    public void IdenticalContentsProduceEmptyDiff()
    {
        Assert.Equal("", UnifiedDiff.Create(Base, Base));
        Assert.Equal(Base, UnifiedDiff.Apply(Base, ""));
        Assert.Equal(Base, UnifiedDiff.ReverseApply(Base, ""));
    }

    [Fact]
    public void RoundTripAppliesForwardAndBackward()
    {
        var next = "line one\nline 2\nline three\nline four\nline five\nline six";
        var diff = UnifiedDiff.Create(Base, next);
        Assert.Equal(next, UnifiedDiff.Apply(Base, diff));
        Assert.Equal(Base, UnifiedDiff.ReverseApply(next, diff));
    }

    [Fact]
    public void CreationFromEmptyDiffsFromZeroLines()
    {
        var content = "alpha\nbeta";
        var diff = UnifiedDiff.Create("", content);
        Assert.Equal(content, UnifiedDiff.Apply("", diff));
        Assert.Equal("", UnifiedDiff.ReverseApply(content, diff));
    }

    [Fact]
    public void DeletionToEmptyRoundTrips()
    {
        var diff = UnifiedDiff.Create(Base, "");
        Assert.Equal("", UnifiedDiff.Apply(Base, diff));
        Assert.Equal(Base, UnifiedDiff.ReverseApply("", diff));
    }

    [Fact]
    public void MultipleSeparatedHunksRoundTrip()
    {
        var baseContent = string.Join("\n", Enumerable.Range(1, 30).Select(i => $"line {i}"));
        var next = baseContent.Replace("line 3", "LINE 3").Replace("line 27", "LINE 27");
        var diff = UnifiedDiff.Create(baseContent, next);
        Assert.Equal(2, diff.Split('\n').Count(l => l.StartsWith("@@")));
        Assert.Equal(next, UnifiedDiff.Apply(baseContent, diff));
        Assert.Equal(baseContent, UnifiedDiff.ReverseApply(next, diff));
    }

    [Fact]
    public void MismatchedContextIsRefused()
    {
        var diff = UnifiedDiff.Create(Base, "line one\nCHANGED\nline three\nline four\nline five");
        Assert.Throws<InvalidOperationException>(() => UnifiedDiff.Apply("totally\ndifferent\ncontent", diff));
    }

    [Fact]
    public void MalformedDiffIsRefused()
    {
        Assert.Throws<FormatException>(() => UnifiedDiff.Apply(Base, "not a diff at all"));
    }

    [Fact]
    public void TrailingNewlinesAreLossless()
    {
        var a = "x\ny\n";
        var b = "x\ny";
        var diff = UnifiedDiff.Create(a, b);
        Assert.Equal(b, UnifiedDiff.Apply(a, diff));
        Assert.Equal(a, UnifiedDiff.ReverseApply(b, diff));
    }
}
