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
| `topic` | uuid → topics | nullable |
| `start_time_min` | timestamptz | **required** — earliest the host expects to start |
| `start_time_max` | timestamptz | **required** — latest |
| `end_time` | timestamptz | nullable |
| `location_description` | text | freeform; the human-readable place |
| `rally_point` | geography(Point) | write as WKT, read via `rally_point_text` |
| `trail` | geography(LineString) | write as WKT, read via `trail_text` |
| `link` | text | external URL |
| `notes` | text | freeform body |
| `banner_photo` | text | URL |

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

**Unverified:** the exact draft response shape, and which source scrapers exist. Confirm
during implementation.
