/**
 * RFC 8785 (JCS) canonicalization.
 *
 * Implemented natively rather than via a dependency: JCS defines its number and
 * string serialization as ECMAScript's own `JSON.stringify` semantics, so in
 * JS/TS the standard library already produces the normative form — all that
 * remains is deterministic member ordering (UTF-16 code unit sort, which is
 * JavaScript's default string comparison).
 */

export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError("I-JSON forbids NaN and Infinity (spec ADR-0001)");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v === undefined ? null : v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort(); // default sort = UTF-16 code unit order, as JCS requires
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
  }
  throw new TypeError(`value is not JSON-representable: ${typeof value}`);
}

/** Canonical UTF-8 bytes — the exact input to the fingerprint hash. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
