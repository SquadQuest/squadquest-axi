import { select } from "./client.js";
import { requireCredential } from "../config.js";
import type { Person } from "./friends.js";

/**
 * Events — `instances` in the backend (specs/api/instances.md).
 */

export type Visibility = "private" | "friends" | "public";
export type EventStatus = "draft" | "live" | "canceled";
export type RsvpStatus = "invited" | "no" | "maybe" | "yes" | "omw";

export interface EventRow {
  id: string;
  status: EventStatus;
  visibility: Visibility;
  title: string;
  topic: string | null;
  start_time_min: string;
  start_time_max: string;
  end_time: string | null;
  location_description: string | null;
  rally_point_text: string | null;
  link: string | null;
  notes: string | null;
  created_by: string;
}

export interface MemberRow {
  id: string;
  instance: string;
  member: string;
  status: RsvpStatus;
}

/** Geometry reads come back as WKT; the column itself reads as binary. */
export function parseWkt(wkt: string | null): { lat: number; lon: number } | undefined {
  if (!wkt) return undefined;
  const match = /^POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/i.exec(wkt.trim());
  if (!match) return undefined;
  // WKT is lon-first. Humans read lat-first, so the swap happens here and
  // nowhere else (specs/behaviors/time-and-place.md).
  return { lon: Number(match[1]), lat: Number(match[2]) };
}

const EVENT_COLUMNS =
  "id,status,visibility,title,topic,start_time_min,start_time_max,end_time," +
  "location_description,rally_point_text,link,notes,created_by";

function selfId(): string | undefined {
  return requireCredential().session?.self?.id;
}

export interface EventWithContext {
  event: EventRow;
  /** Your own RSVP, when you have one. */
  rsvp?: RsvpStatus;
  /** yes + omw. */
  going: number;
  hosting: boolean;
}

/**
 * Events you host or have a member row for.
 *
 * Two queries rather than N+1: one for the events, one for every member row
 * across them. The home view runs on every session, so its cost is capped by
 * construction rather than by hoping the event count stays small.
 */
export async function listEvents(options: {
  past?: boolean;
  hostingOnly?: boolean;
  topic?: string;
  limit: number;
}): Promise<{ items: EventWithContext[]; total: number; more: boolean }> {
  const me = selfId();
  const nowIso = new Date().toISOString();

  const timeFilter = options.past
    ? `start_time_max=lt.${nowIso}`
    : `start_time_max=gte.${nowIso}`;
  const order = options.past
    ? "order=start_time_min.desc"
    : "order=start_time_min.asc";

  // "Involved in" means hosting it or having a member row — a public event you
  // have never touched is not your business here.
  //
  // Both halves are filtered, ordered and limited SERVER-side. Fetching every
  // visible event and narrowing in JS does work at small scale and then fails
  // outright: the follow-up `instance=in.(...)` grows with the whole public
  // calendar and the request dies with "URI too long". Bound the set first.
  // Fetch one more than asked for per half, so we can tell "this is all of
  // them" from "there are more" without a second count query — and report the
  // difference honestly rather than passing a capped page off as a total.
  const fetchLimit = options.limit + 1;
  const common = [timeFilter, order, `limit=${fetchLimit}`];

  const hosted = me
    ? select<EventRow>(
        `instances?select=${EVENT_COLUMNS}&created_by=eq.${me}&${common.join("&")}`,
        "loading your events",
      )
    : Promise.resolve<EventRow[]>([]);

  // `!inner` makes the membership a join condition rather than an embed, so
  // the filtering happens in the database.
  const attending = me
    ? select<EventRow & { instance_members?: unknown }>(
        `instances?select=${EVENT_COLUMNS},instance_members!inner(member)` +
          `&instance_members.member=eq.${me}&${common.join("&")}`,
        "loading your events",
      )
    : Promise.resolve<EventRow[]>([]);

  const [hostedRows, attendingRows] = await Promise.all([
    hosted,
    options.hostingOnly ? Promise.resolve<EventRow[]>([]) : attending,
  ]);

  const byId = new Map<string, EventRow>();
  for (const row of [...hostedRows, ...attendingRows]) {
    if (row.status !== "draft") byId.set(row.id, row);
  }

  const ordered = [...byId.values()].sort((a, b) =>
    options.past
      ? b.start_time_min.localeCompare(a.start_time_min)
      : a.start_time_min.localeCompare(b.start_time_min),
  );
  const page = ordered.slice(0, options.limit);

  // Only the page's ids, so this stays a short URI whatever the history size.
  const members = await membersFor(page.map((e) => e.id));

  const items: EventWithContext[] = page.map((event) => {
    const rows = members.filter((m) => m.instance === event.id);
    return {
      event,
      rsvp: me ? rows.find((m) => m.member === me)?.status : undefined,
      going: rows.filter((m) => m.status === "yes" || m.status === "omw").length,
      hosting: event.created_by === me,
    };
  });

  return { items, total: ordered.length, more: ordered.length > options.limit };
}

export async function membersFor(eventIds: string[]): Promise<MemberRow[]> {
  if (eventIds.length === 0) return [];
  return select<MemberRow>(
    `instance_members?select=id,instance,member,status&instance=in.(${eventIds.join(",")})`,
    "loading RSVPs",
  );
}

export async function getEvent(id: string): Promise<EventRow | undefined> {
  const rows = await select<EventRow>(
    `instances?select=${EVENT_COLUMNS}&id=eq.${id}`,
    "loading the event",
  );
  return rows[0];
}

/**
 * The guest list. `member:profiles(...)` fails on the two-FK ambiguity
 * (specs/api/members.md), so profiles are resolved in one batched second call
 * rather than per guest.
 */
export async function guestList(
  eventId: string,
): Promise<Array<{ person: Person; status: RsvpStatus }>> {
  const members = await membersFor([eventId]);
  if (members.length === 0) return [];

  const ids = [...new Set(members.map((m) => m.member))];
  const people = await select<Person>(
    `profiles?select=id,first_name,last_name&id=in.(${ids.join(",")})`,
    "loading the guest list",
  );

  const byId = new Map(people.map((p) => [p.id, p]));
  const rank: RsvpStatus[] = ["omw", "yes", "maybe", "invited", "no"];
  return members
    .map((m) => ({
      person: byId.get(m.member) ?? { id: m.member, first_name: "", last_name: "" },
      status: m.status,
    }))
    .sort((a, b) => rank.indexOf(a.status) - rank.indexOf(b.status));
}

export async function topicNames(): Promise<Map<string, string>> {
  const rows = await select<{ id: string; name: string }>(
    "topics?select=id,name",
    "loading topics",
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}
