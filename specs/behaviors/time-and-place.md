# Behavior: time and place

Humans say "next Tuesday at 7pm at the arena". The backend wants UTC ISO-8601 and
`POINT(lon lat)`. This is the translation layer, and both directions have a trap.

## Time in

Timed inputs accept, in order of preference:

1. **ISO-8601 with offset** — `2026-10-19T19:00:00-04:00`. Unambiguous, always correct.
2. **Local wall clock** — `2026-10-19T19:00` or `2026-10-19 19:00`, interpreted in the
   **resolved timezone** (below).
3. **Date only** — `2026-10-19`, meaning local midnight. Rarely what anyone wants for an
   event; accepted for filters.

Relative expressions (`tomorrow`, `next tuesday`, `+2h`) are **not** parsed. A CLI that
guesses what "next Tuesday" means near a week boundary produces an event on the wrong
day, and the caller has an actual calendar. The agent resolves relative dates and passes
a concrete one; the error for an unparseable value says so.

### The resolved timezone

In order: `--timezone <iana>`, then `SQUADQUEST_AXI_TIMEZONE`, then the system zone.
Whichever is used, **timed output states the zone** so a caller in a different zone than
the event can't misread it.

### The DST trap

Wall-clock inputs must be converted through a real IANA zone, never a fixed offset cached
from "now". An event two weeks out can fall on the other side of a DST boundary: entering
`19:00` for a date after the change and applying today's offset produces an event an hour
wrong. Convert per-instant, not per-session.

## Time out

Rendered in the resolved timezone with the zone named, never as raw UTC — a caller
reading `22:00Z` for a 6pm rally has to do arithmetic to sanity-check it, and will
eventually do it wrong.

The rally window is **two** timestamps ([api/instances](../api/instances.md)) and renders
as a window (`6:00-6:45 PM EDT`), not as a single start time. Collapsing it hides a real
domain concept.

## Place in

`--location` is the freeform human description and is what people actually read. It is
required for an event; a rally point without a description is a pin nobody can
interpret in a text notification.

`--rally-point` is optional and accepts `<lat>,<lon>` — **latitude first**, the order
every mapping product and every human uses.

## The coordinate-order trap

The backend stores WKT, which is `POINT(lon lat)` — **longitude first**. The client
accepts lat,lon and emits lon,lat.

Getting this backwards is silent and nearly undetectable in testing: swapped
Philadelphia coordinates land in Xinjiang, which no assertion catches unless it looks.
Per [principles § absorb the quirk](../principles.md) the swap happens once, in the
adapter, with a comment pointing here — never in command code.

Reads come back through `rally_point_text` / `trail_text`, since the geometry columns
themselves read as binary.

### Validation

Reject out-of-range values before sending (`lat` in -90..90, `lon` in -180..180). This
catches the reversed-argument mistake for most of the populated world, though not for
low-latitude longitudes — so it is a safety net, not the guarantee. The guarantee is that
the swap exists in exactly one place.

## Sanity checks on windows

Rejected with exit 2 before any call:

- `start_time_max` earlier than `start_time_min`
- `end_time` earlier than `start_time_max`
- a window longer than 24 hours (almost certainly a date-entry mistake)

A start time in the past is **allowed** — backfilling an event that already happened is
legitimate — but is noted in the confirmation so it isn't silently wrong.
