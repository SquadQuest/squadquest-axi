import { AxiError } from "axi-sdk-js";

export interface FlagSpec {
  /** Flags that take a value, e.g. `--limit 10`. */
  value?: string[];
  /** Flags that are standalone switches, e.g. `--available`. */
  boolean?: string[];
  /** Repeatable value flags — every occurrence accumulates into a `string[]`. */
  multi?: string[];
  /** Renamed or removed flags mapped to a targeted hint. */
  deprecated?: Record<string, string>;
}

export interface Parsed {
  positional: string[];
  flags: Record<string, string | true>;
  /** Values collected from `multi`-declared flags, in the order given. */
  multi: Record<string, string[]>;
}

/** `--help` is universal and never reported as unknown (AXI §6). */
const ALWAYS_ALLOWED = new Set(["--help", "-h"]);

/**
 * A negative number is a value, not a flag.
 *
 * Without this, `--rally-point -75.172,39.9012` is rejected as "requires a
 * value" — which breaks every longitude in the Western hemisphere, and every
 * latitude south of the equator.
 */
function isValueLike(arg: string | undefined): boolean {
  if (arg === undefined) return false;
  if (!arg.startsWith("-")) return true;
  return /^-[.\d]/.test(arg);
}

/**
 * Value flags accepted on every command without per-command declaration.
 * `--timezone` resolves wall-clock input and output
 * (specs/behaviors/time-and-place.md) and, like `--help`, is never reported
 * as unknown.
 */
const GLOBAL_VALUE_FLAGS = new Set(["--timezone"]);

/**
 * Parse argv for one command, rejecting anything not declared.
 *
 * A silently-dropped flag is worse than an error: the agent gets output it
 * believes is filtered and proceeds on wrong data. So an unrecognized flag
 * fails with exit code 2 and lists the valid flags inline, which collapses
 * the agent's correction from two turns into one.
 */
export function parseFlags(command: string, argv: string[], spec: FlagSpec): Parsed {
  const valueFlags = new Set(spec.value ?? []);
  const boolFlags = new Set(spec.boolean ?? []);
  const multiFlags = new Set(spec.multi ?? []);
  const deprecated = spec.deprecated ?? {};
  const known = [...valueFlags, ...boolFlags, ...multiFlags].sort();

  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const multi: Record<string, string[]> = {};

  const unknown = (name: string): never => {
    const hint = deprecated[name];
    throw new AxiError(
      `unknown flag ${name} for \`${command}\``,
      "UNKNOWN_FLAG",
      hint
        ? [hint]
        : [
            known.length > 0
              ? `valid flags for \`${command}\`: ${known.join(", ")} (--help and --timezone always allowed)`
              : `\`${command}\` takes no flags (--help and --timezone always allowed)`,
          ],
    );
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }

    if (ALWAYS_ALLOWED.has(arg)) {
      flags["--help"] = true;
      continue;
    }

    // Support both `--limit=10` and `--limit 10`.
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);

    if (boolFlags.has(name)) {
      if (inlineValue !== undefined) {
        throw new AxiError(`${name} is a switch and takes no value`, "USAGE", [
          `Run \`squadquest-axi ${command} ${name}\` without a value`,
        ]);
      }
      flags[name] = true;
      continue;
    }

    if (valueFlags.has(name) || GLOBAL_VALUE_FLAGS.has(name)) {
      if (inlineValue !== undefined) {
        flags[name] = inlineValue;
        continue;
      }
      const next = argv[i + 1];
      if (!isValueLike(next)) {
        throw new AxiError(`${name} requires a value`, "USAGE", [
          `Run \`squadquest-axi ${command} ${name} <value>\``,
        ]);
      }
      flags[name] = next!;
      i++;
      continue;
    }

    if (multiFlags.has(name)) {
      let value: string;
      if (inlineValue !== undefined) {
        value = inlineValue;
      } else {
        const next = argv[i + 1];
        if (!isValueLike(next)) {
          throw new AxiError(`${name} requires a value`, "USAGE", [
            `Run \`squadquest-axi ${command} ${name} <value>\``,
          ]);
        }
        value = next!;
        i++;
      }
      (multi[name] ??= []).push(value);
      continue;
    }

    unknown(name);
  }

  return { positional, flags, multi };
}

