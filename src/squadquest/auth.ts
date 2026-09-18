import { AxiError } from "axi-sdk-js";
import { baseUrl, type SelfCache } from "../config.js";
import { resolveAnonKey } from "./keys.js";
import { select } from "./client.js";

/**
 * Phone + SMS one-time code (specs/api/auth.md). No password, no email, no
 * OAuth — which is why login is inherently two commands.
 */

/**
 * Normalize to E.164. Deliberately conservative: it handles the US/NANP
 * shapes people actually type and otherwise requires a leading `+`. Guessing
 * a country code for an ambiguous string would send a code to the wrong
 * country, so an unrecognized shape is an error the caller can see.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) {
    const rest = digits.slice(1);
    if (!/^\d{8,15}$/.test(rest)) {
      throw new AxiError(`"${input}" is not a valid phone number`, "USAGE", [
        "Pass an E.164 number, e.g. --phone +12155550123",
      ]);
    }
    return `+${rest}`;
  }

  const bare = digits.replace(/\D/g, "");
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith("1")) return `+${bare}`;

  throw new AxiError(`"${input}" is not a valid phone number`, "USAGE", [
    "Pass an E.164 number, e.g. --phone +12155550123",
    "US numbers may be given as 10 digits, e.g. --phone 2155550123",
  ]);
}

/** Render E.164 back in a form a human reads without counting digits. */
export function displayPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `+1 ${match[1]}-${match[2]}-${match[3]}` : e164;
}

async function key(): Promise<string> {
  const { key: resolved } = await resolveAnonKey(async (candidate) => {
    const response = await fetch(`${baseUrl()}/rest/v1/app_versions?select=*&limit=1`, {
      headers: { apikey: candidate, Authorization: `Bearer ${candidate}` },
    });
    return response.ok;
  });
  return resolved;
}

async function authPost(path: string, body: unknown, what: string): Promise<unknown> {
  const apikey = await key();
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: { apikey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AxiError("could not reach SquadQuest", "UNREACHABLE", [
      "Check your network connection, then run `squadquest-axi doctor`",
    ]);
  }

  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const message =
      (parsed.error_description as string) ??
      (parsed.msg as string) ??
      (parsed.message as string) ??
      `${what} failed`;
    throw new AxiError(message, "AUTH_FAILED", [
      "Run `squadquest-axi auth login --phone <number>` to request a fresh code",
    ]);
  }

  return parsed;
}

/** Request an SMS code. */
export async function requestCode(phone: string): Promise<void> {
  await authPost("/auth/v1/otp", { phone }, "sending a code");
}

export interface VerifiedSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
  phone: string;
}

/** Exchange the code for a session. */
export async function verifyCode(phone: string, code: string): Promise<VerifiedSession> {
  const body = (await authPost(
    "/auth/v1/verify",
    { phone, token: code, type: "sms" },
    "verifying the code",
  )) as {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    expires_in?: number;
    user?: { id?: string; phone?: string };
  };

  if (!body.access_token || !body.refresh_token || !body.user?.id) {
    throw new AxiError("SquadQuest did not return a usable session", "AUTH_FAILED", [
      "Run `squadquest-axi auth login --phone <number>` to request a fresh code",
    ]);
  }

  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at ?? Math.floor(Date.now() / 1000) + (body.expires_in ?? 3600),
    user_id: body.user.id,
    phone: body.user.phone ? `+${body.user.phone.replace(/^\+/, "")}` : phone,
  };
}

/** Bootstrap the self cache so the home view needs no discovery call. */
export async function fetchSelf(userId: string, phone: string): Promise<SelfCache> {
  const rows = await select<{ id: string; first_name?: string; last_name?: string }>(
    `profiles?select=id,first_name,last_name&id=eq.${userId}`,
    "loading your profile",
  );
  const profile = rows[0];
  return {
    id: userId,
    first_name: profile?.first_name ?? "",
    last_name: profile?.last_name ?? "",
    phone,
    cached_at: new Date().toISOString(),
  };
}

/** "Chris A." — a name that identifies without publishing a full identity. */
export function shortName(self: Pick<SelfCache, "first_name" | "last_name">): string {
  const last = self.last_name?.trim();
  const initial = last ? ` ${last[0]}.` : "";
  return `${self.first_name ?? ""}${initial}`.trim() || "(unnamed)";
}
