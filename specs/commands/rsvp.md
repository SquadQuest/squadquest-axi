# Command: rsvp

```
squadquest-axi rsvp <yes|maybe|no|omw|none> --event <id> [--note "..."]
```

Sets **your own** status. Acting on other people is [invite](invite.md).

## The statuses

| Status | Meaning |
| --- | --- |
| `yes` | going |
| `maybe` | on the fence |
| `no` | not going |
| `omw` | **on my way** — puts you on the event's live map |
| `none` | withdraw your RSVP entirely |

`omw` is a first-class state, not a UI flourish: it's what starts sharing your position
with the event ([api/members](../api/members.md)). The command surface exposes it, and
the confirmation for `omw` says plainly that location sharing is now active — a caller
should never discover that by looking at a map.

`none` sends a null status, which the backend treats as removal.

## Output

```
rsvp:
  event: Flyers vs Colorado Avalanche
  when: Mon Oct 19 2026, 6:00-6:45 PM EDT
  status: yes
  going: 2
```

Echoes the resulting state so no verification read is needed (AXI §4). `going` is the
post-change count, which is the number the caller actually wanted to know.

## Idempotence and access

Setting the status you already have is exit 0 with a no-op note (AXI §6).

The backend verifies visibility access and returns `404 event-not-found` for an event you
can't see — which is also what a genuinely missing id returns. The client must not
translate that into "you don't have access", since it cannot distinguish the two and
guessing leaks information about events the caller can't see. Report it as not found,
with the command to list the events they can see.

## Host RSVPs

The host is RSVP'd `yes` automatically at creation
([commands/events](events.md#events-create)). A host may change their own status like
anyone else — including to `no`, which the app permits. The client does not block it;
it's a real thing people do, and the event still belongs to them.
