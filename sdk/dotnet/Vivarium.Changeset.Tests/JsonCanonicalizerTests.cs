using System.Text.Json;

namespace Vivarium.Changeset.Tests;

public class JsonCanonicalizerTests
{
    private static string C(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return JsonCanonicalizer.Canonicalize(doc.RootElement);
    }

    [Theory]
    [InlineData(4.5, "4.5")]
    [InlineData(1e30, "1e+30")]
    [InlineData(2e-3, "0.002")]
    [InlineData(10.0, "10")]
    [InlineData(0.0, "0")]
    [InlineData(1e21, "1e+21")]
    [InlineData(1e-7, "1e-7")]
    [InlineData(1e-6, "0.000001")]
    [InlineData(1e20, "100000000000000000000")]
    [InlineData(-4.5, "-4.5")]
    [InlineData(9007199254740992.0, "9007199254740992")]
    [InlineData(333333333.3333333, "333333333.3333333")]
    public void NumberSerializationFollowsEcmaScriptSemantics(double value, string expected)
    {
        Assert.Equal(expected, JsonCanonicalizer.FormatNumber(value));
    }

    [Fact]
    public void NegativeZeroSerializesAsZero()
    {
        Assert.Equal("0", JsonCanonicalizer.FormatNumber(-0.0));
    }

    [Fact]
    public void IJsonViolationsAreRejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => JsonCanonicalizer.FormatNumber(double.NaN));
        Assert.Throws<ArgumentOutOfRangeException>(() => JsonCanonicalizer.FormatNumber(double.PositiveInfinity));
    }

    [Fact]
    public void MemberOrderingIsInsertionOrderIndependent()
    {
        Assert.Equal("{\"a\":2,\"b\":1}", C("{\"b\":1,\"a\":2}"));
        Assert.Equal("{\"a\":2,\"b\":1}", C("{\"a\":2,\"b\":1}"));
        Assert.Equal("{\"z\":2,\"é\":1}", C("{\"é\":1,\"z\":2}"));
    }

    [Fact]
    public void NestedStructuresCanonicalizeRecursively()
    {
        Assert.Equal(
            "{\"outer\":{\"a\":{\"deep\":[]},\"b\":[true,null,\"x\"]}}",
            C("{\"outer\":{\"b\":[true,null,\"x\"],\"a\":{\"deep\":[]}}}"));
    }

    [Fact]
    public void ControlCharactersUseTwoCharEscapesThenLowercaseUnicode()
    {
        using var doc = JsonDocument.Parse("[\"line\\nbreak \\\"quoted\\\" \\\\ € \\u0007\"]");
        Assert.Equal(
            "[\"line\\nbreak \\\"quoted\\\" \\\\ € \\u0007\"]",
            JsonCanonicalizer.Canonicalize(doc.RootElement));
    }
}
