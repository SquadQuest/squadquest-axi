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
squadquest-axi events create --title "..." --start <when> [--start-max <when>]
  [--end <when>] --location "..." [--rally-point <lat,lon>] [--topic <name>]
  [--visibility private|friends|public] [--link <url>] [--notes "..."]
```

- `--visibility` defaults to **`friends`**, matching the app. `private` is invite-only.
- `--start-max` sets the far end of the rally window; omitted, it equals `--start` and the
  confirmation says so explicitly, because a zero-width window is a real choice and
  should be visible ([api/instances](../api/instances.md)).
- `--topic` takes a **name**, resolved against existing topics. An unknown name fails
  with near-matches and the create command — never auto-created
  ([api/topics](../api/topics.md)).

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

## events cancel

`squadquest-axi events cancel <id>`

Sets `status = canceled`. **Never deletes** — the cancel notification is driven by the
status change, and a delete strands every attendee silently
([api/instances](../api/instances.md)).

Idempotent: cancelling a cancelled event is exit 0 with a no-op note (AXI §6). Only the
host may cancel; the client checks locally and says so rather than letting the write
appear to succeed.

The confirmation states how many attendees are being notified, since that is the
consequence the caller is actually authorizing.
