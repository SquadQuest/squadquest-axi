# Command: topics

The tag vocabulary that drives notification matching for `friends` and `public` events.

## topics list

`squadquest-axi topics [list] [--search <text>] [--limit N]`

Default: all topics, alphabetical. The vocabulary is ~100 names and entirely flat, so the
whole thing in one call is cheaper than making an agent paginate to find out whether
`sports.hockey` exists (AXI §2).

```
count: 103
topics[103]{name}:
  ai
  art.projection
  bike.group-ride
  ...
help[2]:
  Run `squadquest-axi topics --search bike` to narrow
  Run `squadquest-axi topics create <name>` to add one
```

One column. Ids exist but nobody types them — commands take topic **names** and resolve
internally.

## topics create

`squadquest-axi topics create <name> [--force]`

Creating a topic is an act of vocabulary design, not a side effect
([api/topics](../api/topics.md)). Anyone can create one, nothing prunes them, and a
typo permanently pollutes a namespace every user shares. So the command guards it:

**Name validation** — `domain.variant`, lowercase, dot-separated, hyphens within a
segment. A name failing the shape is rejected with the convention stated. Single-segment
names are allowed (several exist).

**Near-miss detection** — if the name is close to an existing topic, exit 2 with the
candidates and require `--force`:

```
error: "sports.hocky" is close to an existing topic
code: NEAR_MISS
candidates[1]{name}:
  sports.hockey
help[2]:
  Run `squadquest-axi events create ... --topic sports.hockey` to use the existing topic
  Run `squadquest-axi topics create sports.hocky --force` to create it anyway
```

**Convention hints, not enforcement.** When a proposed first segment is a venue or place
rather than a domain or medium, say so and suggest the alternative — but create it on
`--force`. The two conventions in [api/topics](../api/topics.md) describe the live
vocabulary; they are not rules the backend enforces, and this tool doesn't get to
unilaterally tighten a shared namespace.

Exact duplicate → exit 0, no-op, returns the existing topic (AXI §6).

## Never implicit

`events create --topic <name>` resolves against existing topics and **fails** on unknown,
with the near-matches and the explicit create command. It never creates one as a side
effect of posting an event.

The v1 Flutter client does create topics inline during event save, but only behind an
autocomplete that showed the user the existing options first. This tool has no such
affordance and so does not inherit that behaviour
([api/topics](../api/topics.md)).

## Subscriptions

Deliberately **not** in v1 of this tool. `topic_subscriptions` and `topic_memberships`
both exist and their semantics are unconfirmed ([api/topics](../api/topics.md)); shipping
a subscribe verb against a guess would change what notifications a person receives. Spec
them first.
