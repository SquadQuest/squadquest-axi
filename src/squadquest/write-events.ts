import { insert, patch } from "./client.js";
import type { EventRow, Visibility } from "./events.js";

/** Event writes — specs/api/instances.md. */

export interface NewEvent {
  title: string;
  visibility: Visibility;
  startMinMillis: number;
  startMaxMillis: number;
  endMillis?: number;
  location: string;
  rallyPoint?: { lat: number; lon: number };
  topicId?: string;
  link?: string;
  notes?: string;
}

export async function createEvent(input: NewEvent): Promise<EventRow> {
  const rows = await insert<EventRow>(
    "instances",
    {
      status: "live",
      visibility: input.visibility,
      title: input.title,
      topic: input.topicId ?? null,
      start_time_min: new Date(input.startMinMillis).toISOString(),
      start_time_max: new Date(input.startMaxMillis).toISOString(),
      end_time: input.endMillis ? new Date(input.endMillis).toISOString() : null,
      location_description: input.location,
      // WKT is lon-first; the caller gave us lat,lon. This is the only place
      // the swap happens (specs/behaviors/time-and-place.md).
      rally_point: input.rallyPoint
        ? `POINT(${input.rallyPoint.lon} ${input.rallyPoint.lat})`
        : null,
      link: input.link ?? null,
      notes: input.notes ?? null,
    },
    "creating the event",
  );
  const created = rows[0];
  if (!created) throw new Error("the event was not returned after creation");
  return created;
}

/**
 * Edit in place. Only the given fields are sent, so anything absent is left
 * alone. Notification fan-out for the fields that warrant it is handled by
 * database webhooks (specs/api/conventions.md), so the PATCH is the whole job.
 */
export async function updateEvent(
  id: string,
  changes: Record<string, unknown>,
): Promise<EventRow | undefined> {
  const rows = await patch<EventRow>("instances", `id=eq.${id}`, changes, "updating the event");
  return rows[0];
}

/**
 * Cancel by status, never delete. The cancel notification is driven by the
 * status change through a database webhook; deleting the row would strand
 * every attendee silently (specs/api/instances.md).
 */
export async function cancelEvent(id: string): Promise<EventRow | undefined> {
  const rows = await patch<EventRow>(
    "instances",
    `id=eq.${id}`,
    { status: "canceled" },
    "cancelling the event",
  );
  return rows[0];
}
