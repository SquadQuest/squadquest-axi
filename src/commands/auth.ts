import { AxiError } from "axi-sdk-js";
import { AUTH_FLAGS, parseSubcommand, str } from "../flags.js";
import {
  clearSession,
  readConfig,
  resolveCredential,
  sessionPermissions,
  writeConfig,
  writeSession,
} from "../config.js";
import {
  displayPhone,
  fetchSelf,
  normalizePhone,
  requestCode,
  shortName,
  verifyCode,
} from "../squadquest/auth.js";
import { hookSummary } from "../hooks.js";
import { joinBlocks, renderHelp, renderObject } from "../output/index.js";

export async function authCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("auth", args, AUTH_FLAGS, "status");

  switch (sub) {
    case "login":
      return login(str(parsed, "--phone"));
    case "verify":
      return verify(parsed.positional[0]);
    case "logout":
      return logout();
    default:
      return status();
  }
}

async function login(rawPhone: string | undefined): Promise<string> {
  if (!rawPhone) {
    throw new AxiError("--phone is required", "USAGE", [
      "Run `squadquest-axi auth login --phone +12155550123`",
    ]);
  }

  // Normalize before the call so a mistyped number is visible before the
  // caller goes hunting for a text that will never arrive.
  const phone = normalizePhone(rawPhone);
  await requestCode(phone);

  writeConfig({ ...readConfig(), pending_phone: phone });

  return joinBlocks(
    renderObject({ otp: `code sent to ${displayPhone(phone)}` }),
    renderHelp([
      "Run `squadquest-axi auth verify <code>` with the code from your text messages",
    ]),
  );
}

async function verify(code: string | undefined): Promise<string> {
  if (!code) {
    throw new AxiError("a code is required", "USAGE", [
      "Run `squadquest-axi auth verify 123456`",
    ]);
  }

  const config = readConfig();
  const phone = config.pending_phone;
  if (!phone) {
    throw new AxiError("no sign-in is in progress", "USAGE", [
      "Run `squadquest-axi auth login --phone <number>` to request a code first",
    ]);
  }

  const session = await verifyCode(phone, code);

  // Store the session before fetching the profile: the session is the thing
  // worth keeping, and a profile read failure shouldn't cost a good login.
  const stored = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  };
  writeSession(stored);

  const self = await fetchSelf(session.user_id, session.phone);
  writeSession({ ...stored, self });

  writeConfig({ ...config, pending_phone: undefined });

  return joinBlocks(
    renderObject({
      account: `${shortName(self)} (${displayPhone(self.phone)})`,
      session: `stored, expires ${expiresIn(session.expires_at)}`,
      hook: hookSummary(),
    }),
    renderHelp([
      "Run `squadquest-axi` to see what's coming up",
      "Run `squadquest-axi setup` to show upcoming events at the start of every session",
    ]),
  );
}

function status(): string {
  const credential = resolveCredential();
  if (!credential) {
    return joinBlocks(
      renderObject({ account: "not signed in" }),
      renderHelp(["Run `squadquest-axi auth login --phone <number>` to sign in"]),
    );
  }

  const self = credential.session?.self;
  const permissions = sessionPermissions();

  return renderObject({
    account: self ? `${shortName(self)} (${displayPhone(self.phone)})` : "signed in",
    source: credential.source === "env" ? "SQUADQUEST_AXI_TOKEN" : "stored session",
    ...(credential.session ? { expires: expiresIn(credential.session.expires_at) } : {}),
    ...(permissions && !permissions.ok
      ? { warning: `session file is mode ${permissions.mode}, expected 600` }
      : {}),
  });
}

function logout(): string {
  const removed = clearSession();
  const envStillSet = Boolean(process.env.SQUADQUEST_AXI_TOKEN);

  return joinBlocks(
    renderObject({
      // Forgotten locally, not revoked. Saying otherwise would be a security
      // claim this command cannot back.
      logout: removed
        ? "stored session removed (not revoked server-side)"
        : "no stored session (no-op)",
      ...(envStillSet
        ? { note: "SQUADQUEST_AXI_TOKEN is still set — commands stay authenticated" }
        : {}),
    }),
    renderHelp(
      envStillSet ? ["Unset SQUADQUEST_AXI_TOKEN to fully sign out of this shell"] : [],
    ),
  );
}

export function expiresIn(epochSeconds: number): string {
  const seconds = epochSeconds - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "expired";
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `in ${Math.max(1, Math.floor(seconds / 60))} min`;
}
