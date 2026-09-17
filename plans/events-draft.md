---
status: planned
depends: [events-write]
specs:
  - specs/api/instances.md
  - specs/commands/events.md
awaits:
  - "scrape-event response shape — undocumented; must be captured live before the renderer is written"
---

# Plan: drafting events from a URL or flyer

## Scope

`events draft --url <url>` and `events draft --flyer <path>`, wrapping the backend's
`scrape-event` function.

Deliberately last among the feature plans: it depends on `events create`'s flag shape
(the draft renders as a filled-in create command) and it has the most unknowns.

## Implements

- `specs/api/instances.md` — the `scrape-event` GET and POST forms
- `specs/commands/events.md` — `events draft`

## Approach

1. `GET /functions/v1/scrape-event?url=…` for the URL form. The function is
   **unauthenticated**, so this works without a session — but the command should still
   behave sanely for a logged-out user rather than assuming one.
2. `POST` with `{image, mediaType, timezone}` for the flyer form: read the file,
   base64-encode, infer `mediaType` from the extension, and send the resolved timezone
   (the vision model needs it to place bare clock times on a date).
3. Render the draft **in create-flag shape**, so accepting a good draft is one paste. The
   `help` line is the filled-in `events create` invocation.
4. **Save nothing.** A scraper that posted would turn a bad parse into a notification.
5. Guard inputs before spending a call: file exists, is an image, is within a sane size,
   and the URL parses.
6. Partial extractions are the normal case, not the error case. Render what came back and
   mark what's missing — a draft with no time is still worth showing.

## Validation

- [ ] `--url` against a supported source returns a draft with title and time
- [ ] `--flyer` against a test image returns a draft
- [ ] Neither form creates an event
- [ ] The `help` line is a runnable `events create` command with the draft's values
- [ ] A missing file, non-image, or oversized file exits 2 before any call
- [ ] An unparseable URL exits 2 before any call
- [ ] An unsupported source reports that plainly, without a stack trace or vendor name
- [ ] A partial extraction renders what it got and names what's missing
- [ ] The timezone sent matches the resolved timezone
- [ ] The URL form works without a stored session

## Risks / unknowns

- **Response shape is unknown** (`awaits:`). Capture a real response for both forms before
  writing the renderer, and update `specs/api/instances.md` with what comes back — that's
  a spec correction, not an implementation detail.
- **Which source scrapers exist is unknown.** The chain tries each in order; the failure
  message for "no scraper matched" needs to be honest without listing internals.
- **LLM extraction is nondeterministic**, so tests can't assert exact field values.
  Assert shape and required-field presence, not content.
- **Image size limits are unknown** — a phone photo is several MB and may exceed a
  function payload cap. Find the ceiling and fail before the call, not after.

## Notes

## Follow-ups
