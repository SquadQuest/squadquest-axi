import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { displayPhone, normalizePhone, shortName } from "../src/squadquest/auth.js";
import { resolveAnonKey, resetAnonKeyCache } from "../src/squadquest/keys.js";
import { readConfig } from "../src/config.js";
import { expiresIn } from "../src/commands/auth.js";

const scratch: string[] = [];

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "sq-axi-auth-"));
  scratch.push(dir);
  process.env.SQUADQUEST_AXI_CONFIG_DIR = dir;
  resetAnonKeyCache();
});

afterEach(() => {
  delete process.env.SQUADQUEST_AXI_CONFIG_DIR;
  delete process.env.SQUADQUEST_AXI_ANON_KEY;
  delete process.env.SQUADQUEST_AXI_APP_ENV_URL;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  resetAnonKeyCache();
});

describe("normalizePhone", () => {
  it("accepts E.164 unchanged", () => {
    expect(normalizePhone("+12155550123")).toBe("+12155550123");
  });

  it("accepts the shapes people actually type", () => {
    for (const input of ["2155550123", "(215) 555-0123", "215-555-0123", "12155550123"]) {
      expect(normalizePhone(input), input).toBe("+12155550123");
    }
  });

  it("refuses to guess a country code for an ambiguous number", () => {
    // Guessing would text the wrong country — an error the caller can see is
    // the cheaper failure (specs/api/auth.md).
    for (const input of ["555012", "abc", "+1", "12345678901234567"]) {
      expect(() => normalizePhone(input), input).toThrow(/not a valid phone number/);
    }
  });

  it("exits 2 rather than 1 on a bad number", () => {
    try {
      normalizePhone("nope");
      expect.unreachable();
    } catch (error) {
      expect((error as AxiError).code).toBe("USAGE");
    }
  });

  it("renders E.164 back in a readable form", () => {
    expect(displayPhone("+12155550123")).toBe("+1 215-555-0123");
    // Non-NANP numbers pass through rather than being mangled.
    expect(displayPhone("+442071838750")).toBe("+442071838750");
  });
});

describe("anon key resolution", () => {
  const envAsset = "SUPABASE_ANON_KEY=newkey\nSUPABASE_ANON_KEY_LEGACY=legacykey\n";

  function serveEnv(): void {
    process.env.SQUADQUEST_AXI_APP_ENV_URL = `data:text/plain,${encodeURIComponent(envAsset)}`;
  }

  it("prefers an explicit env override without probing", async () => {
    process.env.SQUADQUEST_AXI_ANON_KEY = "supplied";
    const resolved = await resolveAnonKey(async () => {
      throw new Error("must not probe when the key is supplied");
    });
    expect(resolved).toEqual({ key: "supplied", choice: "env" });
  });

  it("prefers the current key when the instance accepts it", async () => {
    serveEnv();
    const resolved = await resolveAnonKey(async (key) => key === "newkey");
    expect(resolved.choice).toBe("current");
    expect(resolved.key).toBe("newkey");
  });

  it("falls back to the legacy key when the current one is rejected", async () => {
    serveEnv();
    const tried: string[] = [];
    const resolved = await resolveAnonKey(async (key) => {
      tried.push(key);
      return key === "legacykey";
    });
    // The order matters: probing current-first is what lets a future instance
    // fix silently pick itself up (specs/api/conventions.md).
    expect(tried).toEqual(["newkey", "legacykey"]);
    expect(resolved.choice).toBe("legacy");
  });

  it("caches the working key so later runs skip the probe", async () => {
    serveEnv();
    await resolveAnonKey(async (key) => key === "legacykey");
    expect(readConfig().anon_key).toBe("legacykey");

    resetAnonKeyCache();
    const cached = await resolveAnonKey(async () => {
      throw new Error("must not probe when a cached key exists");
    });
    expect(cached.choice).toBe("cached");
  });

  it("re-probes when asked to refresh, so a rotated key is picked up", async () => {
    serveEnv();
    await resolveAnonKey(async (key) => key === "legacykey");
    resetAnonKeyCache();
    const refreshed = await resolveAnonKey(async (key) => key === "newkey", { refresh: true });
    expect(refreshed.choice).toBe("current");
  });

  it("fails with an actionable error when no key is accepted", async () => {
    serveEnv();
    await expect(resolveAnonKey(async () => false)).rejects.toThrow(/no working API key/);
  });

  it("memoizes within a process so one invocation probes once", async () => {
    serveEnv();
    let probes = 0;
    const probe = async (key: string) => {
      probes++;
      return key === "legacykey";
    };
    await resolveAnonKey(probe);
    await resolveAnonKey(probe);
    // Two candidates on the first call, nothing on the second.
    expect(probes).toBe(2);
  });
});

describe("presentation helpers", () => {
  it("shortens a name without publishing a full identity", () => {
    expect(shortName({ first_name: "Ada", last_name: "Lovelace" })).toBe("Ada L.");
    expect(shortName({ first_name: "Ada", last_name: "" })).toBe("Ada");
    expect(shortName({ first_name: "", last_name: "" })).toBe("(unnamed)");
  });

  it("describes expiry in human units", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(expiresIn(now - 10)).toBe("expired");
    expect(expiresIn(now + 60 * 30)).toMatch(/min$/);
    expect(expiresIn(now + 3600 * 5)).toBe("in 5 hours");
    expect(expiresIn(now + 86400 * 7)).toBe("in 7 days");
    expect(expiresIn(now + 86400)).toBe("in 1 day");
  });
});
