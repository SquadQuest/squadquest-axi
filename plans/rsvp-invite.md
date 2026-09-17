---
status: planned
depends: [friends-resolution, events-read]
specs:
  - specs/api/members.md
  - specs/behaviors/name-resolution.md
  - specs/commands/invite.md
  - specs/commands/rsvp.md
---

# Plan: rsvp + invite

## Scope

The two people-verbs: `rsvp <status> --event <id>` and
`invite "<name>" … --event <id>`.

The payoff plan. `invite` is the command this tool exists to make one step, and it is
also the one that can do irreversible damage to a real person's phone — so it lands only
after the resolver (`friends-resolution`) is built and tested.

Out of scope: friend requests (`friend-requests`), event chat.

## Implements

- `specs/api/members.md` — both edge functions, array invite, skip semantics, gating
- `specs/behaviors/name-resolution.md` — the all-or-nothing multi-person rule
- `specs/commands/invite.md`, `specs/commands/rsvp.md`

## Approach

1. `rsvp` — `POST /functions/v1/rsvp` with `{instance_id, status, note?}`. `none` maps to
   a null status. Echo the resulting state plus the post-change `going` count.
2. `omw` gets a distinct confirmation line stating that location sharing is now active.
   A caller must never learn that from a map.
3. `invite` — `resolveAll()` first, **then** a single `POST /functions/v1/invite` with the
   full id array. If resolution fails anywhere, exit 2 with every bad name and send
   nothing.
4. Partition the response into `invited` and `skipped` (the backend filters existing
   members). All-skipped is exit 0 with a plain statement, not an empty block.
5. Client-side permission guard: the caller must host the event or be a member. This
   covers the backend's missing check — implement it as a guard with a comment saying it
   is not a security boundary.
6. `404 event-not-found` is reported as not-found, never translated to "no access" — the
   two are indistinguishable and guessing leaks whether an event exists.
7. Echo resolved names **and** ids everywhere, so the caller can audit who was reached.

## Validation

- [ ] `rsvp yes` sets status and echoes the post-change `going` count
- [ ] Every status including `omw` and `none` works; `none` withdraws
- [ ] `omw` confirmation states that location sharing started
- [ ] Re-setting an existing status is exit 0 with a no-op note
- [ ] An event id the user can't see reports not-found without implying access
- [ ] `invite` with one name resolves, invites, and echoes name + id
- [ ] `invite` with several names issues **one** call, not one per person
- [ ] `invite` with one ambiguous name among several sends **nothing** and names all bad ones
- [ ] Re-inviting an existing member reports `skipped`, exit 0
- [ ] All-skipped states so plainly rather than printing an empty `invited` block
- [ ] Inviting to an event the caller neither hosts nor belongs to exits 2
- [ ] Output never claims a notification was delivered
- [ ] Integration tests run against a dev instance with invented people — never production

## Risks / unknowns

- **This plan can notify real humans.** Manual verification must happen on a dev instance
  or with the implementer's own second account. Under no circumstances test invite fan-out
  against a production friend graph.
- **Idempotence is the backend's, not ours.** We rely on `invite` skipping existing
  members. Verify that directly rather than trusting the source reading — a duplicate
  invitation is a duplicate notification.
- **The permission guard will be wrong somewhere.** It reimplements a rule the server
  doesn't state. Prefer refusing a legitimate invite (recoverable, visible) over allowing
  an illegitimate one.

## Notes

## Follow-ups
