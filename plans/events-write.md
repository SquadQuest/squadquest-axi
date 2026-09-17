---
status: planned
depends: [events-read]
specs:
  - specs/api/instances.md
  - specs/api/topics.md
  - specs/behaviors/time-and-place.md
  - specs/commands/events.md
  - specs/commands/topics.md
---

# Plan: creating and cancelling events + topics

## Scope

`events create`, `events cancel`, `topics list`, `topics create`, and the "time/place in"
half of the parsing layer.

Topics ride along because `events create --topic` resolves against them and the two
would otherwise land half-built.

Out of scope: `events draft` (`events-draft`), topic subscriptions (unspecced,
deliberately deferred).

## Implements

- `specs/api/instances.md` — the create payload, cancel-is-status-not-delete
- `specs/api/topics.md` — the naming convention and its two rules
- `specs/behaviors/time-and-place.md` — the "time in" and "place in" halves, the DST trap,
  the coordinate swap and its validation, window sanity checks
- `specs/commands/events.md` — `create`, `cancel`
- `specs/commands/topics.md` — the whole document

## Approach

1. Time parsing: ISO-with-offset, local wall clock, date-only. **No relative expressions**
   — an unparseable value errors saying so. Convert wall clock through a real IANA zone
   per-instant so a future date across a DST boundary is correct.
2. Window sanity checks before any call: max < min, end < max, window > 24h → exit 2.
   A past start is allowed but noted in the confirmation.
3. `--rally-point` takes **lat,lon**; the adapter emits `POINT(lon lat)`. Range-validate
   both, and put the swap in exactly one function with a comment pointing at the spec.
4. Topic resolution by name against a cached list; unknown → exit 2 with near-matches and
   the create command. **Never auto-create.**
5. `events create` = insert with `Prefer: return=representation`, then `POST
   /functions/v1/rsvp` setting the host `yes`. Treat as one operation: if the RSVP fails,
   report the created event id **and** the failure with the fixing command. Never a bare
   success, never a silently orphaned event.
6. `events cancel` = `PATCH status=canceled`. Host-only check client-side. Idempotent.
   Confirmation states how many attendees are being notified.
7. `topics create` — shape validation, near-miss detection (edit distance over the live
   vocabulary), `--force` to override, convention hints that inform but don't block.

## Validation

- [ ] Wall-clock input converts correctly across a DST boundary for a future date
- [ ] ISO-with-offset input is used verbatim
- [ ] A relative expression like `tomorrow` exits 2 saying relative dates aren't parsed
- [ ] max < min, end < max, and >24h windows each exit 2 before any network call
- [ ] A past start is accepted and flagged in the confirmation
- [ ] `--rally-point 39.9012,-75.172` round-trips to the same point (not Xinjiang)
- [ ] Out-of-range coordinates exit 2
- [ ] `--visibility` defaults to `friends`; `private` produces an invite-only event
- [ ] Omitting `--start-max` yields an equal-ended window, stated in the confirmation
- [ ] An unknown `--topic` fails with near-matches and creates nothing
- [ ] `events create` leaves the host RSVP'd `yes`
- [ ] A simulated RSVP failure still reports the event id and the fixing command
- [ ] `events cancel` sets status, never deletes the row
- [ ] Cancelling twice is exit 0 with a no-op note
- [ ] A non-host cancelling exits 2 with the reason
- [ ] `topics create` rejects a malformed name, flags a near-miss, honors `--force`
- [ ] An exact-duplicate topic is exit 0 returning the existing one

## Risks / unknowns

- **The create+RSVP pair isn't transactional.** No rollback exists — the mitigation is
  honest reporting, not a fake atomic. Get that error path right; it's the one a user
  will actually hit.
- **Near-miss thresholds are a tuning problem.** Too tight and typos sail through, too
  loose and `--force` becomes reflexive. Start conservative and note real misses.
- **No server-side host check on cancel** is assumed but unverified — the client guard
  may be the only one. Confirm and record it.

## Notes

## Follow-ups
