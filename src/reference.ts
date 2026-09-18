export const DESCRIPTION =
  "See what your friends are up to, post events, and rally a squad — SquadQuest from the terminal";

export interface CommandDoc {
  usage: string;
  summary: string;
  flags?: string[];
  examples?: string[];
}

export interface CommandGroup {
  group: string;
  commands: CommandDoc[];
}

/**
 * The one place the v1 command surface is described. The home view's help
 * lines, every `--help` block, and the generated SKILL.md all derive from
 * this, so documentation cannot drift from the implementation.
 *
 * `--timezone <iana>` is accepted on every command (it resolves wall-clock
 * input and output) and deliberately not repeated in each flags block.
 */
export const COMMAND_GROUPS: CommandGroup[] = [
  {
    group: "Events",
    commands: [
      {
        usage: "events [list|view|create|draft|cancel] [<id>] [flags]",
        summary: "Your upcoming events, their guest lists, and posting new ones",
        flags: [
          "--past             events that already happened (list)",
          "--hosting          only events you host (list)",
          "--topic <name>     filter by topic (list) / set the topic (create)",
          "--limit <n>        max rows (list; default 20)",
          "--full             show complete notes (view)",
          "--title <text>     required — the event title (create)",
          "--start <when>     required — ISO or local wall clock (create)",
          "--start-max <when> far end of the rally window (create; default = --start)",
          "--end <when>       when it wraps up (create)",
          "--location <text>  required — the human-readable place (create)",
          "--rally-point <lat,lon>  map pin, latitude first (create)",
          "--visibility <v>   private | friends | public (create; default friends)",
          "--link <url>       an external link (create)",
          "--notes <text>     freeform body (create)",
          "--url <url>        draft an event from a web page (draft)",
          "--flyer <path>     draft an event from a photo of a flyer (draft)",
        ],
        examples: [
          "squadquest-axi events",
          "squadquest-axi events view <id>",
          'squadquest-axi events create --title "Wednesday ride" --start 2026-10-21T19:00 --location "Lloyd Hall"',
          "squadquest-axi events draft --url <url>",
          "squadquest-axi events cancel <id>",
        ],
      },
      {
        usage: 'invite "<name|id>" ["<name|id>" ...] --event <id>',
        summary: "Invite friends to an event — resolves names, notifies everyone at once",
        flags: ["--event <id>   required — the event to invite to"],
        examples: [
          'squadquest-axi invite "Dana" --event <id>',
          'squadquest-axi invite "Dana" "Sam T" --event <id>',
        ],
      },
      {
        usage: "rsvp <yes|maybe|no|omw|none> --event <id> [--note <text>]",
        summary: "Set your own status — omw starts sharing your location with the event",
        flags: [
          "--event <id>   required — the event to respond to",
          "--note <text>  a note alongside your RSVP",
        ],
        examples: [
          "squadquest-axi rsvp yes --event <id>",
          "squadquest-axi rsvp omw --event <id>",
        ],
      },
    ],
  },
  {
    group: "People and topics",
    commands: [
      {
        usage: "friends [list|request|accept|decline] [<id>] [flags]",
        summary: "Your friend graph — who you can invite, and pending requests",
        flags: [
          "--search <text>      narrow by name (list)",
          "--pending            incoming and outgoing requests instead (list)",
          "--limit <n>          max rows (list; default 100)",
          "--phone <e164>       required — who to reach (request)",
          "--first-name <text>  used only when texting a non-member (request)",
          "--last-name <text>   used only when texting a non-member (request)",
        ],
        examples: [
          "squadquest-axi friends",
          "squadquest-axi friends --search dana",
          "squadquest-axi friends --pending",
          "squadquest-axi friends request --phone +12155550123",
        ],
      },
      {
        usage: "topics [list|create] [<name>] [flags]",
        summary: "The shared tag vocabulary that drives notification matching",
        flags: [
          "--search <text>  narrow by name (list)",
          "--limit <n>      max rows (list)",
          "--force          create despite a near-miss warning (create)",
        ],
        examples: [
          "squadquest-axi topics",
          "squadquest-axi topics --search bike",
          "squadquest-axi topics create sports.hockey",
        ],
      },
    ],
  },
  {
    group: "Account",
    commands: [
      {
        usage: "auth [login|verify|status|logout] [<code>] [flags]",
        summary: "Sign in by phone — login sends a code, verify completes it",
        flags: ["--phone <number>  required — your phone number (login)"],
        examples: [
          "squadquest-axi auth login --phone +12155550123",
          "squadquest-axi auth verify 123456",
          "squadquest-axi auth status",
        ],
      },
      {
        usage: "doctor",
        summary: "Check credentials, permissions, connectivity, and which API key works",
        examples: ["squadquest-axi doctor"],
      },
      {
        usage: "setup [--agent <name>] [--scope <s>] [--status] [--uninstall]",
        summary: "Show your upcoming events at the start of every agent session",
        flags: [
          "--agent <name>   claude-code | codex | opencode (default: all detected)",
          "--scope <scope>  project | global (default: global)",
          "--status         report what's installed",
          "--uninstall      remove hooks this tool installed",
        ],
        examples: ["squadquest-axi setup", "squadquest-axi setup --status"],
      },
    ],
  },
];

function commandDoc(name: string): CommandDoc | undefined {
  for (const group of COMMAND_GROUPS) {
    for (const doc of group.commands) {
      const first = doc.usage.split(" ")[0];
      if (first === name) return doc;
    }
  }
  return undefined;
}

/** Render the `--help` block for a single top-level command. */
export function renderCommandHelp(name: string): string | null {
  const doc = commandDoc(name);
  if (!doc) return null;

  const lines = [`usage: squadquest-axi ${doc.usage}`, "", doc.summary];

  if (doc.flags?.length) {
    lines.push("", "flags:");
    for (const flag of doc.flags) lines.push(`  ${flag}`);
  }

  if (doc.examples?.length) {
    lines.push("", "examples:");
    for (const example of doc.examples) lines.push(`  ${example}`);
  }

  lines.push("", "`--timezone <iana>` sets the zone for times in and out on any command.");

  // The SDK writes this string verbatim, so the trailing newline is ours.
  return `${lines.join("\n")}\n`;
}

/** Render the top-level help listing every command by group. */
export function renderTopLevelHelp(): string {
  const lines = [
    `squadquest-axi — ${DESCRIPTION}`,
    "",
    "usage: squadquest-axi <command> [args] [flags]",
  ];

  for (const group of COMMAND_GROUPS) {
    lines.push("", `${group.group}:`);
    const width = Math.max(...group.commands.map((c) => c.usage.length));
    for (const doc of group.commands) {
      lines.push(`  ${doc.usage.padEnd(width)}  ${doc.summary}`);
    }
  }

  lines.push(
    "",
    "`--timezone <iana>` on any command sets the zone for times in and out.",
    "Run `squadquest-axi <command> --help` for usage on any command.",
    "Run `squadquest-axi` with no arguments to see what's coming up.",
  );

  return lines.join("\n");
}
