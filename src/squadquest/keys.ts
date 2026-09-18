import { AxiError } from "axi-sdk-js";
import { readConfig, writeConfig } from "../config.js";

/**
 * Anon-key resolution — the backend's sharpest edge, absorbed here so nothing
 * else has to know about it (specs/api/conventions.md).
 *
 * The instance publishes two anon keys and **only the legacy one is accepted**;
 * the current key 401s on every request. The Flutter client probes and falls
 * back, and so do we — hardcoding the legacy key would turn the instance's
 * eventual migration into an outage, which is the whole reason the app probes
 * rather than pinning.
 *
 * The keys are public client keys (they ship in the web app's published
 * assets), but per specs/principles.md they are never committed to this repo.
 */

export interface AnonKeys {
  current?: string;
  legacy?: string;
}

/**
 * Where the published web app exposes its build-time env. Flutter web serves
 * declared assets under `/assets/<path>`, and the dotenv asset is registered
 * as `.env` — so this is `/assets/.env`, not the doubled `/assets/assets/.env`
 * that Flutter uses for assets declared under an `assets/` directory.
 */
const DEFAULT_APP_ENV_URL = "https://squadquest.app/assets/.env";

function parseEnv(text: string): AnonKeys {
  const keys: AnonKeys = {};
  for (const line of text.split("\n")) {
    const [rawName, ...rest] = line.split("=");
    if (!rawName || rest.length === 0) continue;
    const name = rawName.trim();
    const value = rest.join("=").trim();
    if (name === "SUPABASE_ANON_KEY") keys.current = value;
    if (name === "SUPABASE_ANON_KEY_LEGACY") keys.legacy = value;
  }
  return keys;
}

async function fetchPublishedKeys(): Promise<AnonKeys> {
  const url = process.env.SQUADQUEST_AXI_APP_ENV_URL ?? DEFAULT_APP_ENV_URL;
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new AxiError("could not reach SquadQuest to discover its API key", "KEY_UNREACHABLE", [
      "Check your network connection, then run `squadquest-axi doctor`",
      "Set SQUADQUEST_AXI_ANON_KEY to supply the key directly",
    ]);
  }
  if (!response.ok) {
    throw new AxiError("SquadQuest did not publish a usable API key", "KEY_UNAVAILABLE", [
      "Set SQUADQUEST_AXI_ANON_KEY to supply the key directly",
      "Run `squadquest-axi doctor` for details",
    ]);
  }
  return parseEnv(await response.text());
}

/** How the working key was arrived at — reported by `doctor`. */
export type KeyChoice = "env" | "cached" | "current" | "legacy";

export interface ResolvedKey {
  key: string;
  choice: KeyChoice;
}

let memo: ResolvedKey | undefined;

/**
 * Resolve the anon key this process will use, probing the current key and
 * falling back to the legacy one. Memoized for the process lifetime — the
 * probe costs a round trip and the answer cannot change mid-invocation.
 *
 * `probe` is injected so tests can exercise both branches without a network.
 */
export async function resolveAnonKey(
  probe: (key: string) => Promise<boolean>,
  options: { refresh?: boolean } = {},
): Promise<ResolvedKey> {
  if (memo && !options.refresh) return memo;

  const override = process.env.SQUADQUEST_AXI_ANON_KEY;
  if (override) {
    memo = { key: override, choice: "env" };
    return memo;
  }

  const config = readConfig();
  if (config.anon_key && !options.refresh) {
    memo = { key: config.anon_key, choice: "cached" };
    return memo;
  }

  const keys = await fetchPublishedKeys();

  // Probe in the order the app does: prefer the current key, so the day the
  // instance fixes it we start using it with no code change.
  for (const [choice, key] of [
    ["current", keys.current],
    ["legacy", keys.legacy],
  ] as const) {
    if (!key) continue;
    if (await probe(key)) {
      writeConfig({ ...config, anon_key: key });
      memo = { key, choice };
      return memo;
    }
  }

  throw new AxiError("no working API key for this SquadQuest instance", "KEY_REJECTED", [
    "Run `squadquest-axi doctor` for the full check",
    "Set SQUADQUEST_AXI_ANON_KEY if you have a key to supply directly",
  ]);
}

/** Test seam — drops the process-lifetime memo. */
export function resetAnonKeyCache(): void {
  memo = undefined;
}
