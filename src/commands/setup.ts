import { homedir } from "node:os";
import { AxiError } from "axi-sdk-js";
import { SETUP_FLAGS, bool, parseFlags, str } from "../flags.js";
import {
  agentTargets,
  hookCommand,
  hookInstalled,
  installHook,
  uninstallHook,
  type AgentName,
  type Scope,
} from "../hooks.js";
import { computed, joinBlocks, renderHelp, renderList, renderObject } from "../output/index.js";

const AGENTS: AgentName[] = ["claude-code", "codex", "opencode"];

export function setupCommand(args: string[]): string {
  const parsed = parseFlags("setup", args, SETUP_FLAGS);

  const scopeRaw = str(parsed, "--scope", "global");
  if (scopeRaw !== "global" && scopeRaw !== "project") {
    throw new AxiError(`"${scopeRaw}" is not a scope`, "USAGE", ["Valid scopes: global, project"]);
  }
  const scope = scopeRaw as Scope;

  const agentRaw = str(parsed, "--agent");
  if (agentRaw && !AGENTS.includes(agentRaw as AgentName)) {
    throw new AxiError(`"${agentRaw}" is not a supported agent`, "USAGE", [
      `Valid agents: ${AGENTS.join(", ")}`,
    ]);
  }
  const wanted = agentRaw ? [agentRaw as AgentName] : AGENTS;

  if (bool(parsed, "--status")) return status(scope);
  if (bool(parsed, "--uninstall")) return uninstall(wanted, scope);
  return install(wanted, scope, Boolean(agentRaw));
}

function tilde(path: string): string {
  return path.replace(homedir(), "~");
}

function install(wanted: AgentName[], scope: Scope, explicit: boolean): string {
  const targets = agentTargets(scope).filter((t) => wanted.includes(t.agent));

  const installed: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    // An explicitly named agent is installed whether or not we detect it —
    // the user knows their setup better than our directory sniffing.
    if (!target.present && !explicit) {
      skipped.push({ agent: target.agent, reason: "not installed" });
      continue;
    }
    try {
      const result = installHook(target.agent, scope);
      installed.push({ agent: target.agent, scope, file: tilde(target.file), result });
    } catch (error) {
      skipped.push({
        agent: target.agent,
        reason: error instanceof Error ? error.message : "could not write the hook",
      });
    }
  }

  if (installed.length === 0) {
    return joinBlocks(
      renderObject({ setup: "no supported agent found to install into" }),
      renderHelp([`Run \`squadquest-axi setup --agent ${AGENTS[0]}\` to install anyway`]),
    );
  }

  return joinBlocks(
    renderList("installed", installed, [
      computed("agent", (i) => i.agent),
      computed("scope", (i) => i.scope),
      computed("file", (i) => i.file),
      computed("result", (i) => i.result),
    ]),
    skipped.length > 0
      ? renderList("skipped", skipped, [
          computed("agent", (i) => i.agent),
          computed("reason", (i) => i.reason),
        ])
      : "",
    renderHelp([
      "Run `squadquest-axi setup --status` to check, or `--uninstall` to remove",
    ]),
  );
}

function status(scope: Scope): string {
  const rows = agentTargets(scope).map((target) => {
    const state = hookInstalled(target.agent, scope);
    return {
      agent: target.agent,
      installed: state.installed,
      current: state.installed ? state.current : "—",
      file: tilde(target.file),
    };
  });

  const stale = rows.filter((r) => r.installed && r.current === false);

  return joinBlocks(
    renderObject({ command: hookCommand(), scope }),
    renderList("agents", rows, [
      computed("agent", (i) => i.agent),
      computed("installed", (i) => i.installed),
      computed("current", (i) => i.current),
      computed("file", (i) => i.file),
    ]),
    renderHelp(
      stale.length > 0
        ? ["Run `squadquest-axi setup` to repair the stale path"]
        : ["Run `squadquest-axi setup --uninstall` to remove"],
    ),
  );
}

function uninstall(wanted: AgentName[], scope: Scope): string {
  const removed = wanted.filter((agent) => uninstallHook(agent, scope));

  return renderObject(
    removed.length === 0
      ? { uninstall: "nothing installed for those agents (no-op)" }
      : { uninstall: `removed from ${removed.join(", ")}` },
  );
}
