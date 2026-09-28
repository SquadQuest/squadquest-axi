---
name: squadquest-axi
description: See what your friends are up to, post events, and rally a squad — SquadQuest from the terminal. Use when asked what's coming up socially, to post or cancel an event, invite friends, RSVP, or check who's going. Triggers: "what am I doing this weekend", "invite <name>", "post an event", "am I going to", "who's coming", "SquadQuest".
---

# squadquest-axi

See what your friends are up to, post events, and rally a squad — SquadQuest from the terminal.

Every command prints TOON and suggests the next step, so the surface is
discoverable by using it. Run any command with `--help` for its flags.

## Setup

```sh
npx -y squadquest-axi auth login --phone +12155550123
npx -y squadquest-axi auth verify <code>   # the code arrives by SMS
```

`--timezone <iana>` works on every command and sets the zone for times in
and out.

## Events

### `events [list|view|create|edit|draft|cancel|uncancel] [<id>] [flags]`

Your events and guest lists — post, edit in place, or cancel to tell guests it's off

```
--past             events that already happened (list)
--hosting          only events you host (list)
--topic <name>     filter by topic (list) / set it (create, REQUIRED; edit)
--limit <n>        max rows (list; default 20)
--full             show complete notes (view)
--title <text>     required — the event title (create; optional on edit)
--start <when>     when people can start showing up (create, required; edit)
--start-max <when> latest people should show up (create/edit; default = --start)
--end <when>       when the event wraps up — NOT the arrival window (create/edit)
--location <text>  required — the human-readable place (create; edit)
--rally-point <lat,lon>  map pin, latitude first (create/edit)
--visibility <v>   private | friends | public (create; default friends; edit)
--link <url>       an external link (create/edit)
--notes <text>     freeform body (create/edit)
--url <url>        draft an event from a web page (draft)
--flyer <path>     draft an event from a photo of a flyer (draft)
```

```sh
npx -y squadquest-axi events
npx -y squadquest-axi events view <id>
npx -y squadquest-axi events create --title "Wednesday ride" --start 2026-10-21T19:00 --location "Lloyd Hall" --topic bike.group-ride
npx -y squadquest-axi events draft --url <url>
npx -y squadquest-axi events edit <id> --notes "..." --start-max 2026-10-21T20:00
npx -y squadquest-axi events cancel <id>     # tells guests it is OFF
npx -y squadquest-axi events uncancel <id>
```

### `invite "<name|id>" ["<name|id>" ...] --event <id>`

Invite friends to an event — resolves names, notifies everyone at once

```
--event <id>   required — the event to invite to
```

```sh
npx -y squadquest-axi invite "Dana" --event <id>
npx -y squadquest-axi invite "Dana" "Sam T" --event <id>
```

### `rsvp <yes|maybe|no|omw|none> --event <id> [--note <text>]`

Set your own status — omw starts sharing your location with the event

```
--event <id>   required — the event to respond to
--note <text>  a note alongside your RSVP
```

```sh
npx -y squadquest-axi rsvp yes --event <id>
npx -y squadquest-axi rsvp omw --event <id>
```

## People and topics

### `friends [list|request|accept|decline] [<id>] [flags]`

Your friend graph — who you can invite, and pending requests

```
--search <text>      narrow by name (list)
--pending            incoming and outgoing requests instead (list)
--limit <n>          max rows (list; default 100)
--phone <e164>       required — who to reach (request)
--first-name <text>  used only when texting a non-member (request)
--last-name <text>   used only when texting a non-member (request)
```

```sh
npx -y squadquest-axi friends
npx -y squadquest-axi friends --search dana
npx -y squadquest-axi friends --pending
npx -y squadquest-axi friends request --phone +12155550123
```

### `topics [list|create] [<name>] [flags]`

The shared tag vocabulary that drives notification matching

```
--search <text>  narrow by name (list)
--limit <n>      max rows (list)
--force          create despite a near-miss warning (create)
```

```sh
npx -y squadquest-axi topics
npx -y squadquest-axi topics --search bike
npx -y squadquest-axi topics create sports.hockey
```

## Account

### `auth [login|verify|status|logout] [<code>] [flags]`

Sign in by phone — login sends a code, verify completes it

```
--phone <number>  required — your phone number (login)
```

```sh
npx -y squadquest-axi auth login --phone +12155550123
npx -y squadquest-axi auth verify 123456
npx -y squadquest-axi auth status
```

### `doctor`

Check credentials, permissions, connectivity, and which API key works

```sh
npx -y squadquest-axi doctor
```

### `setup [--agent <name>] [--scope <s>] [--status] [--uninstall]`

Show your upcoming events at the start of every agent session

```
--agent <name>   claude-code | codex | opencode (default: all detected)
--scope <scope>  project | global (default: global)
--status         report what's installed
--uninstall      remove hooks this tool installed
```

```sh
npx -y squadquest-axi setup
npx -y squadquest-axi setup --status
```

## Notes

- `invite` resolves names against your accepted friends. An ambiguous name
  fails with every candidate and its id rather than guessing — re-run with an id.
- Inviting several people is one command and one notification batch.
- Cancelling an event sets its status; it never deletes, so attendees are told.
- `friends request` takes a phone number, never a name: it can text someone
  who is not on SquadQuest.
