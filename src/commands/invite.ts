import { AxiError } from "axi-sdk-js";
import { INVITE_FLAGS, parseFlags, str } from "../flags.js";
import { getEvent, membersFor } from "../squadquest/events.js";
import { invitePeople } from "../squadquest/members.js";
import { resolveAll } from "../squadquest/resolve.js";
import { shortPersonName } from "../squadquest/friends.js";
import { requireCredential } from "../config.js";
import { formatWindow, resolveTimezone } from "../time/wallclock.js";
import {
  computed,
  joinBlocks,
  renderHelp,
  renderList,
  renderObject,
} from "../output/index.js";

export async function inviteCommand(args: string[]): Promise<string> {
  const parsed = parseFlags("invite", args, INVITE_FLAGS);
  const zone = resolveTimezone(str(parsed, "--timezone"));

  const names = parsed.positional;
  if (names.length === 0) {
    throw new AxiError("at least one name or id is required", "USAGE", [
      'Run `squadquest-axi invite "<name>" --event <id>`',
      "Run `squadquest-axi friends` to see who you can invite",
    ]);
  }

  const eventId = str(parsed, "--event");
  if (!eventId) {
    throw new AxiError("--event is required", "USAGE", [
      'Run `squadquest-axi invite "<name>" --event <id>`',
      "Run `squadquest-axi events` to find the id",
    ]);
  }

  const event = await getEvent(eventId);
  if (!event) {
    throw new AxiError("no event found for that id", "EVENT_NOT_FOUND", [
      "Run `squadquest-axi events` to list the events you can see",
    ]);
  }

  const me = requireCredential().session?.self?.id;
  const existing = await membersFor([eventId]);

  // The invite function carries a `TODO: check that user has permission to
  // invite to this event` — there is no server-side check. This guard covers
  // that gap. It is NOT a security boundary; it exists so the tool doesn't
  // help someone do what the app wouldn't let them (specs/commands/invite.md).
  const mayInvite =
    event.created_by === me || existing.some((m) => m.member === me);
  if (!mayInvite) {
    throw new AxiError(
      "you can only invite to an event you host or are part of",
      "NOT_PERMITTED",
      [`Run \`squadquest-axi rsvp yes --event ${eventId}\` if you were invited`],
    );
  }

  // Resolve everyone BEFORE sending anything: a partially-resolved batch that
  // fired would notify some people, leave the caller unsure which, and offer
  // no clean retry (specs/behaviors/name-resolution.md).
  const people = await resolveAll(names);

  const alreadyThere = new Set(existing.map((m) => m.member));
  const fresh = people.filter((p) => !alreadyThere.has(p.id));
  const skipped = people.filter((p) => alreadyThere.has(p.id));

  const when = formatWindow(
    Date.parse(event.start_time_min),
    Date.parse(event.start_time_max),
    zone,
  );

  if (fresh.length === 0) {
    // Everyone already had a member row. The backend would no-op too; saying
    // so plainly beats printing an empty `invited` block (AXI §5/§6).
    return joinBlocks(
      renderObject({
        invited: `nobody new — all ${skipped.length} already invited or attending`,
        event: `${event.title} (${when})`,
      }),
      renderHelp([`Run \`squadquest-axi events view ${eventId}\` to see the guest list`]),
    );
  }

  const result = await invitePeople(
    eventId,
    fresh.map((p) => p.id),
  );

  // Echo the names WE resolved, not the ones the response carries. The caller
  // needs to verify that who we matched is who they meant, and the function's
  // scrubbed profiles may render differently. The response is used only to
  // confirm *which* ids were actually created — and if it reports none (an
  // older deployment, a shape change), fall back to what we sent rather than
  // claiming nothing happened.
  const confirmed = new Set(result.invited.map((p) => p.id));
  const invited = confirmed.size > 0 ? fresh.filter((p) => confirmed.has(p.id)) : fresh;

  return joinBlocks(
    renderList(
      "invited",
      invited.map((p) => ({ name: shortPersonName(p), id: p.id, status: "invited" })),
      [
        computed("name", (i) => i.name),
        computed("id", (i) => i.id),
        computed("status", (i) => i.status),
      ],
    ),
    skipped.length > 0
      ? renderList(
          "skipped",
          skipped.map((p) => ({ name: shortPersonName(p), reason: "already invited" })),
          [computed("name", (i) => i.name), computed("reason", (i) => i.reason)],
        )
      : "",
    renderObject({ event: `${event.title} (${when})` }),
    // Never claim a notification was delivered: the backend skips recipients
    // with no push token or invitations disabled (specs/api/members.md).
    renderHelp([`Run \`squadquest-axi events view ${eventId}\` to see the guest list`]),
  );
}
