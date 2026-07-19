import { reverseApplyUnifiedDiff } from "./diff.ts";
import { artifactFingerprint, FINGERPRINT_PREFIX, fingerprintOf } from "./fingerprint.ts";
import { parseVerifiedDiff } from "./verified-diff.ts";

export interface ValidationError { path: string; message: string }
export interface ValidationResult { valid: boolean; errors: ValidationError[] }

export const SUPPORTED_SPEC_VERSIONS = ["0.1.0", "0.2.0"];

/** Closed `baseState.kind` vocabulary (spec §4, 0.2). */
export const BASE_STATE_KINDS = ["schema", "ui-artifact", "changeset"];

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
const DATA_OPS = ["insert", "update", "delete"];

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

  checkMembers(doc, ["specVersion", "id", "intent", "provenance", "patches", "fingerprint", "approvals"], "$");

  if (!SUPPORTED_SPEC_VERSIONS.includes(doc.specVersion as string)) {
    err("$.specVersion", `unsupported specVersion: ${String(doc.specVersion)}`);
  }
  if (typeof doc.intent !== "string" || doc.intent.trim() === "") {
    err("$.intent", "intent is required and must be a non-empty string");
  }

  // provenance
  const prov = doc.provenance as Record<string, unknown> | undefined;
  if (typeof prov !== "object" || prov === null) err("$.provenance", "provenance is required");
  else {
    checkMembers(prov, ["producedBy", "createdAt", "baseState", "editContext"], "$.provenance");
    if (typeof prov.producedBy !== "string") err("$.provenance.producedBy", "required string");
    if (typeof prov.createdAt !== "string") err("$.provenance.createdAt", "required RFC 3339 string");
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
        err(`${path}.kind`, `unknown baseState kind: ${String(e.kind)} (closed vocabulary, spec §4)`);
      }
      if (typeof e.ref !== "string" || e.ref === "") err(`${path}.ref`, "required non-empty string");
      if (typeof e.fingerprint !== "string" || !e.fingerprint.startsWith(FINGERPRINT_PREFIX)) {
        err(`${path}.fingerprint`, "must be a sha256:-prefixed string");
      }
    });
  }

  // patches
  const patches = doc.patches as Record<string, unknown> | undefined;
  if (typeof patches !== "object" || patches === null) {
    err("$.patches", "patches is required");
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

  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  schema.forEach((p, i) => {
    const path = `$.patches.schema[${i}]`;
    if (!isRecord(p)) { err(path, "must be an object"); return; }
    const allowed = SCHEMA_OPS[p.op as string];
    if (!allowed) { err(`${path}.op`, `unknown schema operation: ${String(p.op)}`); return; }
    checkMembers(p, allowed, path);
    for (const req of allowed) if (!(req in p)) err(`${path}.${req}`, "required member missing");
    if (typeof p.explanation !== "string" || p.explanation === "") err(`${path}.explanation`, "explanation required");
    if (p.op === "entity.create" && !Array.isArray(p.fields)) err(`${path}.fields`, "must be an array");
    const fields = p.op === "entity.create" && Array.isArray(p.fields) ? (p.fields as unknown[]) :
      p.op === "field.add" && p.field ? [p.field] : [];
    for (const f of fields) {
      const ftype = isRecord(f) ? f.type : undefined;
      if (!LOGICAL_TYPES.includes(ftype as string)) err(`${path}`, `unknown logical type: ${String(ftype)}`);
      else if (ftype === "reference" && typeof (f as Record<string, unknown>).target !== "string") {
        err(`${path}`, "reference type requires target");
      }
    }
    if (p.op === "field.retype" && !LOGICAL_TYPES.includes(p.newType as string)) {
      err(`${path}.newType`, `unknown logical type: ${String(p.newType)}`);
    }
  });

  const is02 = doc.specVersion === "0.2.0";

  ui.forEach((p, i) => {
    const path = `$.patches.ui[${i}]`;
    if (!isRecord(p)) { err(path, "must be an object"); return; }
    if (p.profile === "verified-diff@0") {
      if (!is02) {
        err(`${path}.profile`, `verified-diff@0 requires specVersion 0.2.0 (document declares ${String(doc.specVersion)})`);
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
        try { parseVerifiedDiff(p.diff); }
        catch (e) { err(`${path}.diff`, `outside the verified-diff dialect: ${(e as Error).message}`); }
      }
      return;
    }
    checkMembers(p, ["profile", "artifactId", "baseFingerprint", "newContent", "reviewDiff", "explanation"], path);
    if (p.profile !== "whole-artifact@0") { err(`${path}.profile`, `unknown UI patch profile: ${String(p.profile)}`); return; }
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
      const dop = isRecord(op) ? op.op : undefined;
      if (!DATA_OPS.includes(dop as string)) err(`${path}.operations[${j}].op`, `unknown data operation: ${String(dop)}`);
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
      if (typeof a.fingerprint !== "string") err(`$.approvals[${i}].fingerprint`, "required string");
      if (typeof a.approvedBy !== "string") err(`$.approvals[${i}].approvedBy`, "required string");
      if (typeof a.approvedAt !== "string") err(`$.approvals[${i}].approvedAt`, "required RFC 3339 string");
    });
  }

  return { valid: errors.length === 0, errors };
}
