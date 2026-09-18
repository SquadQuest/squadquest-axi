import { AxiError } from "axi-sdk-js";

/**
 * Placeholder for a command whose plan hasn't landed yet.
 *
 * Exits 2 rather than 1: the command genuinely cannot satisfy the agent's
 * intent, and a stub that returned empty data would be indistinguishable from
 * a real empty result — exactly the ambiguity AXI §5 exists to prevent.
 */
export function notImplemented(command: string, plan: string): never {
  throw new AxiError(`\`${command}\` is not implemented yet`, "NOT_IMPLEMENTED", [
    `Tracked by plans/${plan}.md`,
    "Run `squadquest-axi --help` to see what is available",
  ]);
}
