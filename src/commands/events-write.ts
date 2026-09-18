import { AxiError } from "axi-sdk-js";
import type { Parsed } from "../flags.js";
import { bool, str } from "../flags.js";
import { getEvent, membersFor, type Visibility } from "../squadquest/events.js";
import { cancelEvent, createEvent, updateEvent } from "../squadquest/write-events.js";
import { listTopics, nearMisses } from "../squadquest/topics.js";
import { setRsvp } from "../squadquest/members.js";
import { requireCredential } from "../config.js";
import { DetailedError } from "../errors.js";
import { formatFull, parseInstant } from "../time/wallclock.js";
import {
  compact,
  computed,
  joinBlocks,
  renderHelp,
  renderList,
  renderObject,
} from "../output/index.js";

const DAY_MS = 86_400_000;
const VISIBILITIES: Visibility[] = ["private", "friends", "public"];

function required(parsed: Parsed, flag: string): string {
  const value = str(parsed, flag);
  if (!value) {
    throw new AxiError(`${flag} is required`, "USAGE", [
      'Run `squadquest-axi events create --title "..." --start <when> --location "..." --topic <name>`',
      ...(flag === "--topic" ? ["Run `squadquest-axi topics` to see the vocabulary"] : []),
    ]);
  }
  return value;
}

export function parseRallyPoint(raw: string | undefined): { lat: number; lon: number } | undefined {
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
  checkWindow(startMin, startMax, end);

  const visibilityRaw = str(parsed, "--visibility", "friends");
  if (!VISIBILITIES.includes(visibilityRaw as Visibility)) {
    throw new AxiError(`"${visibilityRaw}" is not a visibility`, "USAGE", [
      `Valid values: ${VISIBILITIES.join(", ")} (private means invite-only)`,
    ]);
  }

  const rallyPoint = parseRallyPoint(str(parsed, "--rally-point"));

  // Required, though the column is nullable: an event with a null topic
  // crashes the v1 clients for everyone who can see it
  // (specs/api/instances.md). Nothing upstream stops us writing it, so
  // refusing is the client's job.
  const topicName = required(parsed, "--topic");
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
    notes.push("arrival window is a single instant — pass --start-max for a range");
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
          `Run \`squadquest-axi events edit ${event.id} --notes "..."\` to change it later`,
          `Run \`squadquest-axi events view ${event.id}\` to see it`,
        ]),
  );
}

/** Window sanity, shared by create and edit. Runs before any write. */
export function checkWindow(startMin: number, startMax: number, end?: number): void {
  if (startMax < startMin) {
    throw new AxiError("the arrival window ends before it starts", "USAGE", [
      "--start is when people can begin showing up; --start-max is the latest",
    ]);
  }
  if (end !== undefined && end < startMax) {
    throw new AxiError("--end is earlier than the end of the arrival window", "USAGE", [
      "--end is when the event wraps up, after the last arrival",
    ]);
  }
  if (startMax - startMin > DAY_MS) {
    throw new AxiError("the arrival window is longer than 24 hours", "USAGE", [
      "Check --start and --start-max — a window that long is usually a date typo",
    ]);
  }
}

