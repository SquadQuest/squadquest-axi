import { insert, select } from "./client.js";
import type { Person } from "./friends.js";

/**
 * Event chat — specs/api/members.md § event chat.
 *
 * A plain PostgREST table, unusually for this backend: the notification
 * fan-out is a database webhook, so the insert is the whole job.
 */

export interface EventMessage {
  id: string;
  created_at: string;
  created_by: string;
  instance: string;
  content: string;
  pinned: boolean;
}

export interface HydratedMessage extends EventMessage {
  author: Person;
}

/**
 * Authors resolve in one batched call — `created_by:profiles(...)` hits the
 * same two-FK ambiguity as the guest list, and a per-message lookup would be
 * N+1 on a long thread.
 */
export async function listMessages(
  eventId: string,
  limit: number,
): Promise<{ messages: HydratedMessage[]; total: number }> {
  const rows = await select<EventMessage>(
    `event_messages?select=id,created_at,created_by,instance,content,pinned` +
      `&instance=eq.${eventId}&order=created_at.desc&limit=${limit + 1}`,
    "loading the chat",
  );

  const page = rows.slice(0, limit);
  if (page.length === 0) return { messages: [], total: 0 };

  const ids = [...new Set(page.map((m) => m.created_by))];
  const people = await select<Person>(
    `profiles?select=id,first_name,last_name&id=in.(${ids.join(",")})`,
    "loading message authors",
  );
  const byId = new Map(people.map((p) => [p.id, p]));

  return {
    messages: page.map((m) => ({
      ...m,
      author: byId.get(m.created_by) ?? { id: m.created_by, first_name: "", last_name: "" },
    })),
    total: rows.length,
  };
}

export async function postMessage(
  eventId: string,
  content: string,
  pinned: boolean,
): Promise<EventMessage | undefined> {
  const rows = await insert<EventMessage>(
    "event_messages",
    { instance: eventId, content, pinned },
    "posting your message",
  );
  return rows[0];
}

/** The standing announcement, if any — the app surfaces the latest, not a set. */
export async function latestPinned(eventId: string): Promise<EventMessage | undefined> {
  const rows = await select<EventMessage>(
    `event_messages?select=id,created_at,created_by,instance,content,pinned` +
      `&instance=eq.${eventId}&pinned=is.true&order=created_at.desc&limit=1`,
    "loading the pinned message",
  );
  return rows[0];
}
