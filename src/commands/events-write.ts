import { AxiError } from "axi-sdk-js";
import type { Parsed } from "../flags.js";
import { str } from "../flags.js";
import { getEvent, membersFor, type Visibility } from "../squadquest/events.js";
import { cancelEvent, createEvent } from "../squadquest/write-events.js";
import { listTopics, nearMisses } from "../squadquest/topics.js";
import { setRsvp } from "../squadquest/members.js";
import { requireCredential } from "../config.js";
import { DetailedError } from "../errors.js";
import { formatFull, parseInstant } from "../time/wallclock.js";
import { joinBlocks, renderHelp, renderObject, compact } from "../output/index.js";

const DAY_MS = 86_400_000;
const VISIBILITIES: Visibility[] = ["private", "friends", "public"];

function required(parsed: Parsed, flag: string): string {
  const value = str(parsed, flag);
  if (!value) {
    throw new AxiError(`${flag} is required`, "USAGE", [
      'Run `squadquest-axi events create --title "..." --start <when> --location "..."`',
    ]);
  }
  return value;
}

function parseRallyPoint(raw: string | undefined): { lat: number; lon: number } | undefined {
  if (!raw) return undefined;
  const [latText, lonText, ...rest] = raw.split(",");
  const lat = Number(latText);
  const lon = Number(lonText);
  if (rest.length > 0 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new AxiError(`"${raw}" is not a lat,lon pair`, "USAGE", [
      "Pass latitude first, e.g. --rally-point 39.9012,-75.172",
    ]);
  }
  // Catches the reversed-argument mistake for most of the populated world.
  // A safety net, not the guarantee — the guarantee is that the WKT swap
  // exists in exactly one place.
  if (lat < -90 || lat > 90) {
    throw new AxiError(`latitude ${lat} is out of range`, "USAGE", [
      "Latitude comes first and must be between -90 and 90 — did you pass lon,lat?",
    ]);
  }
  if (lon < -180 || lon > 180) {
    throw new AxiError(`longitude ${lon} is out of range`, "USAGE", [
      "Longitude must be between -180 and 180",
    ]);
  }
  return { lat, lon };
}

export async function createCommand(parsed: Parsed, zone: string): Promise<string> {
  const title = required(parsed, "--title");
  const location = required(parsed, "--location");
  const startRaw = required(parsed, "--start");

  const startMin = parseInstant(startRaw, zone, "--start");
  const startMaxRaw = str(parsed, "--start-max");
  const startMax = startMaxRaw ? parseInstant(startMaxRaw, zone, "--start-max") : startMin;
  const endRaw = str(parsed, "--end");
  const end = endRaw ? parseInstant(endRaw, zone, "--end") : undefined;

  // Sanity checks before any network call.
  if (startMax < startMin) {
    throw new AxiError("--start-max is earlier than --start", "USAGE", [
      "The rally window runs from --start to --start-max",
    ]);
  }
  if (end !== undefined && end < startMax) {
    throw new AxiError("--end is earlier than the end of the rally window", "USAGE", [
      "Pass an --end after --start-max",
    ]);
  }
  if (startMax - startMin > DAY_MS) {
    throw new AxiError("the rally window is longer than 24 hours", "USAGE", [
      "Check --start and --start-max — a window that long is usually a date typo",
    ]);
  }

  const visibilityRaw = str(parsed, "--visibility", "friends");
  if (!VISIBILITIES.includes(visibilityRaw as Visibility)) {
    throw new AxiError(`"${visibilityRaw}" is not a visibility`, "USAGE", [
      `Valid values: ${VISIBILITIES.join(", ")} (private means invite-only)`,
    ]);
  }

  const rallyPoint = parseRallyPoint(str(parsed, "--rally-point"));
  const topicName = str(parsed, "--topic");
  let topicId: string | undefined;

  if (topicName) {
    const topics = await listTopics();
    const match = topics.find((t) => t.name === topicName);
    if (!match) {
      // Never create a topic as a side effect of posting an event.
      const near = nearMisses(topicName, topics);
      throw new DetailedError(
        `no topic named "${topicName}"`,
        "NO_MATCH",
        near.length > 0 ? { candidates: near.map((t) => ({ name: t.name })) } : {},
        [
          ...(near.length > 0
            ? [`Run \`squadquest-axi events create ... --topic ${near[0]!.name}\``]
            : []),
          `Run \`squadquest-axi topics create ${topicName}\` first if it should exist`,
          "Run `squadquest-axi topics` to see the vocabulary",
        ],
      );
    }
    topicId = match.id;
  }

  const event = await createEvent({
    title,
    visibility: visibilityRaw as Visibility,
    startMinMillis: startMin,
    startMaxMillis: startMax,
    endMillis: end,
    location,
    rallyPoint,
    topicId,
    link: str(parsed, "--link"),
    notes: str(parsed, "--notes"),
  });

  // An event whose host has no RSVP row shows nobody attending, so the pair is
  // one operation (specs/api/instances.md).
  let rsvpFailed: string | undefined;
  try {
    await setRsvp(event.id, "yes");
  } catch (error) {
    rsvpFailed = error instanceof Error ? error.message : "the host RSVP failed";
  }

  const notes: string[] = [];
  if (!startMaxRaw) {
    notes.push("rally window has no range — pass --start-max to widen it");
  }
  if (startMin < Date.now()) {
    notes.push("this start time is in the past");
  }

  return joinBlocks(
    renderObject({
      event: compact({
        id: event.id,
        title: event.title,
        when: formatFull(startMin, startMax, zone),
        location: event.location_description ?? undefined,
        visibility: event.visibility,
        topic: topicName,
        rally_point: rallyPoint ? `${rallyPoint.lat},${rallyPoint.lon}` : undefined,
        your_rsvp: rsvpFailed ? "NOT SET" : "yes",
        ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
      }),
    }),
    rsvpFailed
      ? joinBlocks(
          renderObject({
            warning: `the event was created but your host RSVP failed: ${rsvpFailed}`,
          }),
          renderHelp([`Run \`squadquest-axi rsvp yes --event ${event.id}\` to fix it`]),
        )
      : renderHelp([
          `Run \`squadquest-axi invite "<name>" --event ${event.id}\` to invite people`,
          `Run \`squadquest-axi events view ${event.id}\` to see it`,
        ]),
  );
}

export async function cancelCommand(id: string | undefined): Promise<string> {
  if (!id) {
    throw new AxiError("an event id is required", "USAGE", [
      "Run `squadquest-axi events cancel <id>`",
    ]);
  }

  const event = await getEvent(id);
  if (!event) {
    throw new AxiError("no event found for that id", "EVENT_NOT_FOUND", [
      "Run `squadquest-axi events` to list the events you can see",
    ]);
  }

  if (event.status === "canceled") {
    return renderObject({ event: `${event.title} is already canceled (no-op)` });
  }

  const me = requireCredential().session?.self?.id;
  if (event.created_by !== me) {
    throw new AxiError("only the host can cancel an event", "NOT_PERMITTED", [
      `Run \`squadquest-axi rsvp no --event ${id}\` to withdraw instead`,
    ]);
  }

  const members = await membersFor(id ? [id] : []);
  const notified = members.filter(
    (m) => m.member !== me && ["yes", "maybe", "omw"].includes(m.status),
  ).length;

  await cancelEvent(id);

  return joinBlocks(
    renderObject({
      canceled: event.title,
      // The consequence the caller is actually authorizing.
      notifying: `${notified} attendee${notified === 1 ? "" : "s"}`,
    }),
    renderHelp([`Run \`squadquest-axi events view ${id}\` to confirm`]),
  );
}
