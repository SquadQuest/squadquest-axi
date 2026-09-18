# Command: events

The noun surface for events. Creating is here; acting on *people* is
[invite](invite.md) and [rsvp](rsvp.md), which are their own verbs.

## events list

`squadquest-axi events [list] [--past] [--hosting] [--limit N] [--topic <name>]`

Default: upcoming events you're involved in, soonest first, limit 20.

```
count: 3 of 3
events[3]{id,title,when,visibility,rsvp,going}:
  b7e1a217,Flyers vs Colorado Avalanche,Mon Oct 19 6:00-6:45 PM EDT,private,yes,2
  ...
help[2]:
  Run `squadquest-axi events view <id>` for details and the guest list
  Run `squadquest-axi events list --past` for events that already happened
```

`--past` reverses the sort (most recent first). Totals are always the real total, not the
page size (AXI §4).

## events view

`squadquest-axi events view <id>`

Full detail plus the guest list, because "who's coming" is the question that follows
almost every view and a second call for it is the expensive kind (AXI §4).

```
event:
  id: b7e1a217-bf50-4a1d-8558-31af246255f9
  title: Flyers vs Colorado Avalanche
  host: Chris A.
  when: Mon Oct 19 2026, 6:00-6:45 PM EDT (ends 9:45 PM)
  location: Xfinity Mobile Arena, 3601 S Broad St
  rally_point: 39.9012,-75.172
  topic: sports.hockey
  visibility: private
  status: live
  link: https://...
  notes: 7:00pm puck drop, $1 Hot Dog Night...
    ... (truncated, 812 chars total)
  your_rsvp: yes
guests[2]{name,status}:
  Chris A.,yes
  Christine B.,invited
help[2]:
  Run `squadquest-axi events view <id> --full` to see the complete notes
  Run `squadquest-axi invite "<name>" --event <id>` to invite someone
```

Notes truncate at 500 chars with the total shown and `--full` offered only when actually
truncated (AXI §3).

## events create

```
squadquest-axi events create --title "..." --start <when> --location "..."
  --topic <name> [--start-max <when>] [--end <when>] [--rally-point <lat,lon>]
  [--visibility private|friends|public] [--link <url>] [--notes "..."]
```

- `--visibility` defaults to **`friends`**, matching the app. `private` is invite-only.
- **`--start` / `--start-max` are the *arrival* window — when people should show up — and
  `--end` is when the thing wraps.** These answer different questions and callers conflate
  them: for a festival running 1 PM to 3 AM, the arrival window is something like
  1–8 PM and `--end` is 3 AM. Setting `--start-max` to the end time tells your squad to
  turn up any time in a ten-hour span, which coordinates nobody. The flag help must say
  "arrival window", not "rally window" — the domain term means nothing to a caller who
  hasn't read the spec.
- `--start-max` omitted equals `--start`, and the confirmation says so explicitly, because
  a zero-width window is a real choice and should be visible
  ([api/instances](../api/instances.md)).
- **`--topic` is required**, and takes a **name** resolved against existing topics. An
  unknown name fails with near-matches and the create command — never auto-created
  ([api/topics](../api/topics.md)).

  It is required because an event with a null topic **crashes the v1 clients**
  ([api/instances](../api/instances.md)). The column is nullable, so nothing upstream
  stops this tool from writing data that breaks the product for everyone who can see the
  event — which makes it the client's job to refuse. `edit` may change a topic but never
  clear one.

**Creates the event and RSVPs the host `yes` as one operation.** An event whose host has
no RSVP row shows nobody attending. If the RSVP call fails after the event is created,
report the event id *and* the failed RSVP with the command to fix it — never a bare
success, never an orphaned id the caller doesn't know about.

Echoes the created event in `events view` shape so no verification read is needed.

## events draft

`squadquest-axi events draft (--url <url> | --flyer <path>) [--timezone <iana>]`

Extracts an event from a web page or a **photo of a flyer**
([api/instances](../api/instances.md)). Returns a draft in create-flag shape — it saves
nothing:

```
draft:
  title: ...
  start: ...
  location: ...
source: https://...
help[1]:
  Run `squadquest-axi events create --title "..." --start ... --location "..."` to post it
```

Review before posting is the point. A scraper that silently posted would turn a bad parse
into a notification. The help line is the filled-in create command, so accepting a good
draft is one paste.

## events edit

```
squadquest-axi events edit <id> [--title "..."] [--start <when>] [--start-max <when>]
  [--end <when>] [--location "..."] [--rally-point <lat,lon>] [--topic <name>]
  [--visibility ...] [--link <url>] [--notes "..."]
```

Changes a posted event in place. Only the flags given are touched; everything else is
left alone.

**This command exists because its absence is dangerous.** Without it the only way to
change a posted event is cancel-and-recreate, which fires a cancellation notification at
every `yes`/`maybe`/`omw` attendee, discards their RSVPs, and leaves a dead event behind.
A caller who wants to fix a typo should not have to un-invite their friends to do it.

### edit vs cancel — the distinction the command surface must teach

These are not two ways to do the same thing, and an agent that confuses them tells
everyone a party is off in order to fix a spelling mistake.

| The event is… | Use | What guests see |
| --- | --- | --- |
| still happening; the *record* is wrong | **`edit`** | at most a change notice |
| not happening any more | **`cancel`** | "this is off" |

`cancel` is a **message to your guests**, not a record operation. `edit` is a record
operation that leaves the plan intact. Because the destructive one is the one an agent
reaches for when no alternative is visible, `edit` must be surfaced everywhere the
question comes up: in `events view`'s hints, after `create`, in `cancel`'s own output, and
in the top-level summary line.

- **Host only.** Checked client-side, same as cancel.
- **No flags → exit 2.** An edit that changes nothing is a caller mistake, not a no-op:
  it almost always means the flags were misspelled.
- Reports **what changed**, old → new, per field. A caller needs to see that they edited
  the field they meant to.
- Window and coordinate validation is identical to `create`, and runs before the write.
- May change a topic, but **never clear one** — a null topic crashes the v1 clients
  ([api/instances](../api/instances.md)).

Edits go through a plain `PATCH`; the notification fan-out is handled by database
webhooks ([api/instances](../api/instances.md)), so writing the row is the whole job.

## events cancel

`squadquest-axi events cancel <id>`

Sets `status = canceled`. **Never deletes** — the cancel notification is driven by the
status change, and a delete strands every attendee silently
([api/instances](../api/instances.md)).

Idempotent: cancelling a cancelled event is exit 0 with a no-op note (AXI §6). Only the
host may cancel; the client checks locally and says so rather than letting the write
appear to succeed.

**Cancel announces to guests that the event is off.** Use it only for that. If the event
is still happening and the record is simply wrong, that is [`edit`](#events-edit) — the
confirmation says so, because the moment a caller has just cancelled is the moment they
find out whether they picked the right verb.

The confirmation states how many attendees are being notified, since that is the
consequence the caller is actually authorizing.

## events uncancel

`squadquest-axi events uncancel <id>`

Restores a canceled event to `live`. Its own verb rather than a flag on `edit`, so that
the pair `cancel` / `uncancel` is visible in the command list and a caller who cancelled
the wrong thing finds the undo by reading rather than by guessing.

Idempotent: uncancelling a live event is exit 0 with a no-op note. Host only. Attendees
are notified of the change by the same webhook that announced the cancellation, so an
accidental cancel-then-uncancel sends two messages — the confirmation says so plainly
rather than implying the mistake went unseen.