export async function editCommand(
  parsed: Parsed,
  zone: string,
  id: string | undefined,
): Promise<string> {
  if (!id) {
    throw new AxiError("an event id is required", "USAGE", [
      'Run `squadquest-axi events edit <id> --notes "..."`',
      "Run `squadquest-axi events` to find the id",
    ]);
  }

  const event = await getEvent(id);
  if (!event) {
    throw new AxiError("no event found for that id", "EVENT_NOT_FOUND", [
      "Run `squadquest-axi events` to list the events you can see",
    ]);
  }

  const me = requireCredential().session?.self?.id;
  if (event.created_by !== me) {
    throw new AxiError("only the host can edit an event", "NOT_PERMITTED", [
      `Run \`squadquest-axi events view ${id}\` to see it`,
    ]);
  }

  const changes: Record<string, unknown> = {};
  const shown: Array<Record<string, unknown>> = [];
  const note = (field: string, before: unknown, after: unknown) =>
    shown.push({ field, from: before ?? "(unset)", to: after ?? "(unset)" });

  const title = str(parsed, "--title");
  if (title !== undefined && title !== event.title) {
    changes.title = title;
    note("title", event.title, title);
  }

  const location = str(parsed, "--location");
  if (location !== undefined && location !== event.location_description) {
    changes.location_description = location;
    note("location", event.location_description, location);
  }

  const link = str(parsed, "--link");
  if (link !== undefined && link !== event.link) {
    changes.link = link;
    note("link", event.link, link);
  }

  const notes = str(parsed, "--notes");
  if (notes !== undefined && notes !== event.notes) {
    changes.notes = notes;
    note("notes", `${(event.notes ?? "").length} chars`, `${notes.length} chars`);
  }

  const visibility = str(parsed, "--visibility");
  if (visibility !== undefined) {
    if (!VISIBILITIES.includes(visibility as Visibility)) {
      throw new AxiError(`"${visibility}" is not a visibility`, "USAGE", [
        `Valid values: ${VISIBILITIES.join(", ")} (private means invite-only)`,
      ]);
    }
    if (visibility !== event.visibility) {
      changes.visibility = visibility;
      note("visibility", event.visibility, visibility);
    }
  }

  // Times validate against the MERGED values: changing only --start must be
  // checked against the stored --start-max, not against nothing.
  const startRaw = str(parsed, "--start");
  const startMaxRaw = str(parsed, "--start-max");
  const endRaw = str(parsed, "--end");

  const storedMin = Date.parse(event.start_time_min);
  const storedMax = Date.parse(event.start_time_max);
  const storedEnd = event.end_time ? Date.parse(event.end_time) : undefined;

  const nextMin = startRaw ? parseInstant(startRaw, zone, "--start") : storedMin;
  const nextMax = startMaxRaw ? parseInstant(startMaxRaw, zone, "--start-max") : storedMax;
  const nextEnd = endRaw ? parseInstant(endRaw, zone, "--end") : storedEnd;

  if (startRaw || startMaxRaw || endRaw) {
    checkWindow(nextMin, nextMax, nextEnd);
  }
  if (nextMin !== storedMin) {
    changes.start_time_min = new Date(nextMin).toISOString();
    note("arrival from", formatFull(storedMin, storedMin, zone), formatFull(nextMin, nextMin, zone));
  }
  if (nextMax !== storedMax) {
    changes.start_time_max = new Date(nextMax).toISOString();
    note("arrival until", formatFull(storedMax, storedMax, zone), formatFull(nextMax, nextMax, zone));
  }
  if (nextEnd !== storedEnd) {
    changes.end_time = nextEnd ? new Date(nextEnd).toISOString() : null;
    note("ends", storedEnd ? formatFull(storedEnd, storedEnd, zone) : undefined, nextEnd ? formatFull(nextEnd, nextEnd, zone) : undefined);
  }

  const rallyRaw = str(parsed, "--rally-point");
  if (rallyRaw !== undefined) {
    const point = parseRallyPoint(rallyRaw);
    if (point) {
      changes.rally_point = `POINT(${point.lon} ${point.lat})`;
      note("rally point", event.rally_point_text ?? undefined, `${point.lat},${point.lon}`);
    }
  }

  const topicName = str(parsed, "--topic");
  if (topicName !== undefined) {
    if (topicName.length === 0) {
      // Clearing a topic crashes the v1 clients (specs/api/instances.md).
      throw new AxiError("a topic cannot be cleared", "USAGE", [
        "Pass a different topic name, or leave --topic off to keep the current one",
      ]);
    }
    const topics = await listTopics();
    const match = topics.find((t) => t.name === topicName);
    if (!match) {
      const near = nearMisses(topicName, topics);
      throw new DetailedError(
        `no topic named "${topicName}"`,
        "NO_MATCH",
        near.length > 0 ? { candidates: near.map((t) => ({ name: t.name })) } : {},
        [`Run \`squadquest-axi topics create ${topicName}\` first if it should exist`],
      );
    }
    if (match.id !== event.topic) {
      changes.topic = match.id;
      note("topic", event.topic ?? undefined, match.name);
    }
  }

  if (Object.keys(changes).length === 0) {
    // An edit that changes nothing almost always means a misspelled flag, so
    // it is a caller mistake rather than a no-op (specs/commands/events.md).
    throw new AxiError("nothing to change", "USAGE", [
      `Run \`squadquest-axi events view ${id}\` to see the current values`,
      'Pass at least one field, e.g. --notes "..." or --start-max <when>',
    ]);
  }

  await updateEvent(id, changes);

  return joinBlocks(
    renderObject({ edited: event.title, id }),
    renderList("changes", shown, [
      computed("field", (i) => i.field),
      computed("from", (i) => i.from),
      computed("to", (i) => i.to),
    ]),
    renderHelp([`Run \`squadquest-axi events view ${id}\` to confirm`]),
  );
}

/**
 * Its own verb rather than a flag on `edit`, so `cancel` / `uncancel` read as
 * a pair in the command list and the undo is found by reading rather than
 * guessing (specs/commands/events.md).
 */
export async function uncancelCommand(id: string | undefined): Promise<string> {
  if (!id) {
    throw new AxiError("an event id is required", "USAGE", [
      "Run `squadquest-axi events uncancel <id>`",
    ]);
  }

  const event = await getEvent(id);
  if (!event) {
    throw new AxiError("no event found for that id", "EVENT_NOT_FOUND", [
      "Run `squadquest-axi events` to list the events you can see",
    ]);
  }

  if (event.status !== "canceled") {
    return renderObject({ event: `${event.title} is not canceled (no-op)` });
  }

  const me = requireCredential().session?.self?.id;
  if (event.created_by !== me) {
    throw new AxiError("only the host can uncancel an event", "NOT_PERMITTED", []);
  }

  await updateEvent(id, { status: "live" });

  return joinBlocks(
    renderObject({
      uncanceled: event.title,
      // Cancelling and uncancelling both notify, so the mistake was seen.
      // Saying so beats implying it went unnoticed.
      note: "guests who were told it was off will be told it is back on",
    }),
    renderHelp([`Run \`squadquest-axi events view ${id}\` to confirm`]),
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
      // The consequence the caller is actually authorizing — cancel is a
      // message to guests, not a record operation.
      told_its_off: `${notified} guest${notified === 1 ? "" : "s"}`,
    }),
    renderHelp([
      // The moment just after cancelling is when a caller finds out whether
      // they picked the right verb, so both alternatives belong here.
      `Run \`squadquest-axi events uncancel ${id}\` to undo this`,
      `If it IS still happening and the record was just wrong, that was \`squadquest-axi events edit ${id}\``,
    ]),
  );
}
