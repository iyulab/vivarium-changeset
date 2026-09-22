using System.Text.Json;
using System.Text.Json.Nodes;

namespace Vivarium.Changeset;

public sealed record ValidationError(string Path, string Message);

public sealed record ValidationResult(bool Valid, IReadOnlyList<ValidationError> Errors);

/// <summary>
/// Layer-1 structural validation of a parsed changeset document (spec §8).
/// Complete (base-supplied) verification of verified-diff patches is a
/// separate operation — see <see cref="VerifiedDiff.VerifyAgainstBase"/>.
/// </summary>
public static class ChangesetValidator
{
    /// <summary>Supported spec versions, ordered ascending — position is precedence.</summary>
    public static readonly string[] SupportedSpecVersions = ["0.1.0", "0.2.0", "0.3.0", "0.4.0"];

    /// <summary>Closed <c>baseState.kind</c> vocabulary (spec §4). <c>data</c> is gated on 0.3.0.</summary>
    public static readonly string[] BaseStateKinds = ["schema", "ui-artifact", "changeset", "data"];

    /// <summary>Closed <c>patches.ui[].profile</c> vocabulary.</summary>
    public static readonly string[] UiPatchProfiles = ["whole-artifact@0", "verified-diff@0"];

    private static readonly Dictionary<string, string[]> SchemaOps = new()
    {
        ["entity.create"] = ["op", "entity", "fields", "explanation"],
        ["entity.rename"] = ["op", "entity", "newName", "explanation"],
        ["entity.remove"] = ["op", "entity", "explanation"],
        ["field.add"] = ["op", "entity", "field", "explanation"],
        ["field.rename"] = ["op", "entity", "field", "newName", "explanation"],
        ["field.retype"] = ["op", "entity", "field", "newType", "explanation"],
        ["field.remove"] = ["op", "entity", "field", "explanation"],
        ["constraint.add"] = ["op", "entity", "constraint", "explanation"],
        ["constraint.remove"] = ["op", "entity", "constraint", "explanation"],
    };

    private static readonly string[] LogicalTypes = ["string", "number", "boolean", "date", "datetime", "reference", "json"];

    /// <summary>Per-operation required members (spec §5.3) — the data facet's counterpart to <see cref="SchemaOps"/>.</summary>
    private static readonly Dictionary<string, string[]> DataOps = new()
    {
        ["insert"] = ["op", "entity", "values"],
        ["update"] = ["op", "entity", "where", "set"],
        ["delete"] = ["op", "entity", "where"],
    };

    public static ValidationResult Validate(string json)
    {
        JsonNode? node;
        try { node = JsonNode.Parse(json); }
        catch (JsonException e)
        {
            return new ValidationResult(false, [new ValidationError("$", $"document is not parseable JSON: {e.Message}")]);
        }
        return Validate(node);
    }

