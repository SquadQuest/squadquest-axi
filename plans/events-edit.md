---
status: done
depends: [events-write]
specs:
  - specs/commands/events.md
  - specs/api/instances.md
---

# Plan: edit a posted event in place

## Scope

`events edit <id>`, `events uncancel <id>`, rejecting unexpected positionals across the
CLI, requiring `--topic` on create, and renaming "rally window" to "arrival window".

Out of scope: editing anything about *people* on an event (that's `invite` / `rsvp`).

## Why this exists

Reported from a real agent session (2026-09-18). An agent was asked to change the notes
and times on two events it had just posted. Finding no `edit`, it did the only thing the
tool offered:

1. **Cancelled** a live event to change its notes.
2. Tried `events create <id> --title …` to "reactivate and edit in place". `create`
   **silently ignored the positional id** and inserted a duplicate. The agent reported
   success. It was wrong — the canceled original (`687a244a`) is still canceled and a new
   event (`882b7ee6`) exists beside it.
3. Needed to be told, twice, what `--start` / `--start-max` / `--end` mean.

Three distinct defects, in descending severity:

- **A silently wrong result.** Extra positionals were dropped, so the agent got
  plausible-looking output for an operation that did something else entirely. AXI §6 calls
  this out by name: "a dropped flag is worse than an error."
- **A destructive-only path.** Cancel-to-edit notifies every `yes`/`maybe`/`omw`
  attendee that the thing is off, discards their RSVPs, and strands a dead row that
  cannot be deleted. The backend has supported `PATCH` all along — confirmed live for
  `title`, `notes`, `start_time_max` and `status` — so the tool was withholding a
  capability that exists, and the destructive workaround was the only thing on offer.
- **Under-explained domain vocabulary.** "Rally window" means nothing to a caller who
  hasn't read the spec.

A fourth defect surfaced from the same session: **an event this tool created with no
topic crashed the v1 clients** until a topic was added by hand. The column is nullable,
so nothing upstream prevented writing data that broke the product for every viewer.

## Implements

- `specs/commands/events.md` — `events edit`, the reversibility note on `cancel`, the
  arrival-window wording
- `specs/api/instances.md` — editing is a plain `PATCH`; webhooks handle fan-out

## Approach

1. `updateEvent(id, patch)` in `squadquest/write-events.ts`, alongside `cancelEvent`.
2. `events edit <id>` reuses `create`'s parsing and validation, then sends **only** the
   fields given. Window checks need the *merged* values — changing just `--start` must be
   validated against the stored `start_time_max`, not against nothing.
3. Report changed fields as `field: old → new`. Unchanged fields aren't mentioned.
4. `--uncancel` sets `status: live`.
5. **Reject unexpected positionals** in `parseFlags`, so the original mistake fails loudly
   everywhere rather than being fixed only for `create`. Commands that legitimately take
   positionals declare how many.
6. Rename the flag help, and make `cancel`'s confirmation name the undo.

## Validation

- [x] `events edit <id> --notes "..."` changes only the notes
- [x] The output reports each changed field old → new, and omits untouched ones
- [x] `events edit <id>` with no flags exits 2
- [x] Editing only `--start` validates against the *stored* `start_time_max`
- [x] An invalid window is rejected before the write, as in `create`
- [x] `events uncancel <id>` returns a canceled event to `live` (its own verb, not a flag)
- [x] A non-host editing exits 2
- [x] `events create <id> --title x` now exits 2 instead of silently creating a duplicate
- [x] Unexpected positionals are rejected on every command that doesn't take them
- [x] Commands that do take positionals (`view`, `cancel`, `invite`, `rsvp`) still work
- [x] Flag help says "arrival window" and distinguishes it from `--end`
- [x] `cancel` tells the caller it can be undone
- [x] `docs:check` passes after regenerating the skill

## Risks / unknowns

- **Which fields a webhook actually notifies on is unverified.** `set-event-end-time`,
  `set-event-topic` and `update-event-rallypoint` exist, so those three plus status are
  covered; a title or notes change may notify nobody. Don't claim attendees were told.
- **Positional rejection could break a working invocation.** `invite` takes a variable
  number, `rsvp` and `view` take one. Getting the per-command allowance wrong turns a
  silent-success bug into a loud-failure bug, which is better but still a bug.

## Notes

- **The severity order held.** The silent duplicate was the worst of the four, and it was
  the one the agent never noticed: it reported success for an operation that created a
  second event and left the canceled original behind.
- **`topic` is nullable in the schema and required in practice.** A survey of the
  production instance found zero null-topic events, consistent with the app never
  producing one. Now required on create and impossible to clear on edit, with the reason
  recorded in specs/api/instances.md rather than left as a mysterious guard.
- **`uncancel` is a verb, not `edit --uncancel`.** A flag hides the undo inside a command
  a panicking caller has no reason to open; the pair `cancel` / `uncancel` is visible in
  the command list and in `--help`.
- **`cancel` now reads as a message to guests**, not a record operation: it reports
  `told_its_off: N guests` and its help offers both the undo *and* `edit`, because the
  moment just after cancelling is when a caller discovers they picked the wrong verb.
- **Edit is surfaced in four places** — `events view` hints, after `create`, in `cancel`'s
  output, and in the `events --help` footer, which states the distinction outright.
- **Edit validates the merged window**, so changing only `--start` is checked against the
  stored `start_time_max` rather than against nothing.
- **Verified live** on a real event: a round-trip edit of the arrival window reported
  `arrival until 8:00 PM → 7:30 PM` and back, and an edit whose value matched the stored
  one correctly reported "nothing to change".

## Follow-ups

- **Which fields actually notify is still unverified.** Webhooks exist for status, end
  time, topic and rally point; a title or notes edit may notify nobody. The command
  deliberately never claims attendees were told.
- The topic-crash report came from the owner observing broken clients; the specific client
  failure mode was not reproduced here. The guard is right either way, but the underlying
  v1 bug is unfixed and this tool is only one of several ways to write a null topic.
