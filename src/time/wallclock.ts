import { AxiError } from "axi-sdk-js";

/**
 * Human time in, zoned time out — specs/behaviors/time-and-place.md.
 *
 * Times cross the wire as UTC ISO-8601 and people think in local wall clock.
 * Everything that crosses that boundary goes through here.
 */

export function resolveTimezone(flag?: string): string {
  const zone =
    flag ??
    process.env.SQUADQUEST_AXI_TIMEZONE ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new AxiError(`"${zone}" is not a known timezone`, "USAGE", [
      "Pass an IANA zone, e.g. --timezone America/New_York",
    ]);
  }
  return zone;
}

/** The zone's UTC offset in minutes at a specific instant — DST-correct. */
function offsetMinutesAt(utcMillis: number, zone: string): number {
  // Formatting the instant in the target zone and re-reading it as UTC yields
  // the offset that applied *at that instant*, which is what makes a date on
  // the far side of a DST boundary come out right.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMillis));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return (asUtc - utcMillis) / 60000;
}

const WALL_CLOCK =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Parse an input time to epoch milliseconds.
 *
 * Accepts ISO-8601 with an offset (used verbatim), or a local wall clock
 * interpreted in `zone`. Relative expressions are deliberately NOT parsed: a
 * CLI that guesses what "next Tuesday" means near a week boundary produces an
 * event on the wrong day, and the caller has an actual calendar.
 */
export function parseInstant(input: string, zone: string, label: string): number {
  const trimmed = input.trim();

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) throw badTime(input, label);
    return parsed;
  }

  const match = WALL_CLOCK.exec(trimmed);
  if (!match) throw badTime(input, label);

  const [, y, mo, d, h = "0", mi = "0", s = "0"] = match;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));

  // Two passes: the offset depends on the instant, and the instant depends on
  // the offset. One correction settles it except exactly inside a DST gap.
  let utc = naive - offsetMinutesAt(naive, zone) * 60000;
  utc = naive - offsetMinutesAt(utc, zone) * 60000;
  return utc;
}

function badTime(input: string, label: string): AxiError {
  return new AxiError(`${label}: could not read "${input}" as a time`, "USAGE", [
    "Pass an ISO time with an offset, e.g. 2026-10-19T19:00:00-04:00",
    "Or a local wall clock, e.g. 2026-10-19T19:00 (use --timezone to set the zone)",
    "Relative dates like `tomorrow` are not parsed — pass a concrete date",
  ]);
}

export function toWireTime(epochMillis: number): string {
  return new Date(epochMillis).toISOString();
}

const DATE_FMT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
};

function parts(epochMillis: number, zone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, ...options }).format(
    new Date(epochMillis),
  );
}

function zoneAbbrev(epochMillis: number, zone: string): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "short",
  }).formatToParts(new Date(epochMillis));
  return formatted.find((p) => p.type === "timeZoneName")?.value ?? zone;
}

function clock(epochMillis: number, zone: string): string {
  return parts(epochMillis, zone, { hour: "numeric", minute: "2-digit", hour12: true });
}

/**
 * Render the rally window. Always names the zone — a caller reading `22:00Z`
 * for a 6pm rally has to do arithmetic to sanity-check it, and will eventually
 * do it wrong.
 *
 * A window is rendered as a range; equal ends collapse to a single time, since
 * a zero-width window is a deliberate choice and reads as one.
 */
export function formatWindow(minMillis: number, maxMillis: number, zone: string): string {
  const day = parts(minMillis, zone, DATE_FMT);
  const abbrev = zoneAbbrev(minMillis, zone);
  if (minMillis === maxMillis) return `${day} ${clock(minMillis, zone)} ${abbrev}`;

  const sameDay = day === parts(maxMillis, zone, DATE_FMT);
  return sameDay
    ? `${day} ${clock(minMillis, zone)}-${clock(maxMillis, zone)} ${abbrev}`
    : `${day} ${clock(minMillis, zone)} → ${parts(maxMillis, zone, DATE_FMT)} ${clock(maxMillis, zone)} ${abbrev}`;
}

/** Long form for a detail view, including the year. */
export function formatFull(minMillis: number, maxMillis: number, zone: string): string {
  const year = parts(minMillis, zone, { year: "numeric" });
  return formatWindow(minMillis, maxMillis, zone).replace(
    parts(minMillis, zone, DATE_FMT),
    `${parts(minMillis, zone, DATE_FMT)} ${year}`,
  );
}

export function formatTime(epochMillis: number, zone: string): string {
  return `${clock(epochMillis, zone)} ${zoneAbbrev(epochMillis, zone)}`;
}
