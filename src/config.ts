import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";

export const CONFIG_VERSION = 1;

/**
 * Identity cached at `auth verify` time so the home view — which runs on every
 * session via the SessionStart hook — needs zero discovery calls.
 * See specs/behaviors/identity-and-session.md.
 */
export interface SelfCache {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  cached_at: string;
}

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  /** Epoch seconds. */
  expires_at: number;
  self?: SelfCache;
}

export interface UserConfig {
  version: number;
  /** Backend base URL override; production when absent. */
  url?: string;
  /** Phone awaiting an OTP code, held between `auth login` and `auth verify`. */
  pending_phone?: string;
  /** The anon key that last worked against this instance — see squadquest/keys.ts. */
  anon_key?: string;
}

/** Where a live credential came from — surfaced by `doctor` and `auth status`. */
export type CredentialSource = "env" | "stored";

// Paths ─────────────────────────────────────────────────────────────

export function configDir(): string {
  if (process.env.SQUADQUEST_AXI_CONFIG_DIR) return process.env.SQUADQUEST_AXI_CONFIG_DIR;
  return join(homedir(), ".config", "squadquest-axi");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

function sessionPath(): string {
  return join(configDir(), "session.json");
}

function ensureDir(): string {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// Config ────────────────────────────────────────────────────────────

export function readConfig(): UserConfig {
  const path = configPath();
  if (!existsSync(path)) return { version: CONFIG_VERSION };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as UserConfig;
  } catch {
    // A corrupt config must not brick every command — the session file is the
    // one that actually matters, and it is read separately.
    return { version: CONFIG_VERSION };
  }
}

export function writeConfig(config: UserConfig): void {
  ensureDir();
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
}

// Session ───────────────────────────────────────────────────────────

export function readSession(): StoredSession | undefined {
  const path = sessionPath();
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StoredSession;
  } catch {
    throw new AxiError("stored session is unreadable", "SESSION_CORRUPT", [
      "Run `squadquest-axi auth logout` then sign in again",
    ]);
  }
}

export function writeSession(session: StoredSession): void {
  ensureDir();
  const path = sessionPath();
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync's mode only applies on create, so an existing file keeps
  // whatever permissions it had. Enforce every time.
  chmodSync(path, 0o600);
}

export function clearSession(): boolean {
  const path = sessionPath();
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/**
 * Permission check surfaced by `doctor`. A world-readable session token is a
 * real finding, not a style note — see specs/commands/auth.md.
 */
export function sessionPermissions(): { path: string; mode: string; ok: boolean } | undefined {
  const path = sessionPath();
  if (!existsSync(path)) return undefined;
  const mode = statSync(path).mode & 0o777;
  return { path, mode: mode.toString(8).padStart(3, "0"), ok: mode === 0o600 };
}

// Resolution ────────────────────────────────────────────────────────

export interface ActiveCredential {
  token: string;
  source: CredentialSource;
  session?: StoredSession;
}

/**
 * Resolution order per specs/behaviors/identity-and-session.md: the env
 * override always wins, then the stored session. Returns undefined rather
 * than throwing so `home` and `doctor` can render an unauthenticated view.
 */
export function resolveCredential(): ActiveCredential | undefined {
  const envToken = process.env.SQUADQUEST_AXI_TOKEN;
  if (envToken) return { token: envToken, source: "env" };

  const session = readSession();
  if (session) return { token: session.access_token, source: "stored", session };

  return undefined;
}

/** For commands that cannot proceed without a session. */
export function requireCredential(): ActiveCredential {
  const credential = resolveCredential();
  if (!credential) {
    throw new AxiError("not signed in", "NO_SESSION", [
      "Run `squadquest-axi auth login --phone <number>` to sign in",
    ]);
  }
  return credential;
}

export function baseUrl(): string {
  return (
    process.env.SQUADQUEST_AXI_URL ?? readConfig().url ?? "https://supabase.squadquest.app"
  );
}
