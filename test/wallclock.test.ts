import { describe, expect, it } from "vitest";
import {
  formatWindow,
  parseInstant,
  resolveTimezone,
  toWireTime,
} from "../src/time/wallclock.js";
import { parseWkt } from "../src/squadquest/events.js";

const NY = "America/New_York";

describe("parseInstant", () => {
  it("uses an ISO time with an offset verbatim", () => {
    expect(toWireTime(parseInstant("2026-10-19T19:00:00-04:00", NY, "--start"))).toBe(
      "2026-10-19T23:00:00.000Z",
    );
  });

  it("interprets a bare wall clock in the resolved zone", () => {
    expect(toWireTime(parseInstant("2026-10-19T19:00", NY, "--start"))).toBe(
      "2026-10-19T23:00:00.000Z",
    );
  });

  it("accepts a space instead of T", () => {
    expect(parseInstant("2026-10-19 19:00", NY, "--start")).toBe(
      parseInstant("2026-10-19T19:00", NY, "--start"),
    );
  });

  it("treats a bare date as local midnight", () => {
    expect(toWireTime(parseInstant("2026-10-19", NY, "--start"))).toBe(
      "2026-10-19T04:00:00.000Z",
    );
  });

  it("converts correctly across a DST boundary", () => {
    // US DST ends 2026-11-01. A wall clock on either side must use the offset
    // that applies *at that instant*, not today's — otherwise a future event
    // lands an hour off (specs/behaviors/time-and-place.md).
    expect(toWireTime(parseInstant("2026-10-30T19:00", NY, "--start"))).toBe(
      "2026-10-30T23:00:00.000Z", // EDT, UTC-4
    );
    expect(toWireTime(parseInstant("2026-11-06T19:00", NY, "--start"))).toBe(
      "2026-11-07T00:00:00.000Z", // EST, UTC-5
    );
  });

  it("handles a zone on the other side of the line", () => {
    expect(toWireTime(parseInstant("2026-10-19T09:00", "Asia/Tokyo", "--start"))).toBe(
      "2026-10-19T00:00:00.000Z",
    );
  });

  it("refuses relative expressions rather than guessing", () => {
    // Guessing what "next Tuesday" means near a week boundary puts an event on
    // the wrong day, and the caller has an actual calendar.
    for (const input of ["tomorrow", "next tuesday", "+2h", "now"]) {
      expect(() => parseInstant(input, NY, "--start"), input).toThrow(/could not read/);
    }
  });

  it("names the flag in the error and suggests concrete forms", () => {
    try {
      parseInstant("soon", NY, "--start");
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("--start");
      expect((error as { suggestions: string[] }).suggestions.join(" ")).toContain(
        "Relative dates",
      );
    }
  });
});

describe("resolveTimezone", () => {
  it("prefers the explicit flag", () => {
    expect(resolveTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("rejects an unknown zone with exit-2 guidance", () => {
    expect(() => resolveTimezone("Mars/Olympus")).toThrow(/not a known timezone/);
  });
});

describe("formatWindow", () => {
  const start = Date.parse("2026-10-19T22:00:00Z");
  const end = Date.parse("2026-10-19T22:45:00Z");

  it("renders a range and always names the zone", () => {
    const out = formatWindow(start, end, NY);
    expect(out).toContain("6:00 PM-6:45 PM");
    expect(out).toContain("EDT");
    expect(out).toContain("Oct 19");
  });

  it("collapses a zero-width window to a single time", () => {
    const out = formatWindow(start, start, NY);
    expect(out).toContain("6:00 PM EDT");
    expect(out).not.toContain("-6:00");
  });

  it("spans days when the window crosses midnight", () => {
    // 05:00Z is 1:00 AM the next day in New York; 03:00Z would still be 11 PM
    // the same evening, which is exactly the off-by-one this guards.
    const next = Date.parse("2026-10-20T05:00:00Z");
    const out = formatWindow(start, next, NY);
    expect(out).toContain("→");
    expect(out).toContain("Oct 20");
  });

  it("renders the same instant differently in a different zone", () => {
    expect(formatWindow(start, end, "Asia/Tokyo")).toContain("Oct 20");
  });
});

describe("parseWkt", () => {
  it("reads WKT lon-first and returns lat/lon", () => {
    // The swap that, done backwards, silently puts Philadelphia in Xinjiang.
    expect(parseWkt("POINT(-75.172 39.9012)")).toEqual({ lat: 39.9012, lon: -75.172 });
  });

  it("tolerates whitespace and case", () => {
    expect(parseWkt("  point( -75.172   39.9012 )  ")).toEqual({
      lat: 39.9012,
      lon: -75.172,
    });
  });

  it("returns undefined for null or unparseable geometry", () => {
    expect(parseWkt(null)).toBeUndefined();
    expect(parseWkt("LINESTRING(1 2,3 4)")).toBeUndefined();
    expect(parseWkt("garbage")).toBeUndefined();
  });
});
