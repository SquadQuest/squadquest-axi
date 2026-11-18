---
status: in-progress
depends: [guest-notes]
specs:
  - specs/api/guests.md
  - specs/commands/guests.md
---

# Plan: show guests' plus-ones and a headcount

## Scope

Guests can say how many extra people are coming with them (0–9) on the RSVP page. Show
it to the host in `guests list` (both views), next to the answer, with a headcount per
event of yes and maybe plus their plus-ones. Read-only: no command writes plus-ones.

The plus-ones themselves are a backend change on its `feat/guest-rsvp-plus` branch (v1,
stacked on the notes branch): column `instance_guests.plus` (0–9, default 0), the open
link's cap counting them, the `guest-rsvp` function accepting and returning `plus`.
Out of scope: the RSVP page, writing plus-ones from the CLI, plus-ones in the `links`
export (per guest, while plus-ones are per guest per event), and showing the plus-ones
part of the cap in `guests open-link` (its `joined` stays `guests_created`).

## Implements

- `specs/api/guests.md`: the `plus` column, its `42703` meaning on an older server, the
  cap counting plus-ones, the function's `plus` field and its omit/zero/range rules.
- `specs/commands/guests.md` § guests list: the optional `plus` column, the headcount
  (header line with `--event`, a `headcount` list without), the "plus-ones
  unavailable" header.

## Approach

1. `src/squadquest/guests.ts`: `listGuestAnswers()` selects `note,plus`; on `42703` it
   steps back to `note` (plus unavailable), then to the bare rows (both unavailable).
2. `src/commands/guests.ts`: a `plus` column after `rsvp`, only when some row has
   plus-ones; a headcount only then; a `plus: unavailable (…)` header when the server
   has no column.
3. Help summary mentions plus-ones; SKILL.md regenerated.

## Validation

- [x] No plus-ones anywhere: output unchanged (no column, no headcount)
- [x] Plus-ones show after the answer in both views; rows without show `0`
- [x] Headcount counts yes and maybe with their plus-ones; a `no` with plus-ones shows
  its number and adds nobody
- [x] Reading plus-ones writes nothing
- [x] A server with notes but no `plus` column (`42703`) still lists answers and notes,
  header `plus: unavailable (server has no plus-ones yet)`; with neither column, both
  headers
- [x] Full test suite, `check` and `docs:check` pass
- [x] Verified against a local backend with the branch's SQL applied (real PostgREST
  v12.2.11 + RLS on supabase/postgres 15.8.1.060, as an authenticated host), including
  the real `42703` after the backend's documented rollback
- [ ] Verified on production with the host's own test event and an invented guest

## Risks / unknowns

- **The backend is not deployed.** Until the plus-ones SQL is applied, `guests list`
  shows the "plus-ones unavailable" header.
- **Plus-ones are guest-typed.** Anyone holding a guest link, or the flyer plus a
  guest's phone number, can set a guest's plus-ones (0–9). The headcount is what guests
  said, not a verified number.
- **`joined` under-reports a link's fill.** The cap now counts plus-ones too, but the
  host cannot read that sum directly; a link can be full while `joined` shows fewer
  than `max_guests`.
