# Command: guests

```
squadquest-axi guests [list|add|links|remove|open-link] [<guest>] [flags]
```

People you have invited who **have not registered** for SquadQuest. You add them by name
(and optionally phone) to events you host, hand each one a private link, and they answer
yes / maybe / no on a web page without an account. Friends who have the app are
[invite](invite.md)'s job, not this command's.

Nothing here sends a message. `links` prints the links; getting them to people is up to
the host. Guests never appear in the app. Backend contract:
[api/guests](../api/guests.md).

Every subcommand needs a session, and acts only on **your** guests and **your** events.

## guests list

`squadquest-axi guests [list] [--event <id>]`

One row per guest per event, sorted by event then name:

```
count: 3 guests on 2 events
guests[4]{name,event,rsvp,id}:
  Sam Example,Sample Party,yes,0b1c...
  Pat Example,Sample Party,invited,7d2e...
  Sam Example,Sample Afters,maybe,0b1c...
  Lee Example,(no events),none,4f80...
```

With `--event`, the event moves to a header and the answers are totalled:

```
event: "Sample Party (Tue, Dec 1 6:00 PM-7:00 PM EST)"
answers: "yes 1, maybe 0, no 0, invited 1"
guests[2]{name,rsvp,id}:
  ...
```

Phone numbers are not shown: picking a guest never needs one, and `links` is the one
place that prints them. The full id is printed so it can be passed to `remove`.

Empty: `guests: 0 guests found` (or `… on that event`), with a hint to `guests add`.

## guests add

`squadquest-axi guests add --event <id> [--event <id> …] --name "<name>" [--phone <e164>]`

Creates the guest once and attaches them to every `--event`. Idempotent:

- With `--phone`, an existing guest of yours with that phone is reused. Failing that, an
  existing guest with the same name (case-insensitive) and **no** phone is reused and
  given the phone. Otherwise a new guest is created.
- Without `--phone`, an existing guest with the same name (case-insensitive) is reused;
  two or more such guests is `AMBIGUOUS_NAME` (exit 2) with the candidates' ids.
- Events the guest is already on are reported `already`, not re-added.

Every `--event` is checked first: it must exist and you must have created it, or the
command exits (`EVENT_NOT_FOUND` / `NOT_PERMITTED`) having written nothing. `--name` is
1–100 characters; `--phone` must be E.164 (`+15555550100`).

```
action: created
guest: Sam Example
id: 0b1c…
phone: +15555550100
events[2]{event,title,change}:
  e1…,Sample Party,added
  e2…,Sample Afters,already
help[2]:
  Run `squadquest-axi guests links --base-url <page url>` to get their link
  Run `squadquest-axi guests remove 0b1c… --event e1… --discard-answer` to undo
```

`action` is `created`, `updated` (an existing guest got a phone) or `exists`. The event
rows are read back after the write; a row that is not there afterwards is
`confirmed: false`, exit 1.

**Gate:** none. Adding a guest is what the command is for, sends nothing and is undone
with `remove`.

## guests links

`squadquest-axi guests links --base-url <url> [--event <id>] [--json-out[=path]]`

One line per guest, each with their private link:

```
count: 2 guests
links[2]{name,phone,link}:
  Sam Example,+15555550100,https://example.com/party/?t=3f9a…
  Lee Example,,https://example.com/party/?t=81c0…
```

`--base-url` must be an `http(s)` URL; it is the static page's address. `--event`
narrows to guests on that event. A link **is** the guest's credential: whoever holds it
can see that guest's events and change the answer.

`--json-out[=path]` writes `{rows:[{id,name,phone,link}]}` to a file (temp dir when bare,
`0600`) and adds `wrote:`, `columns:` and a `jq` hint to stdout. `--json` is refused with
a hint to `--json-out`. The export is offered here and nowhere else in this command,
because handing links to a script (a mail merge, a text queue) is the scripted use.

## guests remove

`squadquest-axi guests remove <guest> [--event <id> …] [--discard-answer] [--confirm "<name>"]`

`<guest>` is a guest id or an exact name (case-insensitive). Two guests with that name is
`AMBIGUOUS_NAME` with both ids.

- **With `--event`**: takes the guest off those events. A guest who has answered
  (`yes`/`maybe`/`no`) on any of them loses that answer, so this needs `--discard-answer`
  (`ANSWER_WOULD_BE_LOST`, exit 2, otherwise). An event they are not on is `(no-op)`.
- **Without `--event`**: deletes the guest. Their link stops working and every answer is
  lost, so this needs `--confirm "<their name>"`, matching the stored name
  (`CONFIRM_REQUIRED`, exit 2, with the exact command to re-run).

Removal is read back: a guest or row still present afterwards is `REMOVE_UNCONFIRMED`,
exit 1.

```
action: deleted
guest: Sam Example
id: 0b1c…
events_lost: 2
```

## guests open-link

`squadquest-axi guests open-link --event <id> --base-url <url> [--confirm]`
`squadquest-axi guests open-link --event <id> --close`

One link per event that **anyone** can use to add themselves as a guest and answer, for
a QR code on a printed flyer. QR codes are not this tool's job.

Without `--close`: shows the event's open link, creating one if there is none.

```
action: created
event: "Sample Party (Tue, Dec 1 6:00 PM-7:00 PM EST)"
link: https://example.com/party/?o=5e7d…
joined: 0 of 300
help[1]:
  Run `squadquest-axi guests open-link --event e1… --close` to stop new sign-ups
```

`action` is `created` or `exists`. Each person who signs up becomes a normal guest
(`guests list`, `guests links`). The server caps sign-ups per link (default 300).

With `--close`: closes the open link. Existing guests keep their own links. A closed link
stays closed; running `open-link` again makes a **new** link, so an old flyer stays dead.
No open link is `(no-op)`, exit 0.

**Gates:** creating a link on an event whose visibility is not `public` widens access:
anyone holding the flyer sees the title, time, place and notes. That needs `--confirm`
(`CONFIRM_REQUIRED`, exit 2). On a `public` event, and for showing an existing link, there
is no gate. `--close` narrows access and is never gated.

## Errors

| Code | Exit | When |
| --- | --- | --- |
| `USAGE` | 2 | missing/invalid flag value |
| `EVENT_NOT_FOUND` | 1 | an `--event` you cannot see |
| `NOT_PERMITTED` | 2 | an `--event` you did not create |
| `AMBIGUOUS_NAME` / `NO_MATCH` | 2 | `<guest>` or `--name` matches 2+ / 0 guests |
| `ANSWER_WOULD_BE_LOST`, `CONFIRM_REQUIRED` | 2 | a gate |
| `GUESTS_UNAVAILABLE` | 1 | the server does not have the guest tables |
| `REMOVE_UNCONFIRMED` | 1 | a removal could not be read back |
