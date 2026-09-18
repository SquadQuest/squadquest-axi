import { AxiError } from "axi-sdk-js";
import { EVENTS_FLAGS, bool, parseSubcommand, str } from "../flags.js";
import {
  getEvent,
  guestList,
  listEvents,
  parseWkt,
  topicNames,
  type EventWithContext,
} from "../squadquest/events.js";
import { shortPersonName } from "../squadquest/friends.js";
import { formatFull, formatTime, formatWindow, resolveTimezone } from "../time/wallclock.js";
import {
  compact,
  computed,
  joinBlocks,
  renderHelp,
  renderList,
  renderListResponse,
  renderObject,
} from "../output/index.js";
import { cancelCommand, createCommand } from "./events-write.js";
import { draftCommand } from "./events-draft.js";

const NOTES_LIMIT = 500;

export async function eventsCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("events", args, EVENTS_FLAGS, "list");
  const zone = resolveTimezone(str(parsed, "--timezone"));

  switch (sub) {
    case "view":
      return view(parsed.positional[0], bool(parsed, "--full"), zone);
    case "create":
      return createCommand(parsed, zone);
    case "cancel":
      return cancelCommand(parsed.positional[0]);
    case "draft":
      return draftCommand(parsed, zone);
    default:
      return list(
        {
          past: bool(parsed, "--past"),
          hostingOnly: bool(parsed, "--hosting"),
          topic: str(parsed, "--topic"),
          limit: Number(str(parsed, "--limit", "20")),
        },
        zone,
      );
  }
}

export function eventRow(item: EventWithContext, zone: string): Record<string, unknown> {
  const { event } = item;
  return {
    id: event.id,
    title: event.title,
    when: formatWindow(
      Date.parse(event.start_time_min),
      Date.parse(event.start_time_max),
      zone,
    ),
    visibility: event.visibility,
    rsvp: item.rsvp ?? (item.hosting ? "hosting" : "—"),
    going: item.going,
  };
}

async function list(
  options: { past: boolean; hostingOnly: boolean; topic?: string; limit: number },
  zone: string,
): Promise<string> {
  const topics = options.topic ? await topicNames() : undefined;
  const { items, total, more } = await listEvents(options);

  let shown = items;
  if (options.topic && topics) {
    const wanted = [...topics.entries()].find(([, name]) => name === options.topic)?.[0];
    shown = items.filter((i) => i.event.topic === wanted);
  }

  const suggestions: string[] = [];
  if (shown.length > 0) {
    suggestions.push("Run `squadquest-axi events view <id>` for details and the guest list");
  }
  if (!options.past) {
    suggestions.push("Run `squadquest-axi events list --past` for events that already happened");
  }
  if (more) {
    suggestions.push(
      `Run \`squadquest-axi events --limit ${options.limit * 4}\` to see more than ${options.limit}`,
    );
  }

  return renderListResponse({
    // `more` means the page was capped, so the total is a floor, not a count.
    summary: { count: more ? `${shown.length} of ${total - 1}+` : `${shown.length} of ${total}` },
    name: "events",
    items: shown.map((i) => eventRow(i, zone)),
    schema: [
      computed("id", (i) => i.id),
      computed("title", (i) => i.title),
      computed("when", (i) => i.when),
      computed("visibility", (i) => i.visibility),
      computed("rsvp", (i) => i.rsvp),
      computed("going", (i) => i.going),
    ],
    emptyMessage: options.past
      ? "no past events you were part of"
      : "no upcoming events you're part of",
    suggestions,
  });
}

async function view(id: string | undefined, full: boolean, zone: string): Promise<string> {
  if (!id) {
    throw new AxiError("an event id is required", "USAGE", [
      "Run `squadquest-axi events` to list your events, then `events view <id>`",
    ]);
  }

  const event = await getEvent(id);
  if (!event) {
    // The backend cannot distinguish "missing" from "not visible to you", and
    // guessing would leak whether an event exists (specs/commands/rsvp.md).
    throw new AxiError("no event found for that id", "EVENT_NOT_FOUND", [
      "Run `squadquest-axi events` to list the events you can see",
    ]);
  }

  const [guests, topics] = await Promise.all([guestList(event.id), topicNames()]);
  const point = parseWkt(event.rally_point_text);
  const notes = event.notes ?? "";
  const truncated = !full && notes.length > NOTES_LIMIT;

  const start = Date.parse(event.start_time_min);
  const end = Date.parse(event.start_time_max);

  const suggestions: string[] = [];
  if (truncated) {
    suggestions.push(`Run \`squadquest-axi events view ${event.id} --full\` for the complete notes`);
  }
  if (event.status !== "canceled") {
    suggestions.push(`Run \`squadquest-axi rsvp <yes|maybe|no|omw> --event ${event.id}\` to respond`);
    suggestions.push(`Run \`squadquest-axi invite "<name>" --event ${event.id}\` to invite someone`);
  }

  return joinBlocks(
    renderObject({
      event: compact({
        id: event.id,
        title: event.title,
        when:
          formatFull(start, end, zone) +
          (event.end_time ? ` (ends ${formatTime(Date.parse(event.end_time), zone)})` : ""),
        location: event.location_description ?? undefined,
        rally_point: point ? `${point.lat},${point.lon}` : undefined,
        topic: event.topic ? topics.get(event.topic) : undefined,
        visibility: event.visibility,
        status: event.status,
        link: event.link ?? undefined,
        notes: truncated
          ? `${notes.slice(0, NOTES_LIMIT)}\n    ... (truncated, ${notes.length} chars total)`
          : notes.length > 0
            ? notes
            : undefined,
      }),
    }),
    guests.length > 0
      ? renderList(
          "guests",
          guests.map((g) => ({ name: shortPersonName(g.person), status: g.status })),
          [computed("name", (i) => i.name), computed("status", (i) => i.status)],
        )
      : renderObject({ guests: "nobody has been invited yet" }),
    renderHelp(suggestions),
  );
}
