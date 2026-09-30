import { describe, expect, it } from "vitest";
import { parseGpx, parseLineString, toLineString, trailMiles } from "../src/squadquest/gpx.js";

/**
 * specs/api/instances.md § trails — these pin the app's behaviour, including
 * the parts that look like omissions. Differing would make an event look
 * different depending on which tool created it.
 */

const MULTI = `<?xml version="1.0"?>
<gpx version="1.1"><trk><name>first</name>
 <trkseg><trkpt lat="39.95" lon="-75.16"/><trkpt lat="39.951" lon="-75.161"/></trkseg>
 <trkseg><trkpt lat="40.0" lon="-76.0"/></trkseg>
</trk>
<trk><trkseg><trkpt lat="41.0" lon="-77.0"/></trkseg></trk></gpx>`;

describe("parseGpx", () => {
  it("takes ONLY the first track's first segment", () => {
    // The app reads gpx.trks.first.trksegs.first. Merging tracks would produce
    // a route the app would never have made.
    const points = parseGpx(MULTI, "f");
    expect(points).toHaveLength(2);
    expect(points[1]).toEqual({ lat: 39.951, lon: -75.161 });
  });

  it("parses either attribute order", () => {
    const xml = `<gpx><trk><trkseg><trkpt lon="-75.16" lat="39.95"/><trkpt lat="39.96" lon="-75.17"/></trkseg></trk></gpx>`;
    expect(parseGpx(xml, "f")).toEqual([
      { lat: 39.95, lon: -75.16 },
      { lat: 39.96, lon: -75.17 },
    ]);
  });

  it("drops points missing or malformed coordinates", () => {
    const xml = `<gpx><trk><trkseg><trkpt lat="39.95" lon="-75.16"/><trkpt lat="39.96"/><trkpt lat="abc" lon="-75.1"/><trkpt lat="39.97" lon="-75.18"/></trkseg></trk></gpx>`;
    expect(parseGpx(xml, "f")).toHaveLength(2);
  });

  it("drops out-of-range coordinates rather than storing them", () => {
    const xml = `<gpx><trk><trkseg><trkpt lat="39.95" lon="-75.16"/><trkpt lat="999" lon="-75.1"/><trkpt lat="39.97" lon="-75.18"/></trkseg></trk></gpx>`;
    expect(parseGpx(xml, "f")).toHaveLength(2);
  });

  it("ignores elevation and timestamps", () => {
    const xml = `<gpx><trk><trkseg><trkpt lat="39.95" lon="-75.16"><ele>12</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="39.96" lon="-75.17"/></trkseg></trk></gpx>`;
    expect(parseGpx(xml, "f")).toEqual([
      { lat: 39.95, lon: -75.16 },
      { lat: 39.96, lon: -75.17 },
    ]);
  });

  it("names what IS in a file that has routes or waypoints but no track", () => {
    const xml = `<gpx><wpt lat="39.9" lon="-75.1"/><rte><rtept lat="39.9" lon="-75.1"/></rte></gpx>`;
    expect(() => parseGpx(xml, "f")).toThrow(/routes \(<rte>\) and waypoints \(<wpt>\)/);
  });

  it("rejects a non-GPX file", () => {
    expect(() => parseGpx("hello", "f")).toThrow(/does not look like a GPX file/);
  });

  it("rejects a track with a single point", () => {
    const xml = `<gpx><trk><trkseg><trkpt lat="39.95" lon="-75.16"/></trkseg></trk></gpx>`;
    expect(() => parseGpx(xml, "f")).toThrow(/at least two/);
  });

  it("handles a dense track without truncating", () => {
    // No simplification and no cap — faithful to the app, and the geometry
    // travels in the request body so there is no URL-length pressure.
    const pts = Array.from(
      { length: 2000 },
      (_, i) => `<trkpt lat="${39.95 + i * 0.0001}" lon="${-75.16 + i * 0.0001}"/>`,
    ).join("");
    expect(parseGpx(`<gpx><trk><trkseg>${pts}</trkseg></trk></gpx>`, "f")).toHaveLength(2000);
  });
});

describe("WKT round-trip", () => {
  it("emits longitude first and reads back to the original lat/lon", () => {
    const points = [
      { lat: 39.9012, lon: -75.172 },
      { lat: 39.9535, lon: -75.1492 },
    ];
    const wkt = toLineString(points);
    expect(wkt).toBe("LINESTRING(-75.172 39.9012,-75.1492 39.9535)");
    expect(parseLineString(wkt)).toEqual(points);
  });

  it("returns nothing for null or unparseable geometry", () => {
    expect(parseLineString(null)).toEqual([]);
    expect(parseLineString("POINT(-75.1 39.9)")).toEqual([]);
  });
});

describe("trailMiles", () => {
  it("measures a known distance", () => {
    // Philadelphia City Hall to the Art Museum, ~1.2 miles.
    const miles = trailMiles([
      { lat: 39.9526, lon: -75.1652 },
      { lat: 39.9656, lon: -75.1810 },
    ]);
    expect(miles).toBeGreaterThan(1.0);
    expect(miles).toBeLessThan(1.4);
  });

  it("is zero for a degenerate pair", () => {
    expect(trailMiles([{ lat: 39.95, lon: -75.16 }, { lat: 39.95, lon: -75.16 }])).toBe(0);
  });
});
