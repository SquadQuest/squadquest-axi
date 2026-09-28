---
status: done
depends: [events-read]
specs:
  - specs/api/members.md
  - specs/commands/chat.md
---

# Plan: event chat — read, post, pin

## Scope

`chat list` and `chat post`, including `--pin`.

Out of scope: marking the thread read (`set-chat-last-seen` exists and is a separate
concern), and any notion of replies or threading — the backend has none.

## Implements

- `specs/api/members.md` — the `event_messages` table and the host-only pin rule
- `specs/commands/chat.md` — the whole document

## Approach

1. `listMessages(eventId, limit)` — `event_messages?instance=eq.<id>&order=created_at.desc`,
   with authors resolved in one batched `profiles` call (the same two-FK hazard as the
   guest list, so no embed).
2. Lift the latest `pinned` message out above the thread, matching how the app treats it.
3. `postMessage(eventId, content, pinned)` — a plain insert. The
   `create-event-message` webhook does the notification fan-out.
4. **Guard `--pin` to the host.** The app sends `pinned: isHost && _isPinned`; the
   database would accept it from anyone. Mirror the app's rule and say so in the error.
5. Reject empty/whitespace content before the call — a blank announcement is never
   intended and this one buzzes phones.
6. Report the recipient count (`maybe`/`yes`/`omw` members, excluding the sender) the way
   `cancel` reports its guest count, and warn when pinning supersedes an existing pinned
   message.

## Validation

- [x] `chat --event <id>` lists messages newest-first with author and relative time
- [x] The latest pinned message is surfaced above the thread
- [x] An empty thread states the zero definitively
- [x] `chat post "..."` inserts and echoes the message back verbatim
- [x] The confirmation reports how many people will be notified
- [x] Empty or whitespace-only content exits 2 with no call
- [x] `--pin` works for the host
- [ ] `--pin` as a non-host exits 2 explaining it's the app's rule
- [x] Pinning when a pinned message already exists says it supersedes the old one
- [x] An event the caller can't see reports not-found without implying access
- [x] Output never claims a notification was delivered

## Risks / unknowns

- **This command notifies people, and unlike `invite` it can be fired repeatedly.** A
  loop that posts on every tick would be a genuine nuisance. Nothing in the tool rate
  limits it; the honest mitigation is that the confirmation always states the blast
  radius.
- **Whether the DB enforces anything about `pinned` is unverified** — the guard is
  client-side only, same class as the `invite` permission guard.
- **Author resolution on a long thread** could be chatty; batch it and cap the default
  limit.

## Notes

- **Verified on a throwaway private event with no other members**, so the notification
  fan-out stayed at zero guests while still exercising the real insert, the webhook path,
  and the recipient count.
- **Posting reports its blast radius** (`notifying: N guests`) for the same reason
  `cancel` does — a chat post pushes to every `maybe`/`yes`/`omw` member, which is easy
  to forget when it reads like a note.
- **Pinning twice reports what it replaced**, quoting the superseded announcement. The
  app surfaces only the latest pinned message, so without that line a host would silently
  lose the previous one.
- **`--pin` is host-only, mirroring the app's `pinned: isHost && _isPinned`.** The
  database would accept it from anyone; this is the app's rule, and the error says so.
- **Fixed on sight: "just now ago".** `${ago()} ago` reads fine for "3d" and badly for
  "just now", so the pinned line uses a wrapper that omits the suffix.

## Follow-ups

- **The non-host `--pin` refusal is untested** — it needs a second account, the same gap
  that leaves `invite`'s permission guard unexercised.
- **Nothing rate limits posting.** A loop could spam every attendee. The mitigation is
  only that the confirmation always states how many people it reached.