/** Read a value flag as a string, or fall back to a default. */
export function str(parsed: Parsed, name: string, fallback: string): string;
export function str(parsed: Parsed, name: string): string | undefined;
export function str(parsed: Parsed, name: string, fallback?: string): string | undefined {
  const raw = parsed.flags[name];
  return typeof raw === "string" ? raw : fallback;
}

/** True when a boolean (or value, if simply present) flag was supplied. */
export function bool(parsed: Parsed, name: string): boolean {
  return parsed.flags[name] !== undefined;
}

/** Read all values collected for a `multi`-declared flag (empty array if absent). */
export function multiStr(parsed: Parsed, name: string): string[] {
  return parsed.multi[name] ?? [];
}

/** Require the Nth positional argument, or fail with usage. */
export function requirePositional(parsed: Parsed, index: number, label: string, usage: string): string {
  const value = parsed.positional[index];
  if (value === undefined || value.length === 0) {
    throw new AxiError(`${label} is required`, "USAGE", [usage]);
  }
  return value;
}

/**
 * Resolve a command's subcommand (`auth login`, `rooms slots`, ...) and parse
 * the remaining argv against that subcommand's declared flag set. When the
 * first token is missing or looks like a flag, `defaultSub` (if given) is
 * used and the full argv is treated as the subcommand's own args — this is
 * what makes `squadquest-axi rooms` equivalent to `squadquest-axi rooms list`.
 */
export function parseSubcommand(
  command: string,
  args: string[],
  specs: Record<string, FlagSpec>,
  defaultSub?: string,
): { sub: string; parsed: Parsed } {
  const first = args[0];
  const usesDefault = first === undefined || first.startsWith("-");
  const sub = usesDefault ? defaultSub : first;

  if (sub === undefined || !(sub in specs)) {
    throw new AxiError(
      sub === undefined
        ? `\`${command}\` requires a subcommand`
        : `unknown ${command} subcommand "${sub}"`,
      "VALIDATION_ERROR",
      [`valid subcommands: ${Object.keys(specs).join(", ")}`],
    );
  }

  const rest = usesDefault ? args : args.slice(1);
  const parsed = parseFlags(`${command} ${sub}`, rest, specs[sub]!);
  return { sub, parsed };
}

// ── Declared per-command flag sets ──────────────────────────────────
// One entry per command/subcommand pair. Keeping them all here (rather than
// scattered across command files) is what makes "unknown flag" rejection
// consistent — see specs/commands/*.md for the flags each surface declares.
// `--timezone` is global and never declared per-command.

export const AUTH_FLAGS: Record<string, FlagSpec> = {
  login: { value: ["--phone"] },
  verify: {},
  status: {},
  logout: {},
};

export const DOCTOR_FLAGS: FlagSpec = {};

export const HOME_FLAGS: FlagSpec = { value: ["--limit"] };

export const SETUP_FLAGS: FlagSpec = {
  value: ["--agent", "--scope"],
  boolean: ["--status", "--uninstall"],
};

export const EVENTS_FLAGS: Record<string, FlagSpec> = {
  list: { value: ["--limit", "--topic"], boolean: ["--past", "--hosting"] },
  view: { boolean: ["--full"] },
  create: {
    value: [
      "--title",
      "--start",
      "--start-max",
      "--end",
      "--location",
      "--rally-point",
      "--topic",
      "--visibility",
      "--link",
      "--notes",
    ],
  },
  draft: { value: ["--url", "--flyer"] },
  cancel: {},
};

export const INVITE_FLAGS: FlagSpec = { value: ["--event"] };

export const RSVP_FLAGS: FlagSpec = { value: ["--event", "--note"] };

export const FRIENDS_FLAGS: Record<string, FlagSpec> = {
  list: { value: ["--search", "--limit"], boolean: ["--pending"] },
  request: { value: ["--phone", "--first-name", "--last-name"] },
  accept: {},
  decline: {},
};

export const TOPICS_FLAGS: Record<string, FlagSpec> = {
  list: { value: ["--search", "--limit"] },
  create: { boolean: ["--force"] },
};
