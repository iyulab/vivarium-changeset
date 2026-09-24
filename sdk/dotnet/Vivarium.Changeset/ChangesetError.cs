namespace Vivarium.Changeset;

/// <summary>
/// One located-failure shape for the whole SDK.
///
/// <para>Validation has reported <c>{ Path, Message }</c> since 0.1, and consumers act
/// on it without reading prose. Parsing and verification — the dialect parser, the
/// canonicalizer, the fingerprint reader — reported the same class of failure as bare
/// <see cref="FormatException"/> / <see cref="InvalidOperationException"/> with the
/// location inside the sentence, so the only way to act on one was to parse English.
/// The validator felt this first: it caught a dialect failure and spliced the message
/// into its own, which located the error at the patch and threw away where inside the
/// diff it happened.</para>
///
/// <para>Both now raise this, so "where" is a field in either case. The TypeScript SDK
/// carries the identical shape and the identical message text — the cross-SDK fixtures
/// compare them character for character.</para>
/// </summary>
public class ChangesetError : Exception
{
    /// <summary>The located reasons. A parse refusal usually carries one — parsers stop
    /// at the first thing they cannot read — while validation reports everything it found.</summary>
    public IReadOnlyList<ValidationError> Errors { get; }

    /// <summary>Create a refusal whose message is the subject followed by one line per error.</summary>
    /// <param name="subject">What was refused — one of the <see cref="ChangesetErrorSubject"/> strings.</param>
    /// <param name="errors">The located reasons, in the order found.</param>
    public ChangesetError(string subject, IReadOnlyList<ValidationError> errors)
        : base($"{subject}:\n" + string.Join("\n", errors.Select(Render)))
    {
        Errors = errors;
    }

    /// <summary>One rendered line: an empty path means the subject as a whole, not a nameless member.</summary>
    private static string Render(ValidationError e) =>
        e.Path.Length == 0 ? $"  {e.Message}" : $"  {e.Path}: {e.Message}";

    /// <summary>The common case: one failure, known location.</summary>
    public static ChangesetError At(string subject, string path, string message) =>
        new(subject, [new ValidationError(path, message)]);

    /// <summary>
    /// Re-root these errors under <paramref name="prefix"/> — how a caller that owns a
    /// wider document lifts a fragment's failures into its own list without nesting
    /// them. The dialect parser says <c>hunk[2]</c>; the validator says
    /// <c>$.patches.ui[0].diff.hunk[2]</c>.
    /// </summary>
    public IReadOnlyList<ValidationError> Rebase(string prefix) =>
        [.. Errors.Select(e => new ValidationError(
            e.Path.Length == 0 ? prefix : $"{prefix}.{e.Path}", e.Message))];
}

/// <summary>The subject strings, fixed so both SDKs and the cross-SDK fixtures agree on them.</summary>
public static class ChangesetErrorSubject
{
    /// <summary>A whole document failed structural validation (spec §8).</summary>
    public const string Validation = "changeset failed validation";
    /// <summary>A <c>verified-diff@0</c> diff is outside its dialect (spec §5.2.2).</summary>
    public const string Dialect = "outside the verified-diff dialect";
    /// <summary>A unified diff could not be read or applied.</summary>
    public const string UnifiedDiff = "outside the unified-diff dialect";
    /// <summary>A value cannot be canonicalized under RFC 8785 (JCS).</summary>
    public const string Canonicalization = "cannot canonicalize";
    /// <summary>A document fingerprint cannot be read, e.g. an unknown prefix (spec §6).</summary>
    public const string Fingerprint = "cannot read fingerprint";
    /// <summary>A document cannot be approved (spec §7).</summary>
    public const string Approval = "cannot approve";
}
