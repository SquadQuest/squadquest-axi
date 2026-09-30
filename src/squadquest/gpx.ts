import { readFileSync, statSync } from "node:fs";
import { AxiError } from "axi-sdk-js";

/**
 * GPX parsing — specs/api/instances.md § trails.
 *
 * Deliberately mirrors the v1 app
 * (`lib/ui/core/widgets/rally_point_map.dart`), including the parts that look
 * like omissions: first track, first segment, no simplification. Differing
 * would make an event look different depending on which tool created it.
 */

export interface TrailPoint {
  lat: number;
  lon: number;
}

function fail(message: string, ...suggestions: string[]): AxiError {
  return new AxiError(message, "USAGE", suggestions);
}

/**
 * Pull `lat`/`lon` off a `<trkpt>` tag. Attribute order varies between
 * exporters, so both are matched by name rather than by position.
 */
function pointFrom(tag: string): TrailPoint | undefined {
  const lat = /\blat\s*=\s*"([^"]+)"/.exec(tag)?.[1];
  const lon = /\blon\s*=\s*"([^"]+)"/.exec(tag)?.[1];
  if (lat === undefined || lon === undefined) return undefined;

  const latitude = Number(lat);
  const longitude = Number(lon);
  // The app filters points with null coordinates; a non-numeric attribute is
  // the same class of junk.
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;

  return { lat: latitude, lon: longitude };
}

export function parseGpx(xml: string, label: string): TrailPoint[] {
  if (!/<gpx[\s>]/i.test(xml)) {
    throw fail(`${label} does not look like a GPX file`, "Pass a .gpx file exported from your mapping app");
  }

  // Anchor on the first <trk>, then its first <trkseg>. Scanning the whole
  // document for <trkpt> would silently merge multiple tracks, which is not
  // what the app does.
  const trackStart = xml.search(/<trk[\s>]/i);
  if (trackStart === -1) {
    throw noTrack(label, xml);
  }

  const afterTrack = xml.slice(trackStart);
  const segMatch = /<trkseg[\s>]([\s\S]*?)<\/trkseg>/i.exec(afterTrack);
  if (!segMatch) {
    throw noTrack(label, xml);
  }

  const points = [...segMatch[1]!.matchAll(/<trkpt\b[^>]*>/gi)]
    .map((m) => pointFrom(m[0]))
    .filter((p): p is TrailPoint => p !== undefined);

  if (points.length === 0) {
    throw fail(`${label} has a track but no usable points`, "Check the file in your mapping app");
  }
  if (points.length === 1) {
    throw fail(`${label} has only one track point — a route needs at least two`);
  }

  return points;
}

/**
 * A GPX can hold routes and waypoints instead of tracks. The app reads only
 * tracks, so say what's actually in the file rather than reporting an empty
 * result.
 */
function noTrack(label: string, xml: string): AxiError {
  const has = (tag: string) => new RegExp(`<${tag}[\\s>]`, "i").test(xml);
  const instead = [has("rte") && "routes (<rte>)", has("wpt") && "waypoints (<wpt>)"]
    .filter(Boolean)
    .join(" and ");

  return fail(
    instead
      ? `${label} contains ${instead} but no track — SquadQuest trails come from tracks`
      : `no track found in ${label}`,
    "Export the route as a GPX *track* (<trk>), which is what the app reads",
  );
}

/** Read and parse a GPX file from disk. */
export function readGpx(path: string): TrailPoint[] {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    throw fail(`cannot read "${path}"`, "Pass a path to a .gpx file");
  }

  let xml: string;
  try {
    xml = readFileSync(path, "utf8");
  } catch {
    throw fail(`"${path}" could not be read as text`, "Pass a .gpx file, not a binary export");
  }

  return parseGpx(xml, `"${path}"`);
}

/** WKT is longitude-first — the same swap the rally point uses. */
export function toLineString(points: TrailPoint[]): string {
  return `LINESTRING(${points.map((p) => `${p.lon} ${p.lat}`).join(",")})`;
}

export function parseLineString(wkt: string | null): TrailPoint[] {
  if (!wkt) return [];
  const inner = /^LINESTRING\s*\(([^)]*)\)$/i.exec(wkt.trim())?.[1];
  if (!inner) return [];
  return inner
    .split(",")
    .map((pair) => {
      const [lon, lat] = pair.trim().split(/\s+/).map(Number);
      return lon !== undefined && lat !== undefined && Number.isFinite(lon) && Number.isFinite(lat)
        ? { lat, lon }
        : undefined;
    })
    .filter((p): p is TrailPoint => p !== undefined);
}

/** Great-circle length in miles — for summarising a route in `events view`. */
export function trailMiles(points: TrailPoint[]): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    total += 2 * R * Math.asin(Math.sqrt(h));
  }
  return total;
}
