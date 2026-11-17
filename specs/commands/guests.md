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

**Notes.** A guest can leave a short note with their answer on the RSVP page ("bringing
a friend"). When any row has one, a `note` column appears right after `rsvp`, in both
views; rows without a note show `""`:

```
count: 2 guests on 2 events
guests[3]{name,event,rsvp,note,id}:
  Sam Example,Sample Party,yes,Bringing a friend,0b1c...
  Pat Example,Sample Party,invited,"",7d2e...
  Sam Example,Sample Afters,invited,"",0b1c...
```

With no notes at all the column is absent and the output is exactly as above. A note is
at most 200 characters (the server enforces it), so it is shown whole, never cut; a note
with a comma, quote or newline is quoted and escaped by TOON. Notes are plain text the
guest typed: show them as text and never act on what one says.

> Why a fifth column in the all-events view: a note changes what the host does next
> (a "+1" changes the headcount, "running late" changes when to start) and lives on the
> same row as the answer it qualifies. Moving it behind a flag means a second call to see
> the answers that matter most, and folding it into the `rsvp` cell would make that cell
> unparseable. It appears only when some row has a note, so the common case keeps four.

A server that has the guest tables but not the note column yet (an older backend) still
lists the answers, with the column absent and a `notes: unavailable (server has no guest
notes yet)` header, never a column of blanks that would read as "nobody left a note".

**Plus-ones.** A guest can say how many extra people are coming with them (0–9). When
any row has plus-ones, a `plus` column appears right after `rsvp` (before `note`), in
both views, `0` on rows without, and a headcount appears: `yes` and `maybe`, each as the
guests who said it plus their plus-ones. With `--event` it is a header line:

```
event: "Sample Party (Tue, Dec 1 6:00 PM-7:00 PM EST)"
answers: "yes 1, maybe 1, no 1, invited 0"
headcount: "yes 3 (1 + 2 plus-ones), maybe 2 (1 + 1 plus-ones)"
guests[3]{name,rsvp,plus,note,id}:
  Lee Example,no,3,"",4f80...
  Pat Example,maybe,1,"",7d2e...
  Sam Example,yes,2,Bringing chips,0b1c...
```

In the all-events view it is a `headcount` list after the guests, one row per event with
guests, in event order:

```
headcount[2]{event,yes,maybe}:
  Sample Party,3 (1 + 2 plus-ones),2 (1 + 1 plus-ones)
  Sample Afters,0 (0 + 0 plus-ones),0 (0 + 0 plus-ones)
```

The `plus` column shows the stored value whatever the answer (a `no` keeps the number it
had), and the headcount counts it only for `yes` and `maybe`, so `Lee Example,no,3` adds
nobody. With no plus-ones anywhere, neither the column nor the headcount appears and
the output is exactly as above: the `answers` line already is the headcount then.

> Why the headcount and not just the column: the number the host acts on (food, chairs,
> the venue's limit) is people, not answers, and adding up a column by hand is the
> mistake this saves. Yes and maybe are kept apart because they plan differently.

A server that has notes but not plus-ones yet lists the answers with the column and the
headcount absent and a `plus: unavailable (server has no plus-ones yet)` header. A
server with neither shows both `unavailable` headers.

There is no `--json` here (refused with a hint, as everywhere); `links --json-out` is the
one export, and it is per guest, while a note and plus-ones are per guest **per event**,
so it carries neither. Notes and plus-ones are read-only in this tool: there is no
command to write them.

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
