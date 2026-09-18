# squadquest-axi

Agent-ergonomic CLI for [SquadQuest](https://squadquest.app) — see what your friends are up to, post events, and rally a squad from the terminal.

Built to the [AXI](https://github.com/JarvusInnovations/axi) standard: token-efficient TOON output, minimal default schemas, structured errors on stdout, and contextual next-step hints, so an agent discovers the command surface by using it rather than by reading a manual.

```
$ squadquest-axi
account: Ada L. (+1 215-555-0123)
upcoming[3]{id,title,when,rsvp,going}:
  b7e1a217,Flyers vs Colorado Avalanche,Mon Oct 19 6:00-6:45 PM EDT,yes,2
  3f9c0e51,Wednesday night ride,Wed Oct 21 7:00 PM EDT,invited,6
  c1d4a882,Kensington pierogi crawl,Sat Oct 24 1:00 PM EDT,maybe,11
invitations: 1 awaiting your RSVP
help[3]:
  Run `squadquest-axi events view <id>` for the full event and its guest list
  Run `squadquest-axi rsvp yes --event <id>` to respond to an invitation
  Run `squadquest-axi events create --title "..." --start ... --location "..."` to post one
```

## Install

```sh
npm install -g squadquest-axi
squadquest-axi auth login --phone +12155550123
squadquest-axi auth verify <code>   # arrives by SMS
```

## What it does

| | |
| --- | --- |
| `squadquest-axi` | what's coming up, your RSVP, how many are going |
| `events list / view / create / draft / cancel` | including drafting an event from a URL or a **photo of a flyer** |
| `invite "<name>" --event <id>` | resolves names against your friends and invites everyone in one batch |
| `rsvp yes\|maybe\|no\|omw\|none --event <id>` | `omw` puts you on the event's live map |
| `friends list / request / accept / decline` | your friend graph |
| `topics list / create` | the shared tag vocabulary |
| `doctor` | credentials, permissions, connectivity, and which API key works |

Run any command with `--help` for its flags. `--timezone <iana>` works everywhere.

## Two ways to give an agent context — pick one

**A session hook** (recommended) makes every new agent session open already knowing what's coming up:

```sh
squadquest-axi setup          # Claude Code, Codex, OpenCode
squadquest-axi setup --status
```

**An installable skill** loads on demand instead, with no per-session token cost, and works in any agent that supports the format:

```sh
npx skills add SquadQuest/squadquest-axi
```

You only need one. The skill is generated from the same source the CLI's own `--help` reads, so it can't drift.

## A note on invites

`invite` will not guess who you meant. A name matching two friends fails with both candidates and their ids rather than picking one, and a batch where any single name is unresolvable sends nothing at all — a half-delivered invitation has no clean retry. `friends request` takes a phone number and never a name, because it can text someone who isn't on SquadQuest.

## Development

```sh
bun install
bun run dev      # run from source
bun run test
bun run check    # typecheck
bun run docs     # regenerate the skill from src/reference.ts
```

`specs/` is the source of truth for what should be true; `plans/` is the work-in-flight DAG. See [`specs/README.md`](specs/README.md).

## License

MIT
