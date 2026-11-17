import { AxiError } from "axi-sdk-js";
import { insert, patch, remove, select } from "./client.js";
import { getEvent, type EventRow } from "./events.js";
import { requireCredential } from "../config.js";
import { DetailedError } from "../errors.js";

/**
 * Guests who have not registered — specs/api/guests.md.
 *
 * Written directly over PostgREST, not through an edge function: a guest has
 * no account and no push token, and this tool sends no texts, so there is no
 * notification to bypass (specs/principles.md § 2). RLS is the permission
 * check; the guards here exist so a refusal arrives before any write, with a
 * reason, instead of as a bare RLS error halfway through.
 */

export type GuestStatus = "invited" | "yes" | "maybe" | "no";

export interface Guest {
  id: string;
  name: string;
  phone: string | null;
  token: string;
}

export interface GuestRow {
  instance: string;
  guest: string;
  status: GuestStatus;
  /** the guest's own note for this event; only read by listGuestAnswers() */
  note?: string | null;
  /**
   * extra people coming with the guest (0-9); only read by
   * listGuestAnswers(). Stored whatever the answer: count it only for yes
   * and maybe.
   */
  plus?: number;
}

/**
 * The answers with their notes and plus-ones. `notes` / `plus` is
 * "unavailable" when the server has the guest tables but not that column yet
 * (an older backend): the rows are then read without it, and the caller must
 * say so rather than render every value as empty or zero.
 */
export interface GuestAnswers {
  rows: GuestRow[];
  notes: "ok" | "unavailable";
  plus: "ok" | "unavailable";
}

export interface OpenLink {
  token: string;
  instance: string;
  closed_at: string | null;
  max_guests: number;
  guests_created: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const E164_RE = /^\+[1-9][0-9]{6,14}$/;
export const NAME_MAX = 100;

const GUEST_COLUMNS = "id,name,phone,token";
const OPEN_COLUMNS = "token,instance,closed_at,max_guests,guests_created";

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * A server without the pilot's tables answers "relation does not exist"
 * (42P01) or PostgREST's schema-cache miss (PGRST205/PGRST200). That must
 * never read as "you have no guests".
 */
function unavailable(error: unknown): never {
  if (error instanceof AxiError && ["42P01", "PGRST205", "PGRST200", "PGRST202"].includes(error.code)) {
    throw new AxiError("this SquadQuest server does not have guest support", "GUESTS_UNAVAILABLE", [
      "Guests are a pilot feature; ask the server's operator whether it is deployed",
    ]);
  }
  throw error;
}

async function guarded<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    return unavailable(error);
  }
}

export function selfId(): string {
  const id = requireCredential().session?.self?.id;
  if (!id) {
    throw new AxiError("not signed in", "NO_SESSION", [
      "Run `squadquest-axi auth login --phone <number>` to sign in",
    ]);
  }
  return id;
}

// Events ─────────────────────────────────────────────────────────────

/**
 * Load every event and check the caller created it — all before any write,
 * so a bad id in the middle of a list leaves nothing half-done.
 */
export async function requireOwnEvents(ids: string[]): Promise<EventRow[]> {
  const me = selfId();
  const events: EventRow[] = [];
  for (const id of ids) {
    if (!isUuid(id)) {
      throw new AxiError(`"${id}" is not an event id`, "USAGE", [
        "Run `squadquest-axi events --hosting` to list the events you host",
      ]);
    }
    const event = await getEvent(id);
    if (!event) {
      throw new AxiError(`no event found for ${id}`, "EVENT_NOT_FOUND", [
        "Run `squadquest-axi events --hosting` to list the events you host",
      ]);
    }
    if (event.created_by !== me) {
      throw new AxiError(`you did not create event ${id}; only its host can add guests`, "NOT_PERMITTED", [
        "Run `squadquest-axi events --hosting` to list the events you host",
      ]);
    }
    events.push(event);
  }
  return events;
}

export async function eventTitles(ids: string[]): Promise<Map<string, { title: string; start: string }>> {
  const map = new Map<string, { title: string; start: string }>();
  if (ids.length === 0) return map;
  const rows = await select<{ id: string; title: string; start_time_min: string }>(
    `instances?select=id,title,start_time_min&id=in.(${ids.join(",")})`,
    "loading events",
  );
  for (const row of rows) map.set(row.id, { title: row.title, start: row.start_time_min });
  return map;
}

