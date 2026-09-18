import { AxiError, exitCodeForError, runAxiCli } from "axi-sdk-js";
import { joinBlocks, renderHelp, renderObject } from "./output/index.js";
import { DESCRIPTION, renderCommandHelp, renderTopLevelHelp } from "./reference.js";
import { version } from "./version.js";
import { homeCommand } from "./commands/home.js";
import { authCommand } from "./commands/auth.js";
import { doctorCommand } from "./commands/doctor.js";
import { setupCommand } from "./commands/setup.js";
import { eventsCommand } from "./commands/events.js";
import { inviteCommand } from "./commands/invite.js";
import { rsvpCommand } from "./commands/rsvp.js";
import { friendsCommand } from "./commands/friends.js";
import { topicsCommand } from "./commands/topics.js";

/**
 * Error codes that represent a malformed invocation rather than a failed
 * operation. AXI §6 requires these to exit 2, but the SDK only maps its own
 * `VALIDATION_ERROR` that way — so they are re-mapped here.
 *
 * `AMBIGUOUS_NAME` and `NO_MATCH` belong in this set: the agent's intent could
 * not be determined, so nothing was attempted
 * (specs/behaviors/name-resolution.md).
 */
const USAGE_CODES = new Set([
  "USAGE",
  "UNKNOWN_FLAG",
  "VALIDATION_ERROR",
  "AMBIGUOUS_NAME",
  "NO_MATCH",
  "NO_SESSION",
  "NEAR_MISS",
  "NOT_PERMITTED",
  "NOT_IMPLEMENTED",
]);

function renderFailure(
  message: string,
  code: string,
  suggestions: string[],
  details?: Record<string, unknown>,
): string {
  const head: Record<string, unknown> = { error: message, code };
  if (details) Object.assign(head, details);
  // `help` renders through renderHelp rather than encode(), which inlines
  // primitive arrays — the multi-line `help[N]:` block is the AXI form.
  // Written verbatim by the SDK, so the trailing newline is ours.
  return `${joinBlocks(renderObject(head), renderHelp(suggestions))}\n`;
}

/**
 * Exported (rather than inlined into the `runAxiCli` call) so the
 * USAGE-set→2 mapping and INTERNAL_ERROR wrapping are unit-testable without
 * exercising the full CLI dispatch.
 */
export function formatError(error: unknown): { output: string; exitCode: number } {
  if (error instanceof AxiError) {
    // Candidate lists ride along on the error so an ambiguous name resolves in
    // one correction rather than two (AXI §4).
    const details = (error as AxiError & { details?: Record<string, unknown> }).details;
    return {
      output: renderFailure(error.message, error.code, error.suggestions, details),
      exitCode: USAGE_CODES.has(error.code) ? 2 : exitCodeForError(error),
    };
  }

  // Never let a raw dependency error or stack trace reach stdout — an agent
  // would try to read it as data.
  const message = error instanceof Error ? error.message : String(error);
  return {
    output: renderFailure(`unexpected failure: ${message}`, "INTERNAL_ERROR", [
      "Run `squadquest-axi doctor` to check credentials and connectivity",
    ]),
    exitCode: 1,
  };
}

export async function main(argv: string[] = process.argv.slice(2)) {
  await runAxiCli({
    description: DESCRIPTION,
    version,
    argv,
    topLevelHelp: renderTopLevelHelp(),
    getCommandHelp: renderCommandHelp,
    home: async (args) => homeCommand(args),
    commands: {
      auth: async (args) => authCommand(args),
      doctor: async (args) => doctorCommand(args),
      setup: async (args) => setupCommand(args),
      events: async (args) => eventsCommand(args),
      invite: async (args) => inviteCommand(args),
      rsvp: async (args) => rsvpCommand(args),
      friends: async (args) => friendsCommand(args),
      topics: async (args) => topicsCommand(args),
    },
    formatError,
  });
}
