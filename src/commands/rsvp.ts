import { AxiError } from "axi-sdk-js";
import { RSVP_FLAGS, parseFlags, str } from "../flags.js";
import { getEvent, membersFor, type RsvpStatus } from "../squadquest/events.js";
import { setRsvp } from "../squadquest/members.js";
import { requireCredential } from "../config.js";
import { formatFull, resolveTimezone } from "../time/wallclock.js";
import { joinBlocks, renderHelp, renderObject } from "../output/index.js";

const STATUSES: RsvpStatus[] = ["invited", "no", "maybe", "yes", "omw"];
const SETTABLE = ["yes", "maybe", "no", "omw", "none"];

export async function rsvpCommand(args: string[]): Promise<string> {
  const parsed = parseFlags("rsvp", args, RSVP_FLAGS);
  const zone = resolveTimezone(str(parsed, "--timezone"));

  const wanted = parsed.positional[0];
  if (!wanted) {
    throw new AxiError("a status is required", "USAGE", [
      "Run `squadquest-axi rsvp <yes|maybe|no|omw|none> --event <id>`",
    ]);
  }
  if (!SETTABLE.includes(wanted)) {
    throw new AxiError(`"${wanted}" is not an RSVP status`, "USAGE", [
      `Valid statuses: ${SETTABLE.join(", ")}`,
    ]);
  }

  const eventId = str(parsed, "--event");
  if (!eventId) {
    throw new AxiError("--event is required", "USAGE", [
      `Run \`squadquest-axi rsvp ${wanted} --event <id>\``,
      "Run `squadquest-axi events` to find the id",
    ]);
  }

  const status = wanted === "none" ? null : (wanted as RsvpStatus);
  const me = requireCredential().session?.self?.id;

  const event = await getEvent(eventId);
  if (!event) {
    // 404 covers both "missing" and "not visible to you", and the backend
    // cannot tell them apart — guessing would leak whether an event exists.
    throw new AxiError("no event found for that id", "EVENT_NOT_FOUND", [
      "Run `squadquest-axi events` to list the events you can see",
    ]);
  }

  const before = await membersFor([eventId]);
  const mine = me ? before.find((m) => m.member === me)?.status : undefined;

  if ((mine ?? null) === status) {
    return joinBlocks(
      renderObject({
        rsvp: `already ${status ?? "withdrawn"} (no-op)`,
        event: event.title,
      }),
    );
  }

  const result = await setRsvp(eventId, status, str(parsed, "--note"));

  const after = await membersFor([eventId]);
  const going = after.filter((m) => m.status === "yes" || m.status === "omw").length;

  const notes: string[] = [];
  if (status === "omw") {
    // A caller must never learn this from a map.
    notes.push("you are now sharing your location with this event");
  }

  return joinBlocks(
    renderObject({
      rsvp: {
        event: event.title,
        when: formatFull(
          Date.parse(event.start_time_min),
          Date.parse(event.start_time_max),
          zone,
        ),
        status: result.status ?? "withdrawn",
        going,
        ...(notes.length > 0 ? { note: notes[0] } : {}),
      },
    }),
    renderHelp([`Run \`squadquest-axi events view ${eventId}\` for the full guest list`]),
  );
}

export { STATUSES };
