/**
 * RFC 3339 `date-time` (§5.6), with the §5.7 calendar restrictions — the one
 * timestamp form the spec admits (§4 `createdAt`, §7 `approvedAt`).
 *
 * A grammar check, deliberately not `Date.parse`: the platform parsers of the
 * two SDKs each accept inputs outside RFC 3339 (and different ones), which
 * would make the same document valid in one SDK and invalid in the other. The
 * .NET SDK implements this same rule; the cross-SDK vectors hold them together.
 *
 * - `T` and `Z` are case-insensitive (ABNF literals, RFC 5234 §2.3); the
 *   space separator RFC 3339 mentions in a note is not part of the grammar.
 * - Digits are ASCII only.
 * - Seconds admit `60` (a leap second is grammatical; whether one occurred is
 *   not a structural question).
 */
const DATE_TIME = /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?(?:[Zz]|[+-]([0-9]{2}):([0-9]{2}))$/;

/** The expected form, as the validator names it when it refuses one. */
export const RFC3339_FORM = "YYYY-MM-DDTHH:MM:SS[.frac](Z|+HH:MM|-HH:MM)";

export function isRfc3339DateTime(value: string): boolean {
  const m = DATE_TIME.exec(value);
  if (m === null) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 60) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  return true;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
