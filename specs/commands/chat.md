# Command: chat

Event chat — reading the thread and posting to it. See
[api/members § event chat](../api/members.md#event-chat--event_messages).

## chat list

`squadquest-axi chat [list] --event <id> [--limit N]`

Most recent first, default limit 20.

```
count: 4 of 4
pinned: "Doors at 6, we're in the back room" — Chris A., 2d ago
messages[4]{who,when,pinned,message}:
  Dana R.,20m,false,running ~15 late
  Sam T.,2h,false,parking on Frankford is rough tonight
  Chris A.,2d,true,"Doors at 6, we're in the back room"
  Julia S.,3d,false,who's driving?
help[1]:
  Run `squadquest-axi chat post "<message>" --event <id>` to reply
```

The latest pinned message is lifted out above the thread, because that's how the app
treats it and because it's the one message a caller catching up actually needs.

## chat post

`squadquest-axi chat post "<message>" --event <id> [--pin]`

**A chat post is a notification to the whole squad.** The `create-event-message` webhook
pushes it to every member whose status is `maybe`, `yes` or `omw`
([api/members](../api/members.md)). The confirmation states how many people that is,
since it's the consequence the caller is authorizing — the same reason `cancel` reports
its guest count.

- Empty or whitespace-only content → exit 2. There is no such thing as a blank
  announcement, and a stray quote shouldn't buzz twenty phones.
- The caller must be able to see the event; a `404` is reported as not-found without
  implying anything about access.
- Echoes the posted message back, so a caller can see what shell quoting actually did to
  their text before it reached anyone.

### `--pin` is host-only

Pinning marks the message as the event's standing announcement. The v1 app offers it
**only to the host** (`pinned: isHost && _isPinned`), so this client refuses it for
anyone else — a client-side rule mirroring the app's, not a server guarantee
([api/members](../api/members.md)).

Because the app surfaces the *latest* pinned message rather than a list, **pinning a new
message effectively replaces the previous announcement.** The confirmation says so when
an earlier pinned message exists, so a host doesn't discover it by looking.
