import { readFileSync, statSync } from "node:fs";
import { AxiError } from "axi-sdk-js";
import type { Parsed } from "../flags.js";
import { str } from "../flags.js";
import { callFunction, getFunction } from "../squadquest/client.js";
import { formatWindow } from "../time/wallclock.js";
import { compact, joinBlocks, renderHelp, renderObject } from "../output/index.js";

/**
 * `events draft` — specs/commands/events.md.
 *
 * Wraps the backend's `scrape-event`, which is unauthenticated and returns a
 * partial event. It saves NOTHING: a scraper that posted would turn a bad
 * parse into a notification.
 */

interface Draft {
  title?: string;
  start_time_min?: string;
  start_time_max?: string;
  end_time?: string;
  location_description?: string;
  /** An object here, unlike the WKT string the table takes. */
  rally_point?: { lat: number; lon: number };
  link?: string;
  notes?: string;
  banner_photo?: string;
}

/**
 * Conservative ceiling. The function's real payload limit is undocumented, and
 * a phone photo is several MB — failing before the upload beats a timeout
 * after it.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  gif: "image/gif",
};

export async function draftCommand(parsed: Parsed, zone: string): Promise<string> {
  const url = str(parsed, "--url");
  const flyer = str(parsed, "--flyer");

  if (!url && !flyer) {
    throw new AxiError("--url or --flyer is required", "USAGE", [
      "Run `squadquest-axi events draft --url <url>`",
      "Run `squadquest-axi events draft --flyer <path-to-image>`",
    ]);
  }
  if (url && flyer) {
    throw new AxiError("pass --url or --flyer, not both", "USAGE", [
      "Run `squadquest-axi events draft --url <url>`",
    ]);
  }

  const draft = url ? await fromUrl(url) : await fromFlyer(flyer!, zone);
  return render(draft, url ?? flyer!, zone);
}

async function fromUrl(url: string): Promise<Draft> {
  try {
    new URL(url);
  } catch {
    throw new AxiError(`"${url}" is not a valid URL`, "USAGE", [
      "Pass a full URL, e.g. --url https://example.com/events/123",
    ]);
  }

  try {
    return await getFunction<Draft>(
      "scrape-event",
      `url=${encodeURIComponent(url)}`,
      "reading that page",
      { anonymous: true },
    );
  } catch (error) {
    throw unreadable(error, "page");
  }
}

async function fromFlyer(path: string, zone: string): Promise<Draft> {
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    throw new AxiError(`cannot read "${path}"`, "USAGE", [
      "Pass a path to an image file, e.g. --flyer ./flyer.jpg",
    ]);
  }

  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const mediaType = MEDIA_TYPES[extension];
  if (!mediaType) {
    throw new AxiError(`"${path}" is not an image this can read`, "USAGE", [
      `Supported: ${[...new Set(Object.keys(MEDIA_TYPES))].join(", ")}`,
    ]);
  }

  if (size > MAX_IMAGE_BYTES) {
    throw new AxiError(
      `that image is ${(size / 1024 / 1024).toFixed(1)}MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit`,
      "USAGE",
      ["Scale the photo down and try again"],
    );
  }

  try {
    return await callFunction<Draft>(
      "scrape-event",
      { image: readFileSync(path).toString("base64"), mediaType, timezone: zone },
      "reading that flyer",
      { anonymous: true },
    );
  } catch (error) {
    throw unreadable(error, "flyer");
  }
}

function unreadable(error: unknown, what: string): AxiError {
  const message = error instanceof Error ? error.message : String(error);
  // "scraping-failed" is the backend's way of saying no scraper matched. Say
  // that plainly rather than surfacing an internal code.
  if (/scraping-failed|Failed to load page|not found/i.test(message)) {
    return new AxiError(`could not read an event out of that ${what}`, "NO_DRAFT", [
      "Supported sources: Eventbrite, Facebook, Resident Advisor, Partiful, AXS, or any page with event markup",
      'Run `squadquest-axi events create --title "..." --start <when> --location "..."` to post it by hand',
    ]);
  }
  return new AxiError(`could not read that ${what}: ${message}`, "NO_DRAFT", [
    'Run `squadquest-axi events create --title "..." --start <when> --location "..."` to post it by hand',
  ]);
}

function render(draft: Draft, source: string, zone: string): string {
  const start = draft.start_time_min ? Date.parse(draft.start_time_min) : undefined;
  const end = draft.start_time_max ? Date.parse(draft.start_time_max) : start;

  // A partial extraction is the normal case; name what's missing rather than
  // pretending the draft is complete.
  const missing = [
    !draft.title && "title",
    !start && "start",
    !draft.location_description && "location",
  ].filter(Boolean) as string[];

  const createCommand = [
    "squadquest-axi events create",
    `--title "${draft.title ?? "<title>"}"`,
    `--start ${start ? new Date(start).toISOString() : "<when>"}`,
    `--location "${draft.location_description ?? "<location>"}"`,
    ...(draft.link ? [`--link ${draft.link}`] : []),
  ].join(" ");

  return joinBlocks(
    renderObject({
      draft: compact({
        title: draft.title,
        when: start !== undefined ? formatWindow(start, end ?? start, zone) : undefined,
        location: draft.location_description,
        rally_point: draft.rally_point
          ? `${draft.rally_point.lat},${draft.rally_point.lon}`
          : undefined,
        link: draft.link,
        notes: draft.notes,
        ...(missing.length > 0 ? { missing: missing.join(", ") } : {}),
      }),
      source,
      saved: false,
    }),
    // The filled-in create command, so accepting a good draft is one paste.
    renderHelp([`Run \`${createCommand}\` to post it`]),
  );
}