// Guests ─────────────────────────────────────────────────────────────

export async function listGuests(): Promise<Guest[]> {
  return guarded(
    select<Guest>(
      `guests?select=${GUEST_COLUMNS}&host=eq.${selfId()}&order=name.asc`,
      "loading guests",
    ),
  );
}

/** Rows on the caller's events (RLS scopes them); optionally one event. */
export async function listGuestRows(eventId?: string): Promise<GuestRow[]> {
  const filter = eventId ? `&instance=eq.${eventId}` : "";
  return guarded(
    select<GuestRow>(`instance_guests?select=instance,guest,status${filter}`, "loading guest answers"),
  );
}

/**
 * listGuestRows() plus each row's note and plus-ones — specs/api/guests.md
 * § instance_guests. The columns came one after the other (notes, then
 * plus-ones), so on 42703 it steps back one column at a time.
 */
export async function listGuestAnswers(eventId?: string): Promise<GuestAnswers> {
  const filter = eventId ? `&instance=eq.${eventId}` : "";
  const read = (columns: string) =>
    select<GuestRow>(`instance_guests?select=instance,guest,status${columns}${filter}`, "loading guest answers");
  // 42703: column does not exist — the tables are there, that column is not
  const missingColumn = (error: unknown) => error instanceof AxiError && error.code === "42703";
  try {
    const rows = await read(",note,plus");
    return { rows: rows.map((r) => ({ ...r, note: r.note ?? null, plus: r.plus ?? 0 })), notes: "ok", plus: "ok" };
  } catch (error) {
    if (!missingColumn(error)) return unavailable(error);
  }
  try {
    const rows = await read(",note");
    return { rows: rows.map((r) => ({ ...r, note: r.note ?? null })), notes: "ok", plus: "unavailable" };
  } catch (error) {
    if (!missingColumn(error)) return unavailable(error);
  }
  return { rows: await listGuestRows(eventId), notes: "unavailable", plus: "unavailable" };
}

export type Match =
  | { kind: "none" }
  | { kind: "one"; guest: Guest; adoptPhone: boolean }
  | { kind: "many"; candidates: Guest[] };

/**
 * Which existing guest an `add` means (specs/commands/guests.md § add):
 * the phone first; then a same-name guest with no phone, who adopts it;
 * without a phone, a same-name guest. Never guesses between two.
 */
export function matchGuest(guests: Guest[], name: string, phone?: string): Match {
  const key = name.trim().toLowerCase();
  const sameName = guests.filter((g) => g.name.trim().toLowerCase() === key);

  if (phone) {
    const byPhone = guests.find((g) => g.phone === phone);
    if (byPhone) return { kind: "one", guest: byPhone, adoptPhone: false };
    const phoneless = sameName.filter((g) => g.phone === null);
    if (phoneless.length === 1) return { kind: "one", guest: phoneless[0]!, adoptPhone: true };
    if (phoneless.length > 1) return { kind: "many", candidates: phoneless };
    return { kind: "none" };
  }

  if (sameName.length === 1) return { kind: "one", guest: sameName[0]!, adoptPhone: false };
  if (sameName.length > 1) return { kind: "many", candidates: sameName };
  return { kind: "none" };
}

export function ambiguous(query: string, candidates: Guest[]): DetailedError {
  return new DetailedError(
    `"${query}" matches ${candidates.length} of your guests — re-run with an id`,
    "AMBIGUOUS_NAME",
    { candidates: candidates.map((g) => ({ name: g.name, id: g.id })) },
    ["Run `squadquest-axi guests` to see your guests and their ids"],
  );
}

/** A guest named by id or by exact (case-insensitive) name. */
export function findGuest(guests: Guest[], query: string): Guest {
  if (isUuid(query)) {
    const byId = guests.find((g) => g.id === query.toLowerCase());
    if (byId) return byId;
  } else {
    const key = query.trim().toLowerCase();
    const hits = guests.filter((g) => g.name.trim().toLowerCase() === key);
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) throw ambiguous(query, hits);
  }
  throw new DetailedError(`none of your guests matches "${query}"`, "NO_MATCH", {}, [
    "Run `squadquest-axi guests` to see your guests and their ids",
  ]);
}

