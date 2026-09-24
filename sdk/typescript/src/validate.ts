import { reverseApplyUnifiedDiff } from "./diff.ts";
import { ChangesetError } from "./errors.ts";
import { artifactFingerprint, FINGERPRINT_PREFIX, fingerprintOf } from "./fingerprint.ts";
import { parseVerifiedDiff } from "./verified-diff.ts";
import { isRfc3339DateTime, RFC3339_FORM } from "./timestamp.ts";

export type { ValidationError } from "./errors.ts";
import type { ValidationError } from "./errors.ts";
export interface ValidationResult { valid: boolean; errors: ValidationError[] }

export const SUPPORTED_SPEC_VERSIONS = ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0"];

/** Closed `baseState.kind` vocabulary (spec §4). `data` is gated on 0.3.0. */
export const BASE_STATE_KINDS = ["schema", "ui-artifact", "changeset", "data"];

/** Closed `patches.ui[].profile` vocabulary. */
export const UI_PATCH_PROFILES = ["whole-artifact@0", "verified-diff@0"];

const SCHEMA_OPS: Record<string, string[]> = {
  "entity.create": ["op", "entity", "fields", "explanation"],
  "entity.rename": ["op", "entity", "newName", "explanation"],
  "entity.remove": ["op", "entity", "explanation"],
  "field.add": ["op", "entity", "field", "explanation"],
  "field.rename": ["op", "entity", "field", "newName", "explanation"],
  "field.retype": ["op", "entity", "field", "newType", "explanation"],
  "field.remove": ["op", "entity", "field", "explanation"],
  "constraint.add": ["op", "entity", "constraint", "explanation"],
  "constraint.remove": ["op", "entity", "constraint", "explanation"],
};
const LOGICAL_TYPES = ["string", "number", "boolean", "date", "datetime", "reference", "json"];
/** Per-operation required members (spec §5.3) — the data facet's counterpart to SCHEMA_OPS. */
const DATA_OPS: Record<string, string[]> = {
  insert: ["op", "entity", "values"],
  update: ["op", "entity", "where", "set"],
  delete: ["op", "entity", "where"],
};

/**
 * Layer-1 structural validation of a parsed changeset document (spec §8).
 * Complete (base-supplied) verification of verified-diff patches is a
 * separate operation — see verifyAgainstBase in ./verified-diff.ts.
 */
