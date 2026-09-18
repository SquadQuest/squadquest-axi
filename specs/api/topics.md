# API: topics

Topics are a flat, user-extensible tag vocabulary. They drive notification matching for
`public` and `friends` events — a member subscribes to topics and gets told when a
matching event is posted.

## Columns

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `name` | text | the whole taxonomy, see below |
| `created_by` | uuid → profiles | anyone can create one |
| `created_at` | timestamptz | |

## The naming convention

Names are `domain.variant`, lowercase, dot-separated, hyphenated within a segment:
`music.concert`, `bike.group-ride`, `drinks.happy-hour`, `run.race`.

Two rules hold across the live vocabulary and the client should honour both when
suggesting a name:

1. **The first segment is a domain or medium, never a venue or place.** `music`, `art`,
   `bike`, `run`, `nerding`, `politics`, `party`, `food`. There is no venue-prefixed
   topic.
2. **The prefix does not encode spectate-vs-participate.** `bike.race` you ride,
   `tv.formula1` you watch, and `politics.rally` / `politics.watch` split that
   distinction in the *second* segment. A new topic that needs the distinction puts it
   there too.

Some single-segment names exist (`movie`, `camp`, `yoga`, `democracy`), as do obvious
accidents (`test`, `test.test`, `whoops`, `gsghsh`). The vocabulary is unmoderated. The
client should neither clean it up nor treat malformed names as errors.

## Reading

```
GET /rest/v1/topics?select=id,name&order=name
```

Cheap and fully readable. The v1 client keeps a topics cache; this client should
similarly avoid re-fetching within one invocation.

## Creating

```
POST /rest/v1/topics
{ "name": "sports.hockey" }
```

`created_by` is populated from the authenticated user. Direct PostgREST write — no edge
function, no notification.

**Creating a topic is a real act of vocabulary design**, not a side effect. Because
anyone can create one and nothing prunes them, a client that auto-creates a topic from a
typo permanently pollutes a shared namespace for every user. So:

- Never create a topic implicitly as part of creating an event.
- When an event names a topic that doesn't exist, fail with the near-matches and the
  explicit create command.
- On create, if the name is a near-miss for an existing topic, say so and require
  confirmation.

The v1 Flutter client does have a "phantom topic" upsert path that creates a topic
inline during event save. That is a UI affordance backed by an autocomplete that showed
the user the existing options first. This client has no such affordance, so it does not
inherit that behaviour.

## Subscriptions

`topic_subscriptions` and `topic_memberships` exist and back the notification matching.

**Unverified:** their columns and semantics, and how the two differ. Confirm during
implementation before exposing any subscribe/unsubscribe verb.
