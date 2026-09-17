# API conventions

The SquadQuest v1 backend is a **self-hosted Supabase** instance. Three distinct call
surfaces sit behind one base URL, and choosing the wrong one is the most consequential
mistake this client can make — see [§ Which surface to use](#which-surface-to-use).

Derived from the v1 Flutter client (`SquadQuest/SquadQuest` branch `v1`) and confirmed
live against production on 2026-09-17.

## Base URL

- Production: `https://supabase.squadquest.app`
- Overridable via `SQUADQUEST_AXI_URL` for self-hosted and local-dev instances.

## Authentication headers

Every request carries **both** headers:

```
apikey: <anon key>
Authorization: Bearer <user access token>
```

### The legacy anon key (important)

The instance publishes two anon keys. **Only the legacy key is accepted.**

| Key | Result |
| --- | --- |
| `SUPABASE_ANON_KEY` | `401` on every request |
| `SUPABASE_ANON_KEY_LEGACY` | works |

The Flutter client probes the new key against `/rest/v1/app_versions?select=*&limit=1`
and falls back to the legacy key when it fails. **This client must implement the same
probe-and-fall-back**, not hardcode either key: the whole point of the app's fallback is
that the instance is expected to migrate to the new key eventually, and hardcoding the
legacy one converts a future migration into an outage.

The keys themselves are public client keys, published in the deployed web app's
`assets/assets/.env`. They are not secrets, but per
[principles § public repo, private lives](../principles.md) they are **not committed to
this repo** — they are fetched or configured at runtime.

## Which surface to use

### 1. PostgREST — `/rest/v1/<table>`

Standard PostgREST. Reads, and writes to `instances`, `topics`, and `profiles`.

**Direct writes to `instances` are correct and do fire notifications**, because the
notification fan-out for event changes is implemented as *database webhooks* (below), not
as something the client calls. Writing the row is the whole job.

Embedded resources need explicit FK disambiguation when a table has two FKs to the same
target — see [friends](friends.md).

### 2. Client-callable edge functions — `/functions/v1/<name>`

`POST` with the same two auth headers. These exist because they do work the client
cannot: they run under the service role, enforce permissions, and **send FCM push
notifications**.

| Function | Purpose |
| --- | --- |
| `invite` | invite users to an event |
| `rsvp` | set your own status on an event |
| `send-friend-request` | friend request by phone |
| `action-friend-request` | accept/decline a friend request |
| `get-profile`, `get-friend-profile`, `get-friends-network` | profile reads |
| `set-chat-last-seen` | mark event chat read |
| `scrape-event` | event draft from a URL or a flyer image (**unauthenticated**) |

**`instance_members` has no safe direct-write path.** Inserting an RSVP or invitation row
via PostgREST creates a correct-looking record and notifies nobody. Per
[principles § notifications are the product](../principles.md), always call the function.

### 3. Database webhooks — not callable

`create-event-message`, `on-profile-insert`, `set-event-end-time`, `set-event-topic`,
`update-event-rallypoint`, `update-event-status` take a Supabase webhook payload
(`{type, table, schema, record, old_record}`) and are fired **by the database** on row
changes. The client never calls them. Their existence is why direct `instances` writes
are sufficient: cancelling an event is an `UPDATE` to `status`, and
`update-event-status` notices and notifies every `maybe`/`yes`/`omw` attendee.

Do not call these. A `404`/`500` from one of them means something is wrong with the
call, not that the operation needs retrying against a different surface.

## Data encoding

| Concern | Wire format | Note |
| --- | --- | --- |
| Timestamps | UTC ISO-8601 (`2026-10-19T22:00:00.000Z`) | users think in local wall clock; convert at the boundary |
| Geometry | WKT `POINT(lon lat)` | **longitude first** — the opposite of how humans write coordinates |
| Trails | WKT `LINESTRING(lon lat,lon lat,…)` | |
| Geometry reads | `rally_point_text` / `trail_text` | the `rally_point` column itself reads back as binary |
| Enums | lowercase strings | `private`/`friends`/`public`, `live`/`draft`/`canceled` |

## Errors

PostgREST returns `{message, code, details, hint}`. Edge functions return
`{error: {message, code}}` with meaningful HTTP statuses (`403 authorized-user-not-found`,
`404 event-not-found`, `400 invalid-action`).

Per AXI §6 none of this reaches stdout raw — the client translates to a structured error
with an actionable `help`, and never names Supabase or PostgREST in a suggestion.

## Session expiry

Access tokens are short-lived; the session carries a `refresh_token`. A `401` on a
previously working call means refresh, then retry once — see [auth](auth.md).
