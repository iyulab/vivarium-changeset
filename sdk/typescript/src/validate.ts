import { createHash } from "node:crypto";
import { reverseApplyUnifiedDiff } from "./diff.ts";
import { FINGERPRINT_PREFIX, fingerprintOf } from "./fingerprint.ts";

export interface ValidationError { path: string; message: string }
export interface ValidationResult { valid: boolean; errors: ValidationError[] }

export const SUPPORTED_SPEC_VERSIONS = ["0.1.0-draft"];

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

const artifactFingerprint = (content: string): string =>
  FINGERPRINT_PREFIX + createHash("sha256").update(content, "utf8").digest("hex");

/** Validate a parsed changeset document against spec §8 (0.1.0-draft). */
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
  }

  // patches
  const patches = doc.patches as Record<string, unknown> | undefined;
  if (typeof patches !== "object" || patches === null) {
    err("$.patches", "patches is required");
    return { valid: errors.length === 0, errors };
  }
  checkMembers(patches, ["schema", "ui", "data"], "$.patches");
  const schema = (patches.schema ?? []) as Record<string, unknown>[];
  const ui = (patches.ui ?? []) as Record<string, unknown>[];
  const data = (patches.data ?? []) as Record<string, unknown>[];
  if (schema.length + ui.length + data.length === 0) {
    err("$.patches", "at least one facet must be non-empty (spec §3)");
  }

  schema.forEach((p, i) => {
    const path = `$.patches.schema[${i}]`;
    const allowed = SCHEMA_OPS[p.op as string];
    if (!allowed) { err(`${path}.op`, `unknown schema operation: ${String(p.op)}`); return; }
    checkMembers(p, allowed, path);
    for (const req of allowed) if (!(req in p)) err(`${path}.${req}`, "required member missing");
    if (typeof p.explanation !== "string" || p.explanation === "") err(`${path}.explanation`, "explanation required");
    const fields = p.op === "entity.create" ? (p.fields as Record<string, unknown>[]) ?? [] :
      p.op === "field.add" && p.field ? [p.field as Record<string, unknown>] : [];
    for (const f of fields) {
      if (!LOGICAL_TYPES.includes(f.type as string)) err(`${path}`, `unknown logical type: ${String(f.type)}`);
      if (f.type === "reference" && typeof f.target !== "string") err(`${path}`, "reference type requires target");
    }
    if (p.op === "field.retype" && !LOGICAL_TYPES.includes(p.newType as string)) {
      err(`${path}.newType`, `unknown logical type: ${String(p.newType)}`);
    }
  });

  ui.forEach((p, i) => {
    const path = `$.patches.ui[${i}]`;
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
    checkMembers(p, ["id", "explanation", "operations"], path);
    if (typeof p.id !== "string" || p.id === "") err(`${path}.id`, "required string");
    else if (seen.has(p.id)) err(`${path}.id`, `duplicate data patch id: ${p.id}`);
    else seen.add(p.id);
    if (typeof p.explanation !== "string" || p.explanation === "") err(`${path}.explanation`, "explanation required");
    if (!Array.isArray(p.operations)) err(`${path}.operations`, "required array");
    else (p.operations as Record<string, unknown>[]).forEach((op, j) => {
      if (!DATA_OPS.includes(op.op as string)) err(`${path}.operations[${j}].op`, `unknown data operation: ${String(op.op)}`);
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
    else (doc.approvals as Record<string, unknown>[]).forEach((a, i) => {
      checkMembers(a, ["fingerprint", "approvedBy", "approvedAt", "comment", "attestation"], `$.approvals[${i}]`);
      if (typeof a.fingerprint !== "string") err(`$.approvals[${i}].fingerprint`, "required string");
      if (typeof a.approvedBy !== "string") err(`$.approvals[${i}].approvedBy`, "required string");
      if (typeof a.approvedAt !== "string") err(`$.approvals[${i}].approvedAt`, "required RFC 3339 string");
    });
  }

  return { valid: errors.length === 0, errors };
}
