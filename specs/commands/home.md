# Command: home (no args)

`squadquest-axi` with no arguments. Per AXI §8 this shows live content, not a usage
manual, and per §7 it is what the SessionStart hook prints — so an agent opens every
session already knowing what's coming up.

## Output

```
bin: ~/.asdf/installs/nodejs/22.22.3/bin/squadquest-axi
description: See what your friends are up to, post events, and rally a squad
account: Chris A. (+1 215-555-0123)
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

## Rules

- **Upcoming only**, soonest first, default limit 5. Past events are not ambient context.
- Includes events you host, are invited to, and have RSVP'd to — everything where you
  have an `instance_members` row, plus anything you created.
- `rsvp` is *your* status (`invited` / `yes` / `maybe` / `no` / `omw`), which is the
  field that most often implies the next action.
- `going` is the count of `yes` + `omw`. A pre-computed aggregate per AXI §4 — without
  it, deciding whether an event is worth opening costs a second call.
- `invitations:` surfaces the count of `invited` rows awaiting a response, because that
  is the one thing in this view with a deadline attached to someone else's planning.
- Timezone rendering per [behaviors/time-and-place](../behaviors/time-and-place.md).

## Token budget

This loads on **every** session (AXI §7). Five events at five columns is the ceiling.
Notes, locations, links and guest lists belong in `events view`, never here.

## Empty and unauthenticated states

Per AXI §5, the zero is stated with context:

```
upcoming: no events in the next 30 days
help[2]:
  Run `squadquest-axi events create --title "..." ...` to post one
  Run `squadquest-axi friends` to see who you could rally
```

Unauthenticated, home does **not** error — it identifies the tool and points at login,
because a hook that exits non-zero on a fresh machine is noise in every session:

```
bin: ~/.asdf/installs/nodejs/22.22.3/bin/squadquest-axi
description: See what your friends are up to, post events, and rally a squad
account: not signed in
help[1]:
  Run `squadquest-axi auth login --phone +12155550123` to sign in
```
