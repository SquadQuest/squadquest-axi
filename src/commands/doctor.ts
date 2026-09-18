import { DOCTOR_FLAGS, parseFlags } from "../flags.js";
import { baseUrl, resolveCredential, sessionPermissions } from "../config.js";
import { reachable, select } from "../squadquest/client.js";
import { resolveAnonKey } from "../squadquest/keys.js";
import { hookSummary } from "../hooks.js";
import { joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";
import { field } from "../output/index.js";
import { expiresIn } from "./auth.js";

type Status = "ok" | "fail" | "skipped";

interface Check {
  check: string;
  status: Status;
  detail: string;
}

/**
 * `doctor` is what every unexpected error points at, so it must never itself
 * require a valid session — checks that can't proceed report `skipped` with a
 * reason (specs/commands/auth.md).
 */
export async function doctorCommand(args: string[]): Promise<string> {
  parseFlags("doctor", args, DOCTOR_FLAGS);

  const checks: Check[] = [];
  const suggestions: string[] = [];

  // 1. credentials ──────────────────────────────────────────────────
  const credential = resolveCredential();
  if (credential) {
    checks.push({
      check: "credentials",
      status: "ok",
      detail: credential.source === "env" ? "SQUADQUEST_AXI_TOKEN" : "stored session",
    });
  } else {
    checks.push({ check: "credentials", status: "fail", detail: "not signed in" });
    suggestions.push("Run `squadquest-axi auth login --phone <number>` to sign in");
  }

  // 2. permissions ──────────────────────────────────────────────────
  const permissions = sessionPermissions();
  if (!permissions) {
    checks.push({ check: "permissions", status: "skipped", detail: "no session file" });
  } else if (permissions.ok) {
    checks.push({ check: "permissions", status: "ok", detail: "session.json is 0600" });
  } else {
    checks.push({
      check: "permissions",
      status: "fail",
      detail: `session.json is ${permissions.mode}, expected 600`,
    });
    suggestions.push(`Run \`chmod 600 ${permissions.path}\` to protect your session token`);
  }

  // 3. connectivity ─────────────────────────────────────────────────
  const up = await reachable();
  checks.push({
    check: "connectivity",
    status: up ? "ok" : "fail",
    detail: up ? baseUrl() : `cannot reach ${baseUrl()}`,
  });
  if (!up) suggestions.push("Check your network connection or SQUADQUEST_AXI_URL");

  // 4. api key ──────────────────────────────────────────────────────
  // The single most confusing failure this backend produces, so it gets its
  // own check rather than hiding inside a request error.
  if (!up) {
    checks.push({ check: "api key", status: "skipped", detail: "instance unreachable" });
  } else {
    try {
      const { choice } = await resolveAnonKey(async (candidate) => {
        const response = await fetch(`${baseUrl()}/rest/v1/app_versions?select=*&limit=1`, {
          headers: { apikey: candidate, Authorization: `Bearer ${candidate}` },
        });
        return response.ok;
      });
      checks.push({
        check: "api key",
        status: "ok",
        detail:
          choice === "legacy"
            ? "current key rejected; using the legacy key (expected for this instance)"
            : choice === "current"
              ? "current key accepted"
              : choice === "env"
                ? "supplied via SQUADQUEST_AXI_ANON_KEY"
                : "using the cached key",
      });
    } catch (error) {
      checks.push({
        check: "api key",
        status: "fail",
        detail: error instanceof Error ? error.message : "could not resolve an API key",
      });
    }
  }

  // 5. token ────────────────────────────────────────────────────────
  if (!credential || !up) {
    checks.push({
      check: "token",
      status: "skipped",
      detail: credential ? "instance unreachable" : "not signed in",
    });
  } else {
    try {
      await select("profiles?select=id&limit=1", "checking your session");
      checks.push({
        check: "token",
        status: "ok",
        detail: credential.session
          ? `authenticated, expires ${expiresIn(credential.session.expires_at)}`
          : "authenticated",
      });
    } catch (error) {
      checks.push({
        check: "token",
        status: "fail",
        detail: error instanceof Error ? error.message : "authenticated read failed",
      });
      suggestions.push("Run `squadquest-axi auth login --phone <number>` to sign in again");
    }
  }

  // 6. hook ─────────────────────────────────────────────────────────
  const hook = hookSummary();
  checks.push({
    check: "hook",
    status: hook === "not installed" ? "fail" : "ok",
    detail: hook,
  });
  if (hook === "not installed") {
    suggestions.push("Run `squadquest-axi setup` to see your events at the start of every session");
  }

  const healthy = checks.every((c) => c.status !== "fail");

  return joinBlocks(
    renderObject({ healthy }),
    renderList("checks", checks as unknown as Array<Record<string, unknown>>, [
      field("check"),
      field("status"),
      field("detail"),
    ]),
    renderHelp(suggestions),
  );
}