export function validate(document: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    return { valid: false, errors: [{ path: "$", message: "document must be a JSON object" }] };
  }
  const doc = document as Record<string, unknown>;

  const checkMembers = (obj: Record<string, unknown>, allowed: string[], path: string) => {
    for (const k of Object.keys(obj)) {
      if (!allowed.includes(k)) err(`${path}.${k}`, "unknown member (closed model, spec §2)");
    }
  };

  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  // Closed-vocabulary rejections enumerate the accepted values — the error
  // surface is the spec-delivery channel for authoring agents, so a rejection
  // that names what IS accepted turns a guessing loop into a one-shot fix.
  const supported = (vals: string[], note?: string) =>
    note === undefined
      ? `(supported: ${vals.join(", ")})`
      : `(supported: ${vals.join(", ")}; ${note})`;

  // Render the offending value as JSON — quoting disambiguates a string ("0.1")
  // from a number (0.1), which is exactly the typo class authors hit. Matches
  // the .NET SDK's JsonNode.ToJsonString() so error messages are byte-identical
  // across SDKs. (Absent → "undefined"; explicit null keeps its JSON form "null".)
  const jsonRepr = (v: unknown) => (v === undefined ? "undefined" : JSON.stringify(v));

  // Timestamps are checked as RFC 3339 grammar (./timestamp.ts), not by a
  // platform date parser — the refusal names the form it expects (Class A).
  const checkTimestamp = (v: unknown, path: string, section: string) => {
    if (typeof v !== "string") err(path, "required RFC 3339 string");
    else if (!isRfc3339DateTime(v)) err(path, `not an RFC 3339 date-time: ${jsonRepr(v)} (expected ${RFC3339_FORM}, ${section})`);
  };

  checkMembers(doc, ["specVersion", "id", "intent", "provenance", "patches", "fingerprint", "approvals"], "$");

  if (!SUPPORTED_SPEC_VERSIONS.includes(doc.specVersion as string)) {
    err("$.specVersion", `unsupported specVersion: ${jsonRepr(doc.specVersion)} ${supported(SUPPORTED_SPEC_VERSIONS)}`);
  }
  // SUPPORTED_SPEC_VERSIONS is ordered ascending, so position is precedence.
  // Version-gated *features* use this (spec §9); tightenings never do.
  const declared = SUPPORTED_SPEC_VERSIONS.indexOf(doc.specVersion as string);
  const atLeast = (v: string) => declared >= 0 && declared >= SUPPORTED_SPEC_VERSIONS.indexOf(v);
  if (typeof doc.intent !== "string" || doc.intent.trim() === "") {
    err("$.intent", "intent is required and must be a non-empty string");
  }

  // provenance
  const prov = doc.provenance;
  if (!isRecord(prov)) err("$.provenance", "provenance" in doc ? "provenance must be an object" : "provenance is required");
  else {
    checkMembers(prov, ["producedBy", "createdAt", "baseState", "editContext"], "$.provenance");
    if (typeof prov.producedBy !== "string") err("$.provenance.producedBy", "required string");
    checkTimestamp(prov.createdAt, "$.provenance.createdAt", "spec §4");
    if (!Array.isArray(prov.baseState)) err("$.provenance.baseState", "required array");
    else (prov.baseState as unknown[]).forEach((entry, i) => {
      const path = `$.provenance.baseState[${i}]`;
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        err(path, "must be an object (spec §4 — malformed entries are validation failures, not crashes)");
        return;
      }
      const e = entry as Record<string, unknown>;
      checkMembers(e, ["kind", "ref", "fingerprint"], path);
      if (!BASE_STATE_KINDS.includes(e.kind as string)) {
        err(`${path}.kind`, `unknown baseState kind: ${jsonRepr(e.kind)} ${supported(BASE_STATE_KINDS, "closed vocabulary, spec §4")}`);
      } else if (e.kind === "data" && !atLeast("0.3.0")) {
        err(`${path}.kind`, `baseState kind "data" requires specVersion 0.3.0 or later (document declares ${jsonRepr(doc.specVersion)})`);
      }
      if (typeof e.ref !== "string" || e.ref === "") err(`${path}.ref`, "required non-empty string");
      if (typeof e.fingerprint !== "string" || !e.fingerprint.startsWith(FINGERPRINT_PREFIX)) {
        err(`${path}.fingerprint`, "must be a sha256:-prefixed string");
      }
    });
  }

  // patches
  const patches = doc.patches;
  if (!isRecord(patches)) {
    err("$.patches", "patches" in doc
      ? "patches must be an object with facet keys (schema, ui, data)"
      : "patches is required");
    return { valid: errors.length === 0, errors };
  }
  checkMembers(patches, ["schema", "ui", "data"], "$.patches");
  // a non-array facet is a validation error, not a crash — the validator's
  // contract is to return errors for any JSON input
  const facet = (name: string): Record<string, unknown>[] => {
    const value = patches[name];
    if (value === undefined) return [];
    if (Array.isArray(value)) return value as Record<string, unknown>[];
    err(`$.patches.${name}`, "must be an array");
    return [];
  };
  const schema = facet("schema");
  const ui = facet("ui");
  const data = facet("data");
  if (schema.length + ui.length + data.length === 0) {
    err("$.patches", "at least one facet must be non-empty (spec §3)");
  }

  /** `where` is closed to `{ field, equals: <literal> }` — spec §5.3, no expressions. */
  const checkWhere = (where: unknown, path: string) => {
    if (!isRecord(where)) { err(path, "must be an object { field, equals } (spec §5.3)"); return; }
    checkMembers(where, ["field", "equals"], path);
    if (typeof where.field !== "string" || where.field === "") err(`${path}.field`, "required non-empty string");
    if (!("equals" in where)) err(`${path}.equals`, "required member missing");
    else {
      const v = where.equals;
      const isLiteral = v === null || ["string", "number", "boolean"].includes(typeof v);
      if (!isLiteral) err(`${path}.equals`, "must be a literal — string, number, boolean, or null (spec §5.3, v0 keeps expressions out)");
    }
  };

  schema.forEach((p, i) => {
    const path = `$.patches.schema[${i}]`;
    if (!isRecord(p)) { err(path, "must be an object"); return; }
    const allowed = SCHEMA_OPS[p.op as string];
    if (!allowed) { err(`${path}.op`, `unknown schema operation: ${jsonRepr(p.op)} ${supported(Object.keys(SCHEMA_OPS))}`); return; }
    checkMembers(p, allowed, path);
    for (const req of allowed) if (!(req in p)) err(`${path}.${req}`, "required member missing");
    if (typeof p.explanation !== "string" || p.explanation === "") err(`${path}.explanation`, "explanation required");
    if (p.op === "entity.create" && !Array.isArray(p.fields)) err(`${path}.fields`, "must be an array");
    const fields = p.op === "entity.create" && Array.isArray(p.fields) ? (p.fields as unknown[]) :
      p.op === "field.add" && p.field !== undefined && p.field !== null ? [p.field] : [];
    for (const f of fields) {
      const ftype = isRecord(f) ? f.type : undefined;
      if (!LOGICAL_TYPES.includes(ftype as string)) err(`${path}`, `unknown logical type: ${jsonRepr(ftype)} ${supported(LOGICAL_TYPES)}`);
      else if (ftype === "reference" && typeof (f as Record<string, unknown>).target !== "string") {
        err(`${path}`, "reference type requires target");
      }
    }
    if (p.op === "field.retype" && !LOGICAL_TYPES.includes(p.newType as string)) {
      err(`${path}.newType`, `unknown logical type: ${jsonRepr(p.newType)} ${supported(LOGICAL_TYPES)}`);
    }
  });

  ui.forEach((p, i) => {
    const path = `$.patches.ui[${i}]`;
    if (!isRecord(p)) { err(path, "must be an object"); return; }
    if (p.profile === "verified-diff@0") {
      if (!atLeast("0.2.0")) {
        err(`${path}.profile`, `verified-diff@0 requires specVersion 0.2.0 or later (document declares ${jsonRepr(doc.specVersion)})`);
        return;
      }
      checkMembers(p, ["profile", "artifactId", "baseFingerprint", "diff", "newFingerprint", "explanation"], path);
      if (typeof p.artifactId !== "string") err(`${path}.artifactId`, "required string");
      if (typeof p.explanation !== "string" || p.explanation === "") err(`${path}.explanation`, "explanation required");
      if (p.baseFingerprint === null) {
        err(`${path}.baseFingerprint`, "must not be null — creation is whole-artifact@0's job (spec §5.2.2)");
      } else if (typeof p.baseFingerprint !== "string" || !p.baseFingerprint.startsWith(FINGERPRINT_PREFIX)) {
        err(`${path}.baseFingerprint`, "must be a sha256:-prefixed string");
      }
      if (typeof p.newFingerprint !== "string" || !p.newFingerprint.startsWith(FINGERPRINT_PREFIX)) {
        err(`${path}.newFingerprint`, "must be a sha256:-prefixed string");
      } else if (p.newFingerprint === p.baseFingerprint) {
        err(`${path}.newFingerprint`, "no-op patch: newFingerprint equals baseFingerprint (spec §5.2.2)");
      }
      if (typeof p.diff !== "string") err(`${path}.diff`, "required string (the diff is the review surface)");
      else {
        // Lift the dialect's own located failures into this list rather than
        // splicing its sentence into one of ours. Splicing put every diff failure
        // at `<patch>.diff` however deep inside the diff it happened, so a reader
        // got the fact and not the place. `rebase` keeps the list flat.
        try { parseVerifiedDiff(p.diff); }
        catch (e) {
          if (!(e instanceof ChangesetError)) throw e;
          for (const lifted of e.rebase(`${path}.diff`)) err(lifted.path, lifted.message);
        }
      }
      return;
    }
    checkMembers(p, ["profile", "artifactId", "baseFingerprint", "newContent", "reviewDiff", "explanation"], path);
    if (p.profile !== "whole-artifact@0") { err(`${path}.profile`, `unknown UI patch profile: ${jsonRepr(p.profile)} ${supported(UI_PATCH_PROFILES)}`); return; }
    if (typeof p.artifactId !== "string") err(`${path}.artifactId`, "required string");
    if (typeof p.newContent !== "string") err(`${path}.newContent`, "required string");
    if (typeof p.reviewDiff !== "string") err(`${path}.reviewDiff`, "required string (reviewability invariant)");
    if (typeof p.explanation !== "string" || p.explanation === "") err(`${path}.explanation`, "explanation required");
    if (typeof p.newContent === "string" && typeof p.reviewDiff === "string") {
      try {
        const recoveredBase = reverseApplyUnifiedDiff(p.newContent, p.reviewDiff);
        if (p.baseFingerprint === null) {
          if (recoveredBase !== "") err(`${path}.reviewDiff`, "creation patch (baseFingerprint null) must diff from empty");
        } else if (typeof p.baseFingerprint === "string") {
          if (artifactFingerprint(recoveredBase) !== p.baseFingerprint) {
            err(`${path}.reviewDiff`, "diff is inconsistent: recovered base does not match baseFingerprint (spec §5.2)");
          }
        } else {
          err(`${path}.baseFingerprint`, "must be a sha256: string or null");
        }
      } catch (e) {
        err(`${path}.reviewDiff`, `diff does not apply to newContent: ${(e as Error).message}`);
      }
    }
  });

  const seen = new Set<string>();
  data.forEach((p, i) => {
    const path = `$.patches.data[${i}]`;
    if (!isRecord(p)) { err(path, "must be an object"); return; }
    checkMembers(p, ["id", "explanation", "operations"], path);
    if (typeof p.id !== "string" || p.id === "") err(`${path}.id`, "required string");
    else if (seen.has(p.id)) err(`${path}.id`, `duplicate data patch id: ${p.id}`);
    else seen.add(p.id);
    if (typeof p.explanation !== "string" || p.explanation === "") err(`${path}.explanation`, "explanation required");
    if (!Array.isArray(p.operations)) err(`${path}.operations`, "required array");
    else (p.operations as unknown[]).forEach((op, j) => {
      const opPath = `${path}.operations[${j}]`;
      if (!isRecord(op)) { err(opPath, "must be an object"); return; }
      const allowed = DATA_OPS[op.op as string];
      if (!allowed) { err(`${opPath}.op`, `unknown data operation: ${jsonRepr(op.op)} ${supported(Object.keys(DATA_OPS))}`); return; }
      checkMembers(op, allowed, opPath);
      for (const req of allowed) if (!(req in op)) err(`${opPath}.${req}`, "required member missing");
      if (typeof op.entity !== "string" || op.entity === "") err(`${opPath}.entity`, "required non-empty string");
      for (const body of ["values", "set"]) {
        if (allowed.includes(body) && body in op && !isRecord(op[body])) {
          err(`${opPath}.${body}`, "must be an object of field name to literal value");
        }
      }
      if (allowed.includes("where") && "where" in op) checkWhere(op.where, `${opPath}.where`);
    });
  });

  // fingerprint, if present
  if (doc.fingerprint !== undefined) {
    if (typeof doc.fingerprint !== "string" || !doc.fingerprint.startsWith(FINGERPRINT_PREFIX)) {
      err("$.fingerprint", "must be a sha256:-prefixed string");
    } else if (errors.length === 0 && doc.fingerprint !== fingerprintOf(doc)) {
      err("$.fingerprint", "embedded fingerprint does not match recomputation (spec §6)");
    }
  }

  // approvals, if present
  if (doc.approvals !== undefined) {
    if (!Array.isArray(doc.approvals)) err("$.approvals", "must be an array");
    else (doc.approvals as unknown[]).forEach((a, i) => {
      if (!isRecord(a)) { err(`$.approvals[${i}]`, "must be an object"); return; }
      checkMembers(a, ["fingerprint", "approvedBy", "approvedAt", "comment", "attestation"], `$.approvals[${i}]`);
      if ("attestation" in a) err(`$.approvals[${i}].attestation`, "reserved member, absent in v0 (spec §7)");
      if (typeof a.fingerprint !== "string") err(`$.approvals[${i}].fingerprint`, "required string");
      if (typeof a.approvedBy !== "string") err(`$.approvals[${i}].approvedBy`, "required string");
      checkTimestamp(a.approvedAt, `$.approvals[${i}].approvedAt`, "spec §7");
    });
  }

  return { valid: errors.length === 0, errors };
}
