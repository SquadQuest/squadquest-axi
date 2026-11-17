---
status: in-progress
depends: [rsvp-invite, events-read]
specs:
  - specs/api/guests.md
  - specs/commands/guests.md
  - specs/principles.md
---

# Plan: guests who have not registered

## Scope

`guests list|add|links|remove|open-link`: let a host invite people who have no
SquadQuest account, hand each a private link, and see their answers. Also one open link
per event for a printed flyer.

Pilot. It depends on new backend tables and the `guest-rsvp` function that live on the
backend's `feat/guest-rsvp` branch (v1). Out of scope: sending texts, QR codes, the
static page itself, showing guests in the app.

## Implements

- `specs/api/guests.md`: the three tables, why writes go to tables directly, the link
  format.
- `specs/commands/guests.md`: the five subcommands, their gates and outputs.
- `specs/principles.md` § 2: the guest exception to "edge functions, not tables".

## Approach

1. `src/squadquest/guests.ts`: reads and writes over the existing PostgREST client, plus
   a `remove()` (DELETE) in `client.ts`. A missing table maps to `GUESTS_UNAVAILABLE`.
   Matching rules (phone, then phoneless name, then name) and link building live here,
   not in the command.
2. `src/commands/guests.ts`: parse, call, render. All `--event`s are validated before
   any write.
3. Every write is read back: attached rows, deleted guests and rows, open/closed links.
4. Gates per the spec: `--discard-answer` for detaching an answered guest,
   `--confirm "<name>"` for deleting a guest, `--confirm` for an open link on a
   non-public event.
5. `--json-out[=path]` on `links` only, via `src/output/export.ts` ported from the
   canonical export writer (per-user temp dir, private, exclusive create).
6. Register in `cli.ts`, `flags.ts`, `reference.ts`; regenerate SKILL.md; README.

## Validation

- [x] `guests add` creates once and attaches to every `--event`; a re-run reports `exists` and `already`
- [x] `add` with a phone reuses the guest with that phone; adopts a phoneless same-name guest
- [x] `add` without a phone and two same-name guests exits 2 with both ids, writing nothing
- [x] `add` with an event you did not create exits 2 and writes nothing
- [x] `add` reports `confirmed: false`, exit 1, when an attached row is not read back
- [x] `list` shows name, event, rsvp, id and no phone; `--event` totals the answers
- [x] `links` builds `?t=` (and `&t=` when the base has a query) and prints phone
- [x] `links --json-out` writes the file with the same keys and stdout gains only `wrote:`/`columns:`/hint
- [x] `links --json` is refused with a hint to `--json-out`
- [x] `remove --event` of an answered guest needs `--discard-answer`; unanswered goes straight through
- [x] `remove` without `--event` needs `--confirm` matching the stored name
- [x] `open-link` creates once, then reports `exists` with the same link
- [x] `open-link` on a non-public event needs `--confirm`
- [x] `open-link --close` closes; with nothing open it is a no-op, exit 0
- [x] a missing guest table is `GUESTS_UNAVAILABLE`, never an empty list
- [ ] Verified against a local backend with the branch's tables loaded
- [ ] Verified on production with the host's own test event and an invented guest

## Risks / unknowns

- **The backend is not deployed.** Until it is, the commands fail with
  `GUESTS_UNAVAILABLE`.
- **Links are credentials.** `links` prints them by design; the export file is `0600`.
- **Field-by-field agreement** with the function and the static page is checked by hand
  in the pilot's cross-check, not by a shared schema.
