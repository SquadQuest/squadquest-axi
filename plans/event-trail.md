---
status: done
depends: [event-banner]
specs:
  - specs/api/instances.md
  - specs/commands/events.md
---

# Plan: GPX trails

## Scope

`--trail <file.gpx>` on `events create` and `events edit`, `--clear-trail` on edit, and
showing the route in `events view`.

Out of scope: editing a route point-by-point (that's the app's map UI), and exporting a
trail back out as GPX.

## Why this exists

`trail` is the same blind spot `banner_photo` was: a live field the app exposes, **45
production events already use it**, and `trail_text` isn't in the CLI's column list — so
`events view` on a mapped bike ride silently omits the route.

The app already defines the behaviour, so this is a mirroring job, not a design one.

## Implements

- `specs/api/instances.md` § trails — the app's exact GPX semantics
- `specs/commands/events.md` — `--trail`, `--clear-trail`

## Approach

Mirror `lib/ui/core/widgets/rally_point_map.dart` deliberately, including the parts that
look like omissions — differing would make events inconsistent depending on which tool
made them.

1. Parse GPX: take **the first `<trk>`'s first `<trkseg>`** and its `<trkpt>` elements in
   document order. Ignore further tracks/segments and ignore `<rte>`/`<wpt>`. Drop points
   missing `lat` or `lon`. Handle either attribute order.
2. **No simplification and no point cap.** The app sends everything, and the geometry
   goes in the request body, so there is no URL-length pressure to design around.
3. Emit `LINESTRING(lon lat,…)` through the same lon-first swap the rally point uses.
4. **Side effect, faithfully copied:** if the event has no rally point, set it to the
   first trail point. Never overwrite an existing one.
5. No track in the file → exit 2 saying so, before anything is written.
6. `--clear-trail` writes `NULL` (not an empty `LINESTRING()`).
7. Add `trail_text` to the read columns and summarise it in `events view` as a point
   count plus total length.

## Validation

- [x] `--trail ride.gpx` on create attaches a route that reads back with the same points
- [x] Only the first track's first segment is taken when a file has several
- [x] A `<rte>`/`<wpt>`-only file errors rather than silently attaching nothing
- [x] A file with no track exits 2 before any write
- [x] Malformed XML exits 2 with a clear message, not a stack trace
- [x] Points with missing lat/lon are dropped, not sent as nulls
- [x] Either attribute order (`lat` first or `lon` first) parses
- [x] The stored LINESTRING is lon-first and round-trips to the original lat/lon
- [x] Uploading a trail sets the rally point when none exists
- [x] Uploading a trail does NOT overwrite an existing rally point
- [x] `--clear-trail` writes NULL and `events view` stops showing a route
- [x] `events view` reports point count and route length
- [x] A dense real-world track (1000+ points) writes successfully

## Risks / unknowns

- **Regex-parsing XML is fragile.** GPX is regular enough that it's tolerable, but a file
  with namespaced elements or `<trkpt>` inside a comment could fool it. Prefer a scan that
  anchors on the first `<trkseg>`…`</trkseg>` and fails loudly rather than guessing.
- **Very dense tracks are untested at the top end.** No cap is faithful to the app, but
  nobody has proven where the backend gives up. Find out rather than assume.
- **The rally-point side effect surprises people.** It's the app's behaviour, so it stays,
  but the confirmation must say it happened.

## Notes

- **Mirrors the app exactly, including what looks like omissions.** First track, first
  segment, no simplification, `<rte>`/`<wpt>` ignored. Verified with a two-track /
  two-segment fixture that yields 2 points, not 4.
- **The rally-point side effect is real and worth knowing**: uploading a trail to an event
  with no rally point sets one from the first trail point, and the confirmation says so.
  An existing rally point is left alone — verified live in both directions.
- **My earlier worry about point count was wrong.** I had assumed a dense track would need
  simplification because of URL length; the geometry travels in the request **body**, so
  there is no ceiling to design around. A real 1500-point track wrote cleanly and read
  back as `1500 points, 13.0 mi`.
- **A route-or-waypoint-only GPX names what IS in the file** rather than reporting an
  empty track. Strava and some planners export `<rte>`, and "no track found" alone would
  send someone hunting.
- **Parsing is regex over the first `<trkseg>`…`</trkseg>`**, not a full XML parse. Chosen
  to avoid a dependency for a very regular format; it anchors rather than scanning the
  whole document, so it cannot silently merge tracks.
- Testing initially ran the **published 0.3.0 global** instead of the dev build and
  reported `unknown flag --trail`, which looked like the flag hadn't registered. Worth
  remembering: `squadquest-axi` on PATH is the release, `bun bin/squadquest-axi.ts` is
  the working tree.

## Follow-ups

- **No GPX export.** Reading a trail back gives a summary, not a file. If anyone wants to
  round-trip a route out of SquadQuest that is a separate, easy plan.
- **The upper bound on point count is still unknown** — 1500 works, and nothing has been
  pushed past it.
