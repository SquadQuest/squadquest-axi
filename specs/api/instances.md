# API: instances (events)

An **instance** is an event. The table is `instances`; the v1 client model is
`lib/models/instance.dart`.

## Columns

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | server-assigned |
| `created_at` / `updated_at` | timestamptz | |
| `created_by` | uuid → profiles | the host |
| `status` | enum | `draft` \| `live` \| `canceled` |
| `visibility` | enum | `private` \| `friends` \| `public` |
| `title` | text | required |
| `topic` | uuid → topics | nullable in the schema, **required in practice** — see below |
| `start_time_min` | timestamptz | **required** — earliest the host expects to start |
| `start_time_max` | timestamptz | **required** — latest |
| `end_time` | timestamptz | nullable |
| `location_description` | text | freeform; the human-readable place |
| `rally_point` | geography(Point) | write as WKT, read via `rally_point_text` |
| `trail` | geography(LineString) | write as WKT, read via `trail_text` |
| `link` | text | external URL |
| `notes` | text | freeform body |
| `banner_photo` | text | URL |

## Topic is nullable in the schema and required in practice

The column accepts `NULL`, and an event written with one **crashes the v1 clients** that
try to render it. Observed 2026-09-18: an event this tool created without a topic broke
the app for real users until a topic was added by hand. A survey of the production
instance the same day found **zero** events with a null topic, which is consistent with
the app itself never producing one.

So a client must treat `topic` as required on create, and must never clear it on edit.
The database will happily accept the write; the product will not survive it. This is the
sharpest case of [principles § absorb the quirk](../principles.md) in the API: the
permissive schema is wrong about what the system can actually tolerate.

## The rally window is two timestamps, not one

`start_time_min` and `start_time_max` bracket *when people should show up* — SquadQuest's
model is "we're gathering somewhere between 6:00 and 6:45", not "the event starts at
6:00". Both are required.

This is a genuine domain concept and the command surface must not flatten it to a single
`--start`. A caller who gives one time gets a window with both ends equal, and that
should be a deliberate choice they can see in the confirmation, not a silent default.

## Visibility

| Value | Meaning |
| --- | --- |
| `private` | **invite-only** — only people explicitly invited can see or RSVP |
| `friends` | visible to the host's accepted friends |
| `public` | visible to everyone; matches topic subscriptions |

`private` is the value for "invite-only". There is no separate flag.

## Creating an event

`POST /rest/v1/instances` with `Prefer: return=representation`. The v1 client `upsert`s
the mapped object. Field encoding per
[conventions § data encoding](conventions.md#data-encoding):

```json
{
  "status": "live",
  "visibility": "private",
  "title": "…",
  "topic": "<uuid|null>",
  "start_time_min": "2026-10-19T22:00:00.000Z",
  "start_time_max": "2026-10-19T22:45:00.000Z",
  "end_time": "2026-10-20T01:45:00.000Z",
  "location_description": "…",
  "rally_point": "POINT(-75.172 39.9012)",
  "link": "…",
  "notes": "…"
}
```

**Creating an event is not complete until the host has RSVP'd.** The v1 client follows
every successful save with an `rsvp` call setting the host to `yes`
([members](members.md)). An event whose host has no RSVP row is a malformed event — it
shows no host attending. The client must do both, and treat the pair as one operation.

## Editing an event

Direct `PATCH /rest/v1/instances?id=eq.<id>`. Notification fan-out happens through
database webhooks, so the write is sufficient — see
[conventions § database webhooks](conventions.md#3-database-webhooks--not-callable).

**Cancelling is `status = "canceled"`**, not a delete. The `update-event-status` webhook
notifies every `maybe`/`yes`/`omw` attendee except the host. Deleting the row would
strand attendees with no notice; the client must never delete an event to cancel it.

**There is no delete path at all for a user token.** Confirmed 2026-09-18: `DELETE` on
`instances` and on `instance_members` both return **`200` with an empty array** and change
nothing — RLS has no delete policy, and PostgREST reports a policy-filtered delete as an
empty result rather than an error. So cancel-not-delete is not merely the right design, it
is the only thing the backend permits, and any code that appears to delete an event has
silently done nothing. A client must never report a delete as successful on the strength
of a 200.

## Drafting an event from a URL or flyer

`scrape-event` is **unauthenticated** and returns an event-shaped draft:

- `GET /functions/v1/scrape-event?url=<url>` — runs a chain of source-specific scrapers
- `POST /functions/v1/scrape-event` with `{image, mediaType, timezone}` — extracts from a
  flyer image via an LLM vision model

Both return a draft for review, not a saved event. This is the backend's own
highest-leverage verb and the command surface should expose it
([principles § verbs, not endpoints](../principles.md)).

### The draft response

Confirmed 2026-09-18 from the function's shared `Event` type. The draft is a **partial
event**, every field optional, using the same names as the table with two differences:

| Field | Note |
| --- | --- |
| `title`, `location_description`, `link`, `notes`, `banner_photo` | as the table |
| `start_time_min`, `start_time_max`, `end_time` | ISO strings |
| `rally_point` | **a `{lon, lat}` object**, not the WKT string the table takes |
| `topic` | a topic id *or* a `{id, name}` object |

A partial extraction is the normal case, not an error — a flyer with no year, or a page
with a title and nothing else, still returns something worth showing.

**Source scrapers**, tried in order: Eventbrite, Facebook, Resident Advisor, Partiful,
AXS, then a JSON-LD fallback that works on any page exposing event markup. A URL none of
them can read returns `404` with `{"error": "Failed to load page", "code":
"scraping-failed"}`.
