import { FRIENDS_FLAGS, bool, parseSubcommand, str } from "../flags.js";
import { acceptedFriends, pendingFriendships, shortPersonName } from "../squadquest/friends.js";
import { matchTiers } from "../squadquest/resolve.js";
import { computed, renderListResponse } from "../output/index.js";
import { actionCommand, requestCommand } from "./friend-requests.js";

export async function friendsCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("friends", args, FRIENDS_FLAGS, "list");

  switch (sub) {
    case "request":
      return requestCommand(parsed);
    case "accept":
      return actionCommand("accepted", parsed.positional[0]);
    case "decline":
      return actionCommand("declined", parsed.positional[0]);
    default:
      return list({
        search: str(parsed, "--search"),
        pending: bool(parsed, "--pending"),
        limit: Number(str(parsed, "--limit", "100")),
      });
  }
}

async function list(options: {
  search?: string;
  pending: boolean;
  limit: number;
}): Promise<string> {
  if (options.pending) return listPending();

  const friends = await acceptedFriends();
  let people = friends.map((f) => f.person);

  // The listing shares the resolver's ladder, so what a caller sees here is
  // exactly what `invite` will match — a search showing one result guarantees
  // an unambiguous invite (specs/commands/friends.md).
  if (options.search) people = matchTiers(options.search, people);

  const shown = people.slice(0, options.limit);

  return renderListResponse({
    summary: { count: summarize(people.length, friends.length, options.search) },
    name: "friends",
    items: shown.map((p) => ({ name: shortPersonName(p), id: p.id })),
    schema: [computed("name", (i) => i.name), computed("id", (i) => i.id)],
    emptyMessage: options.search
      ? `no accepted friend matches "${options.search}" (${friends.length} searched)`
      : "no accepted friends yet",
    suggestions: suggestionsFor(options.search, shown.length, people.length, options.limit),
  });
}

function summarize(matched: number, total: number, search?: string): string {
  return search ? `${matched} of ${total} accepted` : `${total} accepted`;
}

function suggestionsFor(
  search: string | undefined,
  shown: number,
  matched: number,
  limit: number,
): string[] {
  const suggestions: string[] = [];
  if (matched > limit) {
    suggestions.push(`Run \`squadquest-axi friends --limit ${matched}\` to see all ${matched}`);
  }
  if (!search && shown > 0) {
    suggestions.push("Run `squadquest-axi friends --search <text>` to narrow by name");
  }
  if (shown > 0) {
    suggestions.push('Run `squadquest-axi invite "<name>" --event <id>` to invite someone');
  }
  if (shown === 0 && search) {
    suggestions.push("Run `squadquest-axi friends` to list everyone");
  }
  return suggestions;
}

async function listPending(): Promise<string> {
  const pending = await pendingFriendships();

  return renderListResponse({
    name: "pending",
    items: pending.map((f) => ({
      name: shortPersonName(f.person),
      id: f.id,
      direction: f.direction,
      since: age(f.created_at),
    })),
    schema: [
      computed("name", (i) => i.name),
      computed("id", (i) => i.id),
      computed("direction", (i) => i.direction),
      computed("since", (i) => i.since),
    ],
    emptyMessage: "no pending friend requests",
    // Accept/decline only apply to requests sent *to* you — offering them on a
    // list of purely outgoing requests sends the agent at a no-op.
    suggestions: pending.some((f) => f.direction === "incoming")
      ? ["Run `squadquest-axi friends accept <id>` or `squadquest-axi friends decline <id>`"]
      : [],
  });
}

function age(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  return hours >= 1 ? `${hours}h` : "just now";
}
