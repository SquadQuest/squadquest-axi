import { HOME_FLAGS, parseFlags, str } from "../flags.js";
import { resolveCredential } from "../config.js";
import { displayPhone, shortName } from "../squadquest/auth.js";
import { listEvents } from "../squadquest/events.js";
import { formatWindow, resolveTimezone } from "../time/wallclock.js";
import {
  computed,
  joinBlocks,
  renderHelp,
  renderList,
  renderObject,
} from "../output/index.js";

/**
 * The no-args view (AXI §8) and what the SessionStart hook prints (AXI §7).
 *
 * This loads on **every** session, so five events at five columns is the
 * ceiling. Notes, locations, links and guest lists belong in `events view`.
 */
const DEFAULT_LIMIT = 5;

export async function homeCommand(args: string[]): Promise<string> {
  const parsed = parseFlags("home", args, HOME_FLAGS);
  const zone = resolveTimezone(str(parsed, "--timezone"));
  const limit = Number(str(parsed, "--limit", String(DEFAULT_LIMIT)));

  // The SDK emits `bin:` and `description:` for the home view itself (AXI
  // §10) — adding them here would print the pair twice.
  const credential = resolveCredential();

  // A hook that exits non-zero on a fresh machine is noise in every session,
  // so the unauthenticated view is a normal, successful result.
  if (!credential) {
    return joinBlocks(
      renderObject({ account: "not signed in" }),
      renderHelp(["Run `squadquest-axi auth login --phone <number>` to sign in"]),
    );
  }

  const self = credential.session?.self;
  const account = self ? `${shortName(self)} (${displayPhone(self.phone)})` : "signed in";

  const { items } = await listEvents({ limit });
  const invitations = items.filter((i) => i.rsvp === "invited").length;

  const suggestions: string[] = [];
  if (items.length > 0) {
    suggestions.push("Run `squadquest-axi events view <id>` for the full event and its guest list");
  }
  if (invitations > 0) {
    suggestions.push("Run `squadquest-axi rsvp yes --event <id>` to respond to an invitation");
  }
  suggestions.push(
    'Run `squadquest-axi events create --title "..." --start <when> --location "..."` to post one',
  );
  if (items.length === 0) {
    suggestions.push("Run `squadquest-axi friends` to see who you could rally");
  }

  return joinBlocks(
    renderObject({ account }),
    items.length === 0
      ? renderObject({ upcoming: "no upcoming events" })
      : renderList(
          "upcoming",
          items.map((i) => ({
            id: i.event.id,
            title: i.event.title,
            when: formatWindow(
              Date.parse(i.event.start_time_min),
              Date.parse(i.event.start_time_max),
              zone,
            ),
            rsvp: i.rsvp ?? (i.hosting ? "hosting" : "—"),
            going: i.going,
          })),
          [
            computed("id", (i) => i.id),
            computed("title", (i) => i.title),
            computed("when", (i) => i.when),
            computed("rsvp", (i) => i.rsvp),
            computed("going", (i) => i.going),
          ],
        ),
    invitations > 0
      ? renderObject({
          invitations: `${invitations} awaiting your RSVP`,
        })
      : "",
    renderHelp(suggestions),
  );
}