    public static ValidationResult Validate(JsonNode? document)
    {
        var errors = new List<ValidationError>();
        void Err(string path, string message) => errors.Add(new ValidationError(path, message));

        if (document is not JsonObject doc)
            return new ValidationResult(false, [new ValidationError("$", "document must be a JSON object")]);

        void CheckMembers(JsonObject obj, string[] allowed, string path)
        {
            foreach (var (k, _) in obj)
                if (!allowed.Contains(k)) Err($"{path}.{k}", "unknown member (closed model, spec §2)");
        }

        static bool TryString(JsonNode? n, out string s)
        {
            if (n is JsonValue v && v.TryGetValue(out string? inner)) { s = inner; return true; }
            s = "";
            return false;
        }

        // `where` is closed to `{ field, equals: <literal> }` — spec §5.3, no expressions.
        void CheckWhere(JsonNode? where, string path)
        {
            if (where is not JsonObject w) { Err(path, "must be an object { field, equals } (spec §5.3)"); return; }
            CheckMembers(w, ["field", "equals"], path);
            if (!TryString(w["field"], out var field) || field == "")
                Err($"{path}.field", "required non-empty string");
            if (!w.ContainsKey("equals")) Err($"{path}.equals", "required member missing");
            else
            {
                var kind = w["equals"]?.GetValueKind() ?? JsonValueKind.Null;
                if (kind is not (JsonValueKind.String or JsonValueKind.Number
                    or JsonValueKind.True or JsonValueKind.False or JsonValueKind.Null))
                    Err($"{path}.equals", "must be a literal — string, number, boolean, or null (spec §5.3, v0 keeps expressions out)");
            }
        }

        // Closed-vocabulary rejections enumerate the accepted values — the error
        // surface is the spec-delivery channel for authoring agents, so a rejection
        // that names what IS accepted turns a guessing loop into a one-shot fix.
        static string Supported(IEnumerable<string> vals, string? note = null)
            => note is null
                ? $"(supported: {string.Join(", ", vals)})"
                : $"(supported: {string.Join(", ", vals)}; {note})";

        CheckMembers(doc, ["specVersion", "id", "intent", "provenance", "patches", "fingerprint", "approvals"], "$");

        if (!TryString(doc["specVersion"], out var specVersion) || !SupportedSpecVersions.Contains(specVersion))
            Err("$.specVersion", $"unsupported specVersion: {doc["specVersion"]?.ToJsonString() ?? "undefined"} {Supported(SupportedSpecVersions)}");
        // SupportedSpecVersions is ordered ascending, so position is precedence.
        // Version-gated *features* use this (spec §9); tightenings never do.
        var declared = Array.IndexOf(SupportedSpecVersions, specVersion);
        bool AtLeast(string v) => declared >= 0 && declared >= Array.IndexOf(SupportedSpecVersions, v);
        if (!TryString(doc["intent"], out var intent) || intent.Trim() == "")
            Err("$.intent", "intent is required and must be a non-empty string");

        // provenance
        if (doc["provenance"] is not JsonObject prov)
            Err("$.provenance", doc.ContainsKey("provenance") ? "provenance must be an object" : "provenance is required");
        else
        {
            CheckMembers(prov, ["producedBy", "createdAt", "baseState", "editContext"], "$.provenance");
            if (!TryString(prov["producedBy"], out _)) Err("$.provenance.producedBy", "required string");
            if (!TryString(prov["createdAt"], out _)) Err("$.provenance.createdAt", "required RFC 3339 string");
            if (prov["baseState"] is not JsonArray baseState) Err("$.provenance.baseState", "required array");
            else
                for (var i = 0; i < baseState.Count; i++)
                {
                    var path = $"$.provenance.baseState[{i}]";
                    if (baseState[i] is not JsonObject entry)
                    {
                        Err(path, "must be an object (spec §4 — malformed entries are validation failures, not crashes)");
                        continue;
                    }
                    CheckMembers(entry, ["kind", "ref", "fingerprint"], path);
                    if (!TryString(entry["kind"], out var kind) || !BaseStateKinds.Contains(kind))
                        Err($"{path}.kind", $"unknown baseState kind: {entry["kind"]?.ToJsonString() ?? "undefined"} {Supported(BaseStateKinds, "closed vocabulary, spec §4")}");
                    else if (kind == "data" && !AtLeast("0.3.0"))
                        Err($"{path}.kind", $"baseState kind \"data\" requires specVersion 0.3.0 or later (document declares {doc["specVersion"]?.ToJsonString() ?? "undefined"})");
                    if (!TryString(entry["ref"], out var entryRef) || entryRef == "")
                        Err($"{path}.ref", "required non-empty string");
                    if (!TryString(entry["fingerprint"], out var entryFp) || !entryFp.StartsWith(ChangesetFingerprint.Prefix, StringComparison.Ordinal))
                        Err($"{path}.fingerprint", "must be a sha256:-prefixed string");
                }
        }

        // patches
        if (doc["patches"] is not JsonObject patches)
        {
            Err("$.patches", doc.ContainsKey("patches")
                ? "patches must be an object with facet keys (schema, ui, data)"
                : "patches is required");
            return new ValidationResult(errors.Count == 0, errors);
        }
        CheckMembers(patches, ["schema", "ui", "data"], "$.patches");

        JsonArray Facet(string name)
        {
            var node = patches[name];
            if (node is null) return [];
            if (node is JsonArray arr) return arr;
            Err($"$.patches.{name}", "must be an array");
            return [];
        }
        var schema = Facet("schema");
        var ui = Facet("ui");
        var data = Facet("data");
        if (schema.Count + ui.Count + data.Count == 0)
            Err("$.patches", "at least one facet must be non-empty (spec §3)");

        for (var i = 0; i < schema.Count; i++)
        {
            var path = $"$.patches.schema[{i}]";
            if (schema[i] is not JsonObject p) { Err(path, "must be an object"); continue; }
            if (!TryString(p["op"], out var op) || !SchemaOps.TryGetValue(op, out var allowed))
            {
                Err($"{path}.op", $"unknown schema operation: {p["op"]?.ToJsonString() ?? "undefined"} {Supported(SchemaOps.Keys)}");
                continue;
            }
            CheckMembers(p, allowed, path);
            foreach (var req in allowed)
                if (!p.ContainsKey(req)) Err($"{path}.{req}", "required member missing");
            if (!TryString(p["explanation"], out var expl) || expl == "") Err($"{path}.explanation", "explanation required");
            var fields = new List<JsonNode?>();
            if (op == "entity.create" && p["fields"] is not JsonArray) Err($"{path}.fields", "must be an array");
            if (op == "entity.create" && p["fields"] is JsonArray fs) fields.AddRange(fs);
            else if (op == "field.add" && p["field"] is not null) fields.Add(p["field"]);
            foreach (var f in fields)
            {
                var ftype = (f as JsonObject)?["type"];
                if (!TryString(ftype, out var t) || !LogicalTypes.Contains(t))
                    Err(path, $"unknown logical type: {ftype?.ToJsonString() ?? "undefined"} {Supported(LogicalTypes)}");
                else if (t == "reference" && !TryString((f as JsonObject)?["target"], out _))
                    Err(path, "reference type requires target");
            }
            if (op == "field.retype" && (!TryString(p["newType"], out var nt) || !LogicalTypes.Contains(nt)))
                Err($"{path}.newType", $"unknown logical type: {p["newType"]?.ToJsonString() ?? "undefined"} {Supported(LogicalTypes)}");
        }

        for (var i = 0; i < ui.Count; i++)
        {
            var path = $"$.patches.ui[{i}]";
            if (ui[i] is not JsonObject p) { Err(path, "must be an object"); continue; }
            if (TryString(p["profile"], out var uiProfile) && uiProfile == "verified-diff@0")
            {
                if (!AtLeast("0.2.0"))
                {
                    Err($"{path}.profile", $"verified-diff@0 requires specVersion 0.2.0 or later (document declares {doc["specVersion"]?.ToJsonString() ?? "undefined"})");
                    continue;
                }
                CheckMembers(p, ["profile", "artifactId", "baseFingerprint", "diff", "newFingerprint", "explanation"], path);
                if (!TryString(p["artifactId"], out _)) Err($"{path}.artifactId", "required string");
                if (!TryString(p["explanation"], out var vexpl) || vexpl == "") Err($"{path}.explanation", "explanation required");
                var hasBaseFp = TryString(p["baseFingerprint"], out var vBaseFp);
                if (p.ContainsKey("baseFingerprint") && p["baseFingerprint"] is null)
                    Err($"{path}.baseFingerprint", "must not be null — creation is whole-artifact@0's job (spec §5.2.2)");
                else if (!hasBaseFp || !vBaseFp.StartsWith(ChangesetFingerprint.Prefix, StringComparison.Ordinal))
                    Err($"{path}.baseFingerprint", "must be a sha256:-prefixed string");
                if (!TryString(p["newFingerprint"], out var vNewFp) || !vNewFp.StartsWith(ChangesetFingerprint.Prefix, StringComparison.Ordinal))
                    Err($"{path}.newFingerprint", "must be a sha256:-prefixed string");
                else if (hasBaseFp && vNewFp == vBaseFp)
                    Err($"{path}.newFingerprint", "no-op patch: newFingerprint equals baseFingerprint (spec §5.2.2)");
                if (!TryString(p["diff"], out var vDiff))
                    Err($"{path}.diff", "required string (the diff is the review surface)");
                else
                {
                    try { VerifiedDiff.ParseStrict(vDiff); }
                    // Lift the dialect's own located failures into this list rather than
                    // splicing its sentence into one of ours. Splicing put every diff
                    // failure at `<patch>.diff` however deep inside the diff it happened,
                    // so a reader got the fact and not the place. Rebase keeps it flat.
                    catch (ChangesetError e)
                    {
                        foreach (var lifted in e.Rebase($"{path}.diff")) Err(lifted.Path, lifted.Message);
                    }
                }
                continue;
            }
            CheckMembers(p, ["profile", "artifactId", "baseFingerprint", "newContent", "reviewDiff", "explanation"], path);
            if (!TryString(p["profile"], out var profile) || profile != "whole-artifact@0")
            {
                Err($"{path}.profile", $"unknown UI patch profile: {p["profile"]?.ToJsonString() ?? "undefined"} {Supported(UiPatchProfiles)}");
                continue;
            }
            if (!TryString(p["artifactId"], out _)) Err($"{path}.artifactId", "required string");
            var hasNewContent = TryString(p["newContent"], out var newContent);
            if (!hasNewContent) Err($"{path}.newContent", "required string");
            var hasReviewDiff = TryString(p["reviewDiff"], out var reviewDiff);
            if (!hasReviewDiff) Err($"{path}.reviewDiff", "required string (reviewability invariant)");
            if (!TryString(p["explanation"], out var uexpl) || uexpl == "") Err($"{path}.explanation", "explanation required");
            if (hasNewContent && hasReviewDiff)
            {
                try
                {
                    var recoveredBase = UnifiedDiff.ReverseApply(newContent, reviewDiff);
                    var bf = p["baseFingerprint"];
                    if (p.ContainsKey("baseFingerprint") && bf is null)
                    {
                        if (recoveredBase != "")
                            Err($"{path}.reviewDiff", "creation patch (baseFingerprint null) must diff from empty");
                    }
                    else if (TryString(bf, out var baseFingerprint))
                    {
                        if (ChangesetFingerprint.OfArtifact(recoveredBase) != baseFingerprint)
                            Err($"{path}.reviewDiff", "diff is inconsistent: recovered base does not match baseFingerprint (spec §5.2)");
                    }
                    else
                    {
                        Err($"{path}.baseFingerprint", "must be a sha256: string or null");
                    }
                }
                catch (Exception e) when (e is FormatException or InvalidOperationException)
                {
                    Err($"{path}.reviewDiff", $"diff does not apply to newContent: {e.Message}");
                }
            }
        }

        var seen = new HashSet<string>();
        for (var i = 0; i < data.Count; i++)
        {
            var path = $"$.patches.data[{i}]";
            if (data[i] is not JsonObject p) { Err(path, "must be an object"); continue; }
            CheckMembers(p, ["id", "explanation", "operations"], path);
            if (!TryString(p["id"], out var id) || id == "") Err($"{path}.id", "required string");
            else if (!seen.Add(id)) Err($"{path}.id", $"duplicate data patch id: {id}");
            if (!TryString(p["explanation"], out var dexpl) || dexpl == "") Err($"{path}.explanation", "explanation required");
            if (p["operations"] is not JsonArray operations) Err($"{path}.operations", "required array");
            else
                for (var j = 0; j < operations.Count; j++)
                {
                    var opPath = $"{path}.operations[{j}]";
                    if (operations[j] is not JsonObject op) { Err(opPath, "must be an object"); continue; }
                    if (!TryString(op["op"], out var dop) || !DataOps.TryGetValue(dop, out var allowed))
                    {
                        Err($"{opPath}.op", $"unknown data operation: {op["op"]?.ToJsonString() ?? "undefined"} {Supported(DataOps.Keys)}");
                        continue;
                    }
                    CheckMembers(op, allowed, opPath);
                    foreach (var req in allowed)
                        if (!op.ContainsKey(req)) Err($"{opPath}.{req}", "required member missing");
                    if (!TryString(op["entity"], out var entity) || entity == "")
                        Err($"{opPath}.entity", "required non-empty string");
                    foreach (var body in new[] { "values", "set" })
                        if (allowed.Contains(body) && op.ContainsKey(body) && op[body] is not JsonObject)
                            Err($"{opPath}.{body}", "must be an object of field name to literal value");
                    if (allowed.Contains("where") && op.ContainsKey("where")) CheckWhere(op["where"], $"{opPath}.where");
                }
        }

        // fingerprint, if present
        if (doc.ContainsKey("fingerprint"))
        {
            if (!TryString(doc["fingerprint"], out var fp) || !fp.StartsWith(ChangesetFingerprint.Prefix, StringComparison.Ordinal))
                Err("$.fingerprint", "must be a sha256:-prefixed string");
            else if (errors.Count == 0 && fp != ChangesetFingerprint.Of(doc))
                Err("$.fingerprint", "embedded fingerprint does not match recomputation (spec §6)");
        }

        // approvals, if present
        if (doc.ContainsKey("approvals"))
        {
            if (doc["approvals"] is not JsonArray approvals) Err("$.approvals", "must be an array");
            else
                for (var i = 0; i < approvals.Count; i++)
                {
                    if (approvals[i] is not JsonObject a) { Err($"$.approvals[{i}]", "must be an object"); continue; }
                    CheckMembers(a, ["fingerprint", "approvedBy", "approvedAt", "comment", "attestation"], $"$.approvals[{i}]");
                    if (!TryString(a["fingerprint"], out _)) Err($"$.approvals[{i}].fingerprint", "required string");
                    if (!TryString(a["approvedBy"], out _)) Err($"$.approvals[{i}].approvedBy", "required string");
                    if (!TryString(a["approvedAt"], out _)) Err($"$.approvals[{i}].approvedAt", "required RFC 3339 string");
                }
        }

        return new ValidationResult(errors.Count == 0, errors);
    }
}
