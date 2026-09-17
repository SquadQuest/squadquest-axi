---
status: planned
depends: [client-auth]
specs:
  - specs/api/instances.md
  - specs/api/members.md
  - specs/behaviors/time-and-place.md
  - specs/commands/events.md
  - specs/commands/home.md
---

# Plan: reading events + the home view

## Scope

`events list`, `events view`, and the no-args home view — plus the time/place rendering
layer they share.

The first plan that produces something genuinely useful: after it, an agent can open a
session and see what's coming up.

Out of scope: creating, cancelling, drafting (`events-write`, `events-draft`); RSVP and
invite (`rsvp-invite`). The hook that runs home on session start is `home-hooks-docs`.

## Implements

- `specs/api/instances.md` — columns, `rally_point_text` reads, the rally window
- `specs/api/members.md` — reading the guest list, the two-FK embed hazard
- `specs/behaviors/time-and-place.md` — the "time out" and coordinate-read halves
- `specs/commands/events.md` — `list` and `view`
- `specs/commands/home.md` — the whole document

## Approach

1. `time/` — format an instant in the resolved timezone, naming the zone; render a rally
   window as a range and collapse it only when both ends are equal.
2. Read geometry via `rally_point_text` / `trail_text` and parse WKT back to lat,lon for
   display — the swap lives in the adapter, once.
3. Event listing: everything the user hosts or has an `instance_members` row for.
   Establish whether one query with an `or` filter covers both, or two merged queries.
4. `going` count (`yes` + `omw`) as a pre-computed aggregate. Prefer a PostgREST
   aggregate over fetching member rows per event — a home view that costs N+1 queries
   will be felt on every session start.
5. Guest list in `view` resolves profiles in a second call (the `member:profiles(...)`
   embed fails on the two-FK ambiguity) — batch one `profiles?id=in.(…)` rather than
   per-guest calls.
6. Notes truncate at 500 chars with the total, `--full` offered only when truncated.
7. Home view: cap 5 events × 5 columns, add the `invitations:` count, and render the
   unauthenticated variant **without** erroring.

## Validation

- [ ] `events` lists upcoming soonest-first with the real total, not the page size
- [ ] `--past` reverses ordering and window
- [ ] Times render in the resolved zone with the zone named — never raw UTC
- [ ] A rally window renders as a range; equal ends render as a single time
- [ ] `rally_point_text` round-trips to the same lat,lon that was written
- [ ] `events view` shows the guest list without an embed error
- [ ] Notes over 500 chars truncate with the total and offer `--full`; shorter ones don't
- [ ] `going` counts `yes` + `omw` only
- [ ] Home caps at 5 events and stays within its token budget
- [ ] Home with no upcoming events states the zero with context
- [ ] Home unauthenticated exits **0** and points at login
- [ ] Home issues a bounded number of queries regardless of event count

## Risks / unknowns

- **Home view query cost.** It runs on every session. If the aggregate can't be done
  server-side cheaply, cap the work rather than the correctness — and say so in the spec.
- **"Events I'm involved in" may not be one query.** RLS visibility plus hosting plus
  membership could need a union. Measure before assuming.

## Notes

## Follow-ups
