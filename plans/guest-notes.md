---
status: in-progress
depends: [guests]
specs:
  - specs/api/guests.md
  - specs/commands/guests.md
---

# Plan: show guests' notes

## Scope

Guests can leave an optional short note with their answer on the RSVP page. Show it to
the host in `guests list` (both views), next to the answer. Read-only: no command writes
a note.

The note itself is a backend change on its `feat/guest-rsvp-note` branch (v1): column
`instance_guests.note` (≤ 200 characters), the `guest-rsvp` function accepting and
returning it. Out of scope: the RSVP page, writing notes from the CLI, a `note` in the
`links` export (per guest, while a note is per guest per event).

## Implements

- `specs/api/guests.md`: the `note` column, its `42703` meaning on an older server, the
  function's `note` field and its omit/clear/limit rules.
- `specs/commands/guests.md` § guests list: the optional `note` column, the fifth-column
  justification, the "notes unavailable" header.

## Approach

1. `src/squadquest/guests.ts`: `listGuestAnswers()` selects `note` with the answers; on
   `42703` it re-reads without it and reports `notes: "unavailable"`. `listGuestRows()`
   stays as it is for `remove`, so removal never depends on the note column.
2. `src/commands/guests.ts`: a `note` column after `rsvp`, only when some row has a
   note; a `notes: unavailable (…)` header when the server has none.
3. Help summary mentions notes; SKILL.md regenerated.

## Validation

- [x] No note anywhere: output unchanged (no column, no header)
- [x] A note shows after the answer in the all-events view and in `--event`; rows without
  one show `""`
- [x] A note with a comma, quotes and a newline is quoted and escaped, not split into cells
- [x] Reading notes writes nothing
- [x] A server without the column (`42703`) still lists answers, column absent, header
  `notes: unavailable (server has no guest notes yet)`
- [x] Full test suite and `docs:check` pass
- [x] Verified against a local backend with the branch's SQL applied (real PostgREST
  v12.2.11 + RLS on supabase/postgres 15.8.1.060, as an authenticated host), including
  the real `42703` with the column hidden
- [ ] Verified on production with the host's own test event and an invented guest

## Notes

- **Empty cells render as `""`.** The renderer turns null into an empty string and TOON
  quotes it, so a row without a note reads `invited,"",<id>`. Same as an empty `phone`
  in `links`.

## Risks / unknowns

- **The backend is not deployed.** Until the note SQL is applied, `guests list` shows the
  "notes unavailable" header.
- **Notes are guest-typed text.** Anyone holding a guest link, or the flyer plus a guest's
  phone number, can set or clear that guest's note. The host should read it as what
  someone typed, not as verified.
