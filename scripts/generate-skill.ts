#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND_GROUPS, DESCRIPTION } from "../src/reference.js";

/**
 * Generate skills/squadquest-axi/SKILL.md from src/reference.ts — the same
 * source `--help` reads, so documentation cannot drift from the CLI.
 *
 * A skill is static and may be installed without the binary on PATH, so this
 * strips live state and rewrites every example to an `npx -y` form.
 */

const OUT = join(import.meta.dirname, "..", "skills", "squadquest-axi", "SKILL.md");

function npx(command: string): string {
  return command.replace(/^squadquest-axi\b/, "npx -y squadquest-axi");
}

function build(): string {
  const lines = [
    "---",
    "name: squadquest-axi",
    // Trigger-shaped: terse and outcome-focused, so an agent loads it on the
    // right intent rather than on the tool's name.
    `description: ${DESCRIPTION}. Use when asked what's coming up socially, to post or cancel an event, invite friends, RSVP, or check who's going. Triggers: "what am I doing this weekend", "invite <name>", "post an event", "am I going to", "who's coming", "SquadQuest".`,
    "---",
    "",
    "# squadquest-axi",
    "",
    `${DESCRIPTION}.`,
    "",
    "Every command prints TOON and suggests the next step, so the surface is",
    "discoverable by using it. Run any command with `--help` for its flags.",
    "",
    "## Setup",
    "",
    "```sh",
    "npx -y squadquest-axi auth login --phone +12155550123",
    "npx -y squadquest-axi auth verify <code>   # the code arrives by SMS",
    "```",
    "",
    "`--timezone <iana>` works on every command and sets the zone for times in",
    "and out.",
    "",
  ];

  for (const group of COMMAND_GROUPS) {
    lines.push(`## ${group.group}`, "");
    for (const doc of group.commands) {
      lines.push(`### \`${doc.usage}\``, "", doc.summary, "");
      if (doc.flags?.length) {
        lines.push("```");
        for (const flag of doc.flags) lines.push(flag);
        lines.push("```", "");
      }
      if (doc.examples?.length) {
        lines.push("```sh");
        for (const example of doc.examples) lines.push(npx(example));
        lines.push("```", "");
      }
    }
  }

  lines.push(
    "## Notes",
    "",
    "- `invite` resolves names against your accepted friends. An ambiguous name",
    "  fails with every candidate and its id rather than guessing — re-run with an id.",
    "- Inviting several people is one command and one notification batch.",
    "- Cancelling an event sets its status; it never deletes, so attendees are told.",
    "- `friends request` takes a phone number, never a name: it can text someone",
    "  who is not on SquadQuest.",
    "",
  );

  return lines.join("\n");
}

const generated = build();
const check = process.argv.includes("--check");

if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== generated) {
    console.error("SKILL.md is out of date — run `bun run docs` and commit the result.");
    process.exit(1);
  }
  console.error("SKILL.md is up to date.");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, generated);
  console.error(`wrote ${OUT}`);
}
