import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AxiError } from "axi-sdk-js";
import { authCommand } from "../src/commands/auth.js";
import { select } from "../src/squadquest/client.js";
import { readSession, sessionPermissions, writeSession } from "../src/config.js";
import { resetAnonKeyCache } from "../src/squadquest/keys.js";

/**
 * The OTP round trip and the refresh-retry path, exercised against a stubbed
 * `fetch`. These need no live SMS — only the transport is faked, so the
 * command logic, storage, and error translation are all real.
 */

const scratch: string[] = [];
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handler: Handler;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Requests seen by the stub, in order — lets a test assert call counts. */
let calls: string[] = [];

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "sq-axi-flow-"));
  scratch.push(dir);
  process.env.SQUADQUEST_AXI_CONFIG_DIR = dir;
  process.env.SQUADQUEST_AXI_ANON_KEY = "testkey";
  resetAnonKeyCache();
  calls = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return handler(url, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SQUADQUEST_AXI_CONFIG_DIR;
  delete process.env.SQUADQUEST_AXI_ANON_KEY;
  delete process.env.SQUADQUEST_AXI_TOKEN;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  resetAnonKeyCache();
});

const VERIFIED = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_at: Math.floor(Date.now() / 1000) + 604800,
  user: { id: "user-1", phone: "12155550123" },
};

describe("auth login", () => {
  it("normalizes to E.164, sends a code, and echoes the normalized number", async () => {
    handler = (url) => {
      if (url.includes("/auth/v1/otp")) return json({});
      throw new Error(`unexpected ${url}`);
    };

    const out = await authCommand(["login", "--phone", "(215) 555-0123"]);

    expect(out).toContain("+1 215-555-0123");
    expect(out).toContain("auth verify");
    const otp = calls.find((c) => c.includes("/auth/v1/otp"));
    expect(otp).toBeDefined();
  });

  it("makes no network call at all when the number is malformed", async () => {
    handler = () => {
      throw new Error("must not be called");
    };
    await expect(authCommand(["login", "--phone", "nope"])).rejects.toThrow(/not a valid/);
    expect(calls).toHaveLength(0);
  });
});

describe("auth verify", () => {
  it("stores the session 0600 and caches the self profile", async () => {
    handler = (url) => {
      if (url.includes("/auth/v1/otp")) return json({});
      if (url.includes("/auth/v1/verify")) return json(VERIFIED);
      if (url.includes("/rest/v1/profiles")) {
        return json([{ id: "user-1", first_name: "Ada", last_name: "Lovelace" }]);
      }
      throw new Error(`unexpected ${url}`);
    };

    await authCommand(["login", "--phone", "2155550123"]);
    const out = await authCommand(["verify", "123456"]);

    expect(out).toContain("Ada L.");
    expect(sessionPermissions()?.ok).toBe(true);
    const stored = readSession();
    expect(stored?.access_token).toBe("access-1");
    expect(stored?.self?.first_name).toBe("Ada");
    // The cached profile is what lets the home view skip a discovery call.
    expect(stored?.self?.id).toBe("user-1");
  });

  it("exits 2 with the request-a-fresh-code command on a bad code", async () => {
    handler = (url) => {
      if (url.includes("/auth/v1/otp")) return json({});
      if (url.includes("/auth/v1/verify")) {
        return json({ error_description: "Token has expired or is invalid" }, 403);
      }
      throw new Error(`unexpected ${url}`);
    };

    await authCommand(["login", "--phone", "2155550123"]);
    try {
      await authCommand(["verify", "000000"]);
      expect.unreachable("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("AUTH_FAILED");
      expect(axi.suggestions.join(" ")).toContain("auth login");
    }
  });

  it("refuses to verify when no sign-in is in progress", async () => {
    handler = () => {
      throw new Error("must not be called");
    };
    await expect(authCommand(["verify", "123456"])).rejects.toThrow(/no sign-in is in progress/);
    expect(calls).toHaveLength(0);
  });
});

describe("refresh on 401", () => {
  it("refreshes once, retries once, and persists the new token", async () => {
    writeSession({ access_token: "stale", refresh_token: "refresh-1", expires_at: 1 });

    let reads = 0;
    handler = (url, init) => {
      if (url.includes("grant_type=refresh_token")) {
        return json({ access_token: "fresh", refresh_token: "refresh-2", expires_at: 999 });
      }
      if (url.includes("/rest/v1/profiles")) {
        reads++;
        const auth = (init?.headers as Record<string, string>)?.Authorization;
        return auth === "Bearer fresh" ? json([{ id: "user-1" }]) : json({ message: "JWT expired" }, 401);
      }
      throw new Error(`unexpected ${url}`);
    };

    const rows = await select<{ id: string }>("profiles?select=id", "reading");

    expect(rows).toEqual([{ id: "user-1" }]);
    expect(reads).toBe(2); // one 401, one successful retry
    expect(calls.filter((c) => c.includes("grant_type=refresh_token"))).toHaveLength(1);
    expect(readSession()?.access_token).toBe("fresh");
    expect(readSession()?.refresh_token).toBe("refresh-2");
  });

  it("surfaces 'session expired' rather than a token error when refresh fails", async () => {
    writeSession({ access_token: "stale", refresh_token: "dead", expires_at: 1 });

    handler = (url) => {
      if (url.includes("grant_type=refresh_token")) return json({ error: "invalid_grant" }, 400);
      if (url.includes("/rest/v1/profiles")) return json({ message: "JWT expired" }, 401);
      throw new Error(`unexpected ${url}`);
    };

    try {
      await select("profiles?select=id", "reading");
      expect.unreachable("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("SESSION_EXPIRED");
      expect(axi.message).toContain("sign in again");
      expect(axi.message).not.toContain("JWT");
      expect(axi.suggestions.join(" ")).toContain("auth login");
    }
  });

  it("does not recurse when the retry itself 401s", async () => {
    writeSession({ access_token: "stale", refresh_token: "refresh-1", expires_at: 1 });

    handler = (url) => {
      if (url.includes("grant_type=refresh_token")) {
        return json({ access_token: "fresh", refresh_token: "refresh-1", expires_at: 999 });
      }
      return json({ message: "still unauthorized" }, 401);
    };

    await expect(select("profiles?select=id", "reading")).rejects.toThrow(/sign in again/);
    // Exactly one refresh: the retry must not re-enter the refresh path.
    expect(calls.filter((c) => c.includes("grant_type=refresh_token"))).toHaveLength(1);
  });
});
