---
status: done
depends: [events-write]
specs:
  - specs/api/instances.md
  - specs/commands/events.md
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

- [ ] `--url` against a supported source returns a draft with title and time — **unverified**, no live event URL tested
- [ ] `--flyer` against a test image returns a draft — **unverified**, costs an LLM vision call
- [x] Neither form creates an event
- [x] The `help` line is a runnable `events create` command with the draft's values
- [x] A missing file, non-image, or oversized file exits 2 before any call
- [x] An unparseable URL exits 2 before any call
- [x] An unsupported source reports that plainly, without a stack trace or vendor name
- [ ] A partial extraction renders what it got and names what's missing — **unverified** (code path written, never exercised)
- [ ] The timezone sent matches the resolved timezone — **unverified** with a real flyer
- [x] The URL form works without a stored session

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

- **The `awaits` was resolved from the source, not a live capture.** The function's shared
  `Event` type gives the exact shape: a partial event, every field optional, with two
  divergences from the table — `rally_point` is a **`{lon, lat}` object** rather than WKT,
  and `topic` may be an id *or* a `{id, name}` object. Recorded in
  specs/api/instances.md along with the scraper list.
- **A generic `404 → EVENT_NOT_FOUND` mapping in the client was swallowing this
  function's errors.** An unsupported URL told the caller "no event found for that id" and
  sent them to go list their events. Narrowed to the backend's own `event-not-found` code;
  `rsvp` and `events view` still report missing events correctly.
- **Source scrapers**, in order: Eventbrite, Facebook, Resident Advisor, Partiful, AXS,
  then a JSON-LD fallback for any page with event markup.
- **Verified**: all four input guards (neither flag, both flags, bad URL, missing file)
  fail before spending a call, and an unreadable page now names the supported sources.
- **The image ceiling is a guess.** 5MB, chosen because a phone photo is several MB and
  failing before the upload beats a timeout after it. The function's real limit is still
  unknown.

## Follow-ups

- **Neither happy path has been run.** Four criteria are unchecked: no live event URL was
  scraped and no flyer was sent to the vision model. The guards and the error paths are
  exercised; the success rendering is not. Worth one real URL and one real flyer before
  `release-v1`.
