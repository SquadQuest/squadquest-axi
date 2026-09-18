import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { formatError } from "../src/cli.js";
import { parseFlags, str, bool } from "../src/flags.js";
import { DetailedError } from "../src/errors.js";
import {
  clearSession,
  configDir,
  readSession,
  sessionPermissions,
  writeSession,
  resolveCredential,
} from "../src/config.js";

const scratch: string[] = [];

function isolatedConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "sq-axi-test-"));
  scratch.push(dir);
  process.env.SQUADQUEST_AXI_CONFIG_DIR = dir;
  return dir;
}

afterEach(() => {
  delete process.env.SQUADQUEST_AXI_CONFIG_DIR;
  delete process.env.SQUADQUEST_AXI_TOKEN;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("formatError", () => {
  it("maps usage-class codes to exit 2", () => {
    for (const code of ["USAGE", "UNKNOWN_FLAG", "AMBIGUOUS_NAME", "NO_MATCH", "NO_SESSION"]) {
      const { exitCode } = formatError(new AxiError("nope", code));
      expect(exitCode, code).toBe(2);
    }
  });

  it("maps operation failures to exit 1", () => {
    const { exitCode } = formatError(new AxiError("nope", "EVENT_NOT_FOUND"));
    expect(exitCode).toBe(1);
  });

  it("wraps a raw throw as INTERNAL_ERROR without leaking a stack trace", () => {
    const { output, exitCode } = formatError(new TypeError("cannot read x of undefined"));
    expect(exitCode).toBe(1);
    expect(output).toContain("INTERNAL_ERROR");
    expect(output).toContain("squadquest-axi doctor");
    expect(output).not.toContain("at ");
  });

  it("renders help as a multi-line block, not an inline array", () => {
    const { output } = formatError(new AxiError("nope", "USAGE", ["first", "second"]));
    expect(output).toContain("help[2]:\n  first\n  second");
  });

  it("merges DetailedError details into the rendered error", () => {
    const { output } = formatError(
      new DetailedError("ambiguous", "AMBIGUOUS_NAME", {
        candidates: [{ name: "Ada L.", id: "1" }],
      }),
    );
    expect(output).toContain("AMBIGUOUS_NAME");
    expect(output).toContain("Ada L.");
  });
});

describe("parseFlags", () => {
  const spec = { value: ["--limit"], boolean: ["--past"] };

  it("parses value and boolean flags, and positionals", () => {
    const parsed = parseFlags("events list", ["abc", "--limit", "5", "--past"], spec);
    expect(parsed.positional).toEqual(["abc"]);
    expect(str(parsed, "--limit")).toBe("5");
    expect(bool(parsed, "--past")).toBe(true);
  });

  it("accepts --flag=value form", () => {
    expect(str(parseFlags("events list", ["--limit=7"], spec), "--limit")).toBe("7");
  });

  it("rejects an unknown flag and lists the valid ones inline", () => {
    try {
      parseFlags("events list", ["--nope"], spec);
      expect.unreachable("should have thrown");
    } catch (error) {
      const axi = error as AxiError;
      expect(axi.code).toBe("UNKNOWN_FLAG");
      expect(axi.message).toContain("--nope");
      // AXI §6: fold the --help lookup into the error so correction is one turn.
      expect(axi.suggestions.join(" ")).toContain("--limit");
      expect(formatError(axi).exitCode).toBe(2);
    }
  });

  it("rejects a value flag with no value", () => {
    expect(() => parseFlags("events list", ["--limit"], spec)).toThrow(/requires a value/);
  });

  it("rejects a value given to a switch", () => {
    expect(() => parseFlags("events list", ["--past=1"], spec)).toThrow(/takes no value/);
  });

  it("always allows --timezone and --help without per-command declaration", () => {
    const parsed = parseFlags("events list", ["--timezone", "America/New_York"], spec);
    expect(str(parsed, "--timezone")).toBe("America/New_York");
    expect(() => parseFlags("events list", ["--help"], spec)).not.toThrow();
  });
});

describe("config store", () => {
  it("creates the config dir 0700 and the session file 0600", () => {
    const dir = isolatedConfig();
    writeSession({ access_token: "t", refresh_token: "r", expires_at: 1 });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(sessionPermissions()?.ok).toBe(true);
    expect(sessionPermissions()?.mode).toBe("600");
  });

  it("re-tightens a session file that was loosened", () => {
    const dir = isolatedConfig();
    writeSession({ access_token: "t", refresh_token: "r", expires_at: 1 });
    chmodSync(join(dir, "session.json"), 0o644);
    expect(sessionPermissions()?.ok).toBe(false);
    // A rewrite must not inherit the loosened mode.
    writeSession({ access_token: "t2", refresh_token: "r", expires_at: 1 });
    expect(sessionPermissions()?.ok).toBe(true);
  });

  it("round-trips a session and clears idempotently", () => {
    isolatedConfig();
    writeSession({ access_token: "tok", refresh_token: "ref", expires_at: 99 });
    expect(readSession()?.access_token).toBe("tok");
    expect(clearSession()).toBe(true);
    expect(clearSession()).toBe(false);
    expect(readSession()).toBeUndefined();
  });

  it("reports a corrupt session rather than silently signing the user out", () => {
    const dir = isolatedConfig();
    writeFileSync(join(dir, "session.json"), "{not json");
    expect(() => readSession()).toThrow(/unreadable/);
  });

  it("prefers the env token over a stored session", () => {
    isolatedConfig();
    writeSession({ access_token: "stored", refresh_token: "r", expires_at: 1 });
    expect(resolveCredential()?.source).toBe("stored");
    process.env.SQUADQUEST_AXI_TOKEN = "fromenv";
    expect(resolveCredential()?.source).toBe("env");
    expect(resolveCredential()?.token).toBe("fromenv");
  });

  it("returns undefined when nothing is stored, rather than throwing", () => {
    isolatedConfig();
    expect(resolveCredential()).toBeUndefined();
    expect(configDir()).toContain("sq-axi-test-");
  });
});