export async function createGuest(name: string, phone: string | undefined): Promise<Guest> {
  const rows = await guarded(
    insert<Guest>(
      `guests?select=${GUEST_COLUMNS}`,
      { name, phone: phone ?? null },
      "adding the guest",
    ),
  );
  const row = rows[0];
  if (!row) {
    throw new AxiError("the guest was sent but could not be read back", "OUTCOME_UNKNOWN", [
      "Run `squadquest-axi guests` to see whether it was added before trying again",
    ]);
  }
  return row;
}

export async function setGuestPhone(id: string, phone: string): Promise<Guest | undefined> {
  const rows = await guarded(
    patch<Guest>(`guests`, `id=eq.${id}&select=${GUEST_COLUMNS}`, { phone }, "saving the phone"),
  );
  return rows[0];
}

/** Attach to events; returns the rows read back afterwards. */
export async function attach(guestId: string, eventIds: string[]): Promise<GuestRow[]> {
  if (eventIds.length > 0) {
    await guarded(
      insert<GuestRow>(
        "instance_guests",
        eventIds.map((instance) => ({ instance, guest: guestId })),
        "adding the guest to events",
      ),
    );
  }
  return rowsForGuest(guestId);
}

export async function rowsForGuest(guestId: string): Promise<GuestRow[]> {
  return guarded(
    select<GuestRow>(`instance_guests?select=instance,guest,status&guest=eq.${guestId}`, "reading back"),
  );
}

export async function detach(guestId: string, eventIds: string[]): Promise<void> {
  await guarded(
    remove(
      "instance_guests",
      `guest=eq.${guestId}&instance=in.(${eventIds.join(",")})`,
      "removing the guest from events",
    ),
  );
}

export async function deleteGuest(guestId: string): Promise<void> {
  await guarded(remove("guests", `id=eq.${guestId}`, "deleting the guest"));
}

export async function guestExists(guestId: string): Promise<boolean> {
  const rows = await guarded(select<{ id: string }>(`guests?select=id&id=eq.${guestId}`, "reading back"));
  return rows.length > 0;
}

// Links ──────────────────────────────────────────────────────────────

/** Validate the static page's address before it is used to build links. */
export function parseBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AxiError(`"${raw}" is not a URL`, "USAGE", ["Pass the page's full address, e.g. --base-url https://example.com/party/"]);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AxiError(`--base-url must be http or https`, "USAGE", ["Pass the page's full address, e.g. --base-url https://example.com/party/"]);
  }
  if (url.searchParams.has("t") || url.searchParams.has("o")) {
    throw new AxiError(`--base-url must not already carry a t= or o= parameter`, "USAGE", [
      "Pass the page's address without a token",
    ]);
  }
  if (url.hash) {
    throw new AxiError(`--base-url must not have a #fragment`, "USAGE", ["Pass the page's address without a #fragment"]);
  }
  return url;
}

export function buildLink(base: URL, param: "t" | "o", token: string): string {
  const url = new URL(base.toString());
  url.searchParams.set(param, token);
  return url.toString();
}

// Open links ─────────────────────────────────────────────────────────

export async function openLinkFor(eventId: string): Promise<OpenLink | undefined> {
  const rows = await guarded(
    select<OpenLink>(
      `instance_open_links?select=${OPEN_COLUMNS}&instance=eq.${eventId}&closed_at=is.null`,
      "loading the open link",
    ),
  );
  return rows[0];
}

export async function createOpenLink(eventId: string): Promise<OpenLink> {
  const rows = await guarded(
    insert<OpenLink>(
      `instance_open_links?select=${OPEN_COLUMNS}`,
      { instance: eventId },
      "creating the open link",
    ),
  );
  const row = rows[0] ?? (await openLinkFor(eventId));
  if (!row) {
    throw new AxiError("the open link was sent but could not be read back", "OUTCOME_UNKNOWN", [
      `Run \`squadquest-axi guests open-link --event ${eventId} --base-url <url>\` to check before trying again`,
    ]);
  }
  return row;
}

export async function closeOpenLink(eventId: string): Promise<void> {
  await guarded(
    patch(
      "instance_open_links",
      `instance=eq.${eventId}&closed_at=is.null`,
      { closed_at: new Date().toISOString() },
      "closing the open link",
    ),
  );
}
