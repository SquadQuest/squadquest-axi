import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { trailMiles, type TrailPoint } from "./gpx.js";

/**
 * Side-channel file export — the `--gpx-out[=path]` convention.
 *
 * Follows the pattern established in metabase-axi (JarvusInnovations/axi#32):
 * stdout stays the agent-optimized TOON view and is never changed by writing
 * a file; the export is purely additive. The flag names the format, so there
 * is no generic `--out` and no extension sniffing.
 *
 * An auto-generated path lands in the **OS temp dir**, not `~/.config` — an
 * unrequested export is ephemeral scratch, and a durable config dir nothing
 * prunes would grow without bound. (That was the trap metabase-axi hit and
 * fixed.)
 */

export interface WrittenExport {
  path: string;
  points: number;
  miles: number;
  bounds: string;
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "event"
  );
}

function autoPath(eventId: string, title: string): string {
  return join(tmpdir(), "squadquest-axi", `${slug(title)}-${eventId.slice(0, 8)}.gpx`);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * SquadQuest stores WKT, not GPX, so unlike metabase-axi's exports this is a
 * re-serialization rather than the source's own output. Elevation and
 * timestamps were never stored, so the track carries coordinates only.
 */
function buildGpx(points: TrailPoint[], title: string, link: string | null): string {
  const trkpts = points
    .map((p) => `      <trkpt lat="${p.lat}" lon="${p.lon}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="squadquest-axi" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(title)}</name>${link ? `\n    <link href="${escapeXml(link)}"/>` : ""}
  </metadata>
  <trk>
    <name>${escapeXml(title)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function writeGpx(
  target: string | true,
  eventId: string,
  title: string,
  link: string | null,
  points: TrailPoint[],
): WrittenExport {
  const explicit = typeof target === "string";
  const path = explicit ? target : autoPath(eventId, title);

  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Owner-only: an auto-generated export sits in a shared temp dir.
    writeFileSync(path, buildGpx(points, title, link), { mode: 0o600 });
  } catch (error) {
    throw new AxiError(
      `could not write "${path}": ${error instanceof Error ? error.message : "unknown error"}`,
      "USAGE",
      ["Pass a writable path, e.g. --gpx-out=./route.gpx"],
    );
  }

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const round = (n: number) => n.toFixed(4);

  return {
    path,
    points: points.length,
    miles: trailMiles(points),
    bounds: `${round(Math.min(...lats))},${round(Math.min(...lons))} to ${round(Math.max(...lats))},${round(Math.max(...lons))}`,
  };
}
