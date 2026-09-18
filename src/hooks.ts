import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Session-hook detection. Install/uninstall lands with the `home-hooks-docs`
 * plan; this is the read-only half that `auth verify` and `doctor` need in
 * order to point at `setup` when the hook is missing.
 */

export interface AgentTarget {
  agent: "claude-code" | "codex" | "opencode";
  /** Global config file this agent reads hooks from. */
  file: string;
}

export function agentTargets(): AgentTarget[] {
  const home = homedir();
  return [
    { agent: "claude-code", file: join(home, ".claude", "settings.json") },
    { agent: "codex", file: join(home, ".codex", "hooks.json") },
    { agent: "opencode", file: join(home, ".config", "opencode", "plugins", "squadquest-axi.js") },
  ];
}

/** True when the file mentions this tool — good enough to report presence. */
export function hookInstalled(target: AgentTarget): boolean {
  if (!existsSync(target.file)) return false;
  try {
    return readFileSync(target.file, "utf8").includes("squadquest-axi");
  } catch {
    return false;
  }
}

export function installedAgents(): string[] {
  return agentTargets()
    .filter((target) => hookInstalled(target))
    .map((target) => target.agent);
}

/** One-line summary for `auth verify` and `doctor`. */
export function hookSummary(): string {
  const installed = installedAgents();
  return installed.length === 0 ? "not installed" : `installed (${installed.join(", ")})`;
}
