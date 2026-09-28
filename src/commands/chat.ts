import { AxiError } from "axi-sdk-js";
import { CHAT_FLAGS, bool, parseSubcommand, str } from "../flags.js";
import { getEvent, membersFor } from "../squadquest/events.js";
import { latestPinned, listMessages, postMessage } from "../squadquest/chat.js";
import { shortPersonName } from "../squadquest/friends.js";
import { requireCredential } from "../config.js";
import {
  computed,
  joinBlocks,
  renderHelp,
  renderListResponse,
  renderObject,
} from "../output/index.js";

export async function chatCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("chat", args, CHAT_FLAGS, "list");

  const eventId = str(parsed, "--event");
  if (!eventId) {
    throw new AxiError("--event is required", "USAGE", [
      "Run `squadquest-axi chat --event <id>` to read an event's chat",
      "Run `squadquest-axi events` to find the id",
    ]);
  }

  const event = await getEvent(eventId);
  if (!event) {
    // 404 covers both "missing" and "not visible to you"; guessing would leak
    // whether an event exists.
    throw new AxiError("no event found for that id", "EVENT_NOT_FOUND", [
      "Run `squadquest-axi events` to list the events you can see",
    ]);
  }

  if (sub === "post") {
    return post(eventId, parsed.positional[0], bool(parsed, "--pin"), event.created_by, event.title);
  }
  return list(eventId, Number(str(parsed, "--limit", "20")));
}

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** "3d ago" / "just now" — `${ago()} ago` produces "just now ago". */
function since(iso: string): string {
  const relative = ago(iso);
  return relative === "just now" ? relative : `${relative} ago`;
}

async function list(eventId: string, limit: number): Promise<string> {
  const [{ messages, total }, pinned] = await Promise.all([
    listMessages(eventId, limit),
    latestPinned(eventId),
  ]);

  const more = total > limit;

  return joinBlocks(
    // The standing announcement is lifted out, matching the app and because
    // it's the one message someone catching up actually needs.
    pinned
      ? renderObject({ pinned: `${pinned.content} — ${since(pinned.created_at)}` })
      : "",
    renderListResponse({
      summary: { count: more ? `${messages.length} of ${total - 1}+` : String(messages.length) },
      name: "messages",
      items: messages.map((m) => ({
        who: shortPersonName(m.author),
        when: ago(m.created_at),
        pinned: m.pinned,
        message: m.content,
      })),
      schema: [
        computed("who", (i) => i.who),
        computed("when", (i) => i.when),
        computed("pinned", (i) => i.pinned),
        computed("message", (i) => i.message),
      ],
      emptyMessage: "nobody has posted to this event's chat yet",
      suggestions: [`Run \`squadquest-axi chat post "<message>" --event ${eventId}\` to post`],
    }),
  );
}

async function post(
  eventId: string,
  content: string | undefined,
  pin: boolean,
  hostId: string,
  title: string,
): Promise<string> {
  if (!content || content.trim().length === 0) {
    // A blank announcement is never intended, and this one buzzes phones.
    throw new AxiError("a message is required", "USAGE", [
      `Run \`squadquest-axi chat post "<message>" --event ${eventId}\``,
    ]);
  }

  const me = requireCredential().session?.self?.id;

  if (pin && me !== hostId) {
    // Mirrors the app, which sends `pinned: isHost && _isPinned`. The database
    // would accept it (specs/api/members.md) — this is the app's rule, not a
    // server guarantee.
    throw new AxiError("only the host can pin a message", "NOT_PERMITTED", [
      `Run \`squadquest-axi chat post "<message>" --event ${eventId}\` without --pin`,
    ]);
  }

  const supersedes = pin ? await latestPinned(eventId) : undefined;

  // Everyone who will get a push: maybe/yes/omw, minus the sender.
  const members = await membersFor([eventId]);
  const recipients = members.filter(
    (m) => m.member !== me && ["maybe", "yes", "omw"].includes(m.status),
  ).length;

  const posted = await postMessage(eventId, content, pin);

  return joinBlocks(
    renderObject({
      posted: posted?.content ?? content,
      event: title,
      ...(pin ? { pinned: true } : {}),
      // The consequence being authorized — a chat post is a notification to
      // the whole squad, not a quiet note.
      notifying: `${recipients} guest${recipients === 1 ? "" : "s"}`,
      ...(supersedes
        ? { note: `this replaces the previous pinned message: "${supersedes.content}"` }
        : {}),
    }),
    renderHelp([`Run \`squadquest-axi chat --event ${eventId}\` to see the thread`]),
  );
}
