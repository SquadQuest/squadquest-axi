import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Session integration — specs/commands/setup.md.
 *
 * Installing writes into config files the user's agent owns, so every write
 * is read-modify-write with a parse check, and never touches a key we didn't
 * put there. A malformed write breaks their agent, not just this tool.
 */

export type AgentName = "claude-code" | "codex" | "opencode";
export type Scope = "global" | "project";

export interface AgentTarget {
  agent: AgentName;
  file: string;
  /** The agent is considered present when its config directory exists. */
  present: boolean;
}

const MARKER = "squadquest-axi";

function agentFile(agent: AgentName, scope: Scope): string {
  const root = scope === "project" ? process.cwd() : homedir();
  switch (agent) {
    case "claude-code":
      return join(root, ".claude", "settings.json");
    case "codex":
      return join(root, ".codex", "hooks.json");
    case "opencode":
      return scope === "project"
        ? join(root, ".opencode", "plugins", "squadquest-axi.js")
        : join(homedir(), ".config", "opencode", "plugins", "squadquest-axi.js");
  }
}

function agentRoot(agent: AgentName, scope: Scope): string {
  return dirname(agentFile(agent, scope));
}

export function agentTargets(scope: Scope = "global"): AgentTarget[] {
  return (["claude-code", "codex", "opencode"] as AgentName[]).map((agent) => ({
    agent,
    file: agentFile(agent, scope),
    // Presence is the agent's own directory, not our file — we install into
    // agents the user actually has.
    present: existsSync(agentRoot(agent, scope)) || existsSync(dirname(agentRoot(agent, scope))),
  }));
}

/**
 * The command the hook runs. Prefers the bare binary name when PATH resolves
 * it to *this* executable, so a global install stays portable; otherwise the
 * absolute path, so we never accidentally run a different binary.
 */
export function hookCommand(): string {
  const self = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
  if (self) {
    try {
      const onPath = execFileSync("which", [MARKER], { encoding: "utf8" }).trim();
      if (onPath && realpathSync(onPath) === self) return MARKER;
    } catch {
      // not on PATH — fall through to the absolute path
    }
    return self;
  }
  return MARKER;
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    // Refuse to overwrite a file we cannot parse — clobbering a user's agent
    // config is worse than not installing.
    throw new Error(`${file} is not valid JSON — fix or remove it, then re-run setup`);
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}

export type InstallResult = "installed" | "updated" | "unchanged";

function installJsonHook(file: string, command: string): InstallResult {
  const config = readJson(file);
  const hooks = (config.hooks ?? {}) as Record<string, HookEntry[]>;
  const sessionStart = [...(hooks.SessionStart ?? [])];

  const index = sessionStart.findIndex((entry) =>
    entry.hooks?.some((h) => h.command?.includes(MARKER)),
  );

  if (index >= 0) {
    const existing = sessionStart[index]!.hooks.find((h) => h.command?.includes(MARKER))!;
    if (existing.command === command) return "unchanged";
    // Path repair: rewrite in place rather than appending a second entry.
    existing.command = command;
    writeJson(file, { ...config, hooks: { ...hooks, SessionStart: sessionStart } });
    return "updated";
  }

  sessionStart.push({ hooks: [{ type: "command", command }] });
  writeJson(file, { ...config, hooks: { ...hooks, SessionStart: sessionStart } });
  return "installed";
}

function installOpencodePlugin(file: string, command: string): InstallResult {
  const contents = `// Managed by squadquest-axi — safe to delete.
import { execFile } from "node:child_process";

export default {
  async context() {
    return new Promise((resolve) => {
      execFile(${JSON.stringify(command)}, [], (error, stdout) => {
        resolve(error ? "" : stdout);
      });
    });
  },
};
`;
  if (existsSync(file) && readFileSync(file, "utf8") === contents) return "unchanged";
  const existed = existsSync(file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
  return existed ? "updated" : "installed";
}

function enableCodexHooks(scope: Scope): void {
  const file = join(scope === "project" ? process.cwd() : homedir(), ".codex", "config.toml");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (/^\s*hooks\s*=\s*true/m.test(existing)) return;
  mkdirSync(dirname(file), { recursive: true });
  // Append rather than rewrite: this file is the user's, and we own one key.
  const block = /\[features\]/.test(existing)
    ? existing.replace(/\[features\]/, "[features]\nhooks = true")
    : `${existing}${existing.endsWith("\n") || existing === "" ? "" : "\n"}\n[features]\nhooks = true\n`;
  writeFileSync(file, block);
}

export function installHook(agent: AgentName, scope: Scope): InstallResult {
  const command = hookCommand();
  const file = agentFile(agent, scope);

  if (agent === "opencode") return installOpencodePlugin(file, command);
  if (agent === "codex") {
    const result = installJsonHook(file, command);
    enableCodexHooks(scope);
    return result;
  }
  return installJsonHook(file, command);
}

export function uninstallHook(agent: AgentName, scope: Scope): boolean {
  const file = agentFile(agent, scope);
  if (!existsSync(file)) return false;

  if (agent === "opencode") {
    if (!readFileSync(file, "utf8").includes(MARKER)) return false;
    writeFileSync(file, "");
    return true;
  }

  const config = readJson(file);
  const hooks = (config.hooks ?? {}) as Record<string, HookEntry[]>;
  const before = hooks.SessionStart ?? [];
  // Remove only entries we installed.
  const after = before.filter((entry) => !entry.hooks?.some((h) => h.command?.includes(MARKER)));
  if (after.length === before.length) return false;

  writeJson(file, { ...config, hooks: { ...hooks, SessionStart: after } });
  return true;
}

export function hookInstalled(agent: AgentName, scope: Scope): { installed: boolean; current: boolean } {
  const file = agentFile(agent, scope);
  if (!existsSync(file)) return { installed: false, current: false };
  const contents = readFileSync(file, "utf8");
  if (!contents.includes(MARKER)) return { installed: false, current: false };
  return { installed: true, current: contents.includes(hookCommand()) };
}

export function installedAgents(scope: Scope = "global"): AgentName[] {
  return agentTargets(scope)
    .filter((t) => hookInstalled(t.agent, scope).installed)
    .map((t) => t.agent);
}

/** One-line summary for `auth verify` and `doctor`. */
export function hookSummary(): string {
  const installed = installedAgents();
  return installed.length === 0 ? "not installed" : `installed (${installed.join(", ")})`;
}

export { agentFile };
