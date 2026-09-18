import { AxiError } from "axi-sdk-js";
import { baseUrl, readSession, resolveCredential, writeSession } from "../config.js";
import { resolveAnonKey } from "./keys.js";

/**
 * The only module that knows the backend is Supabase
 * (specs/architecture.md). Commands deal in domain objects; when v2 lands on
 * a different backend, a second adapter slots in behind this interface.
 */

export interface RequestOptions {
  /** Skip auth entirely — for the unauthenticated scrape-event function. */
  anonymous?: boolean;
  /** Ask PostgREST to return the affected rows. */
  representation?: boolean;
}

async function anonKey(): Promise<string> {
  const { key } = await resolveAnonKey(async (candidate) => {
    const response = await fetch(`${baseUrl()}/rest/v1/app_versions?select=*&limit=1`, {
      headers: { apikey: candidate, Authorization: `Bearer ${candidate}` },
    });
    return response.ok;
  });
  return key;
}

function token(): string | undefined {
  return resolveCredential()?.token;
}

/**
 * Exchange the refresh token for a new session. Returns the new access token,
 * or undefined when refresh isn't possible (no stored session, or an env
 * token we don't own the refresh side of).
 */
async function refreshSession(key: string): Promise<string | undefined> {
  const session = readSession();
  if (!session?.refresh_token) return undefined;

  const response = await fetch(`${baseUrl()}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!response.ok) return undefined;

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
  if (!body.access_token) return undefined;

  writeSession({
    ...session,
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? session.refresh_token,
    expires_at: body.expires_at ?? session.expires_at,
  });
  return body.access_token;
}

interface RawError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  error?: { message?: string; code?: string } | string;
  error_description?: string;
  msg?: string;
}

/**
 * Translate a backend failure into something an agent can act on. Per AXI §6
 * the suggestion never names Supabase or PostgREST — it references our own
 * commands.
 */
function translate(status: number, body: RawError | undefined, what: string): AxiError {
  const nested = typeof body?.error === "object" ? body.error : undefined;
  const code = nested?.code ?? body?.code;
  const message =
    nested?.message ??
    body?.message ??
    body?.error_description ??
    body?.msg ??
    (typeof body?.error === "string" ? body.error : undefined) ??
    `request failed with status ${status}`;

  if (code === "event-not-found" || status === 404) {
    return new AxiError(`no event found for that id`, "EVENT_NOT_FOUND", [
      "Run `squadquest-axi events` to list the events you can see",
    ]);
  }
  if (status === 403) {
    return new AxiError(message, "FORBIDDEN", [
      "Run `squadquest-axi auth status` to check who you are signed in as",
    ]);
  }
  if (status === 401) {
    return new AxiError("session expired — sign in again", "SESSION_EXPIRED", [
      "Run `squadquest-axi auth login --phone <number>` to sign in",
    ]);
  }
  return new AxiError(`${what}: ${message}`, code ?? "REQUEST_FAILED", [
    "Run `squadquest-axi doctor` to check credentials and connectivity",
  ]);
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}

/**
 * One request, with a single refresh-and-retry on 401
 * (specs/behaviors/identity-and-session.md). `retrying` guards against
 * recursion: a 401 from the refresh path itself must not re-enter.
 */
async function request(
  path: string,
  init: RequestInit,
  what: string,
  options: RequestOptions,
  retrying = false,
): Promise<unknown> {
  const key = await anonKey();
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };

  if (!options.anonymous) {
    const bearer = token();
    if (!bearer) {
      throw new AxiError("not signed in", "NO_SESSION", [
        "Run `squadquest-axi auth login --phone <number>` to sign in",
      ]);
    }
    headers.Authorization = `Bearer ${bearer}`;
  } else {
    headers.Authorization = `Bearer ${key}`;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  } catch {
    throw new AxiError("could not reach SquadQuest", "UNREACHABLE", [
      "Check your network connection, then run `squadquest-axi doctor`",
    ]);
  }

  if (response.status === 401 && !options.anonymous && !retrying) {
    const refreshed = await refreshSession(key);
    if (refreshed) return request(path, init, what, options, true);
  }

  if (!response.ok) {
    throw translate(response.status, (await parseBody(response)) as RawError, what);
  }

  return parseBody(response);
}

// PostgREST ─────────────────────────────────────────────────────────

export async function select<T>(query: string, what: string): Promise<T[]> {
  return ((await request(`/rest/v1/${query}`, { method: "GET" }, what, {})) ?? []) as T[];
}

export async function insert<T>(
  table: string,
  body: unknown,
  what: string,
): Promise<T[]> {
  return ((await request(
    `/rest/v1/${table}`,
    { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation" } },
    what,
    {},
  )) ?? []) as T[];
}

export async function patch<T>(
  table: string,
  filter: string,
  body: unknown,
  what: string,
): Promise<T[]> {
  return ((await request(
    `/rest/v1/${table}?${filter}`,
    { method: "PATCH", body: JSON.stringify(body), headers: { Prefer: "return=representation" } },
    what,
    {},
  )) ?? []) as T[];
}

// Edge functions ────────────────────────────────────────────────────

/**
 * Client-callable edge functions only. The `set-event-*` / `update-event-*`
 * functions are database webhooks and must never be called from here
 * (specs/api/conventions.md).
 */
export async function callFunction<T>(
  name: string,
  body: unknown,
  what: string,
  options: RequestOptions = {},
): Promise<T> {
  return (await request(
    `/functions/v1/${name}`,
    { method: "POST", body: JSON.stringify(body) },
    what,
    options,
  )) as T;
}

export async function getFunction<T>(
  name: string,
  query: string,
  what: string,
  options: RequestOptions = {},
): Promise<T> {
  return (await request(
    `/functions/v1/${name}?${query}`,
    { method: "GET" },
    what,
    options,
  )) as T;
}

/** Unauthenticated connectivity probe used by `doctor`. */
export async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl()}/rest/v1/`, { method: "HEAD" });
    return response.status < 500;
  } catch {
    return false;
  }
}
