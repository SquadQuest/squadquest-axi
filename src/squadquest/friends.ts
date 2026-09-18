import { select } from "./client.js";
import { requireCredential } from "../config.js";
import { AxiError } from "axi-sdk-js";

/**
 * The friend graph (specs/api/friends.md). Every name the tool resolves comes
 * from here, and nowhere else — never the wider `profiles` table.
 */

export interface Person {
  id: string;
  first_name: string;
  last_name: string;
}

export interface Friendship {
  id: string;
  status: "requested" | "accepted" | "declined";
  created_at: string;
  person: Person;
  /** Relative to the current user. */
  direction: "incoming" | "outgoing";
}

interface FriendRow {
  id: string;
  status: Friendship["status"];
  created_at: string;
  requester: Person | null;
  requestee: Person | null;
}

/**
 * `friends` has two FKs to `profiles`, so a bare embed is ambiguous and
 * PostgREST rejects it — the constraints must be named
 * (specs/api/friends.md).
 *
 * Only `id,first_name,last_name` is selected: a direct PostgREST read is not
 * scrubbed the way the edge functions' responses are, and a friend list is the
 * densest concentration of other people's contact details the tool touches.
 */
const EMBED =
  "id,status,created_at," +
  "requester:profiles!friends_requester_fkey(id,first_name,last_name)," +
  "requestee:profiles!friends_requestee_fkey(id,first_name,last_name)";

function selfId(): string {
  const credential = requireCredential();
  const id = credential.session?.self?.id;
  if (!id) {
    // An env token carries no cached profile, so there is nothing to collapse
    // requester/requestee against.
    throw new AxiError("cannot tell which side of a friendship is you", "NO_SELF", [
      "Run `squadquest-axi auth login --phone <number>` to store a full session",
    ]);
  }
  return id;
}

function collapse(row: FriendRow, me: string): Friendship | undefined {
  // A friendship is undirected once accepted — which side you're on is an
  // artifact of who asked.
  const iAmRequester = row.requester?.id === me;
  const person = iAmRequester ? row.requestee : row.requester;
  if (!person) return undefined;
  return {
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    person,
    direction: iAmRequester ? "outgoing" : "incoming",
  };
}

async function fetchFriendships(status: Friendship["status"]): Promise<Friendship[]> {
  const me = selfId();
  const rows = await select<FriendRow>(
    `friends?select=${EMBED}&status=eq.${status}&or=(requester.eq.${me},requestee.eq.${me})`,
    "loading your friends",
  );
  return rows
    .map((row) => collapse(row, me))
    .filter((f): f is Friendship => f !== undefined);
}

export async function acceptedFriends(): Promise<Friendship[]> {
  const friends = await fetchFriendships("accepted");
  return friends.sort((a, b) => fullName(a.person).localeCompare(fullName(b.person)));
}

export async function pendingFriendships(): Promise<Friendship[]> {
  const pending = await fetchFriendships("requested");
  return pending.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function fullName(person: Person): string {
  return `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim();
}

/** "Ada L." — identifies without publishing a full identity. */
export function shortPersonName(person: Person): string {
  const last = person.last_name?.trim();
  const initial = last ? ` ${last[0]}.` : "";
  return `${person.first_name ?? ""}${initial}`.trim() || "(unnamed)";
}
