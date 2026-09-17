# Behavior: name resolution

The rule from [principles § never invent a person](../principles.md), made operational.
Every command that acts on a person routes through this.

## Why this is the sharpest edge in the tool

A normal friend graph is a hundred-plus people with colliding first names, chosen
display names, emoji, single-word handles, and non-Latin script. The failure mode isn't a
confusing error — it's an invitation, or an SMS, delivered to the wrong human. That is
not recoverable by the caller and not visible to them afterward.

So: a wrong match must be impossible to produce silently. Failing is always cheaper than
guessing.

## Accepted inputs

Any command taking a person accepts either form, and the two are never ambiguous because
a uuid is structurally distinguishable:

| Input | Behavior |
| --- | --- |
| uuid | used directly, no resolution |
| name fragment | resolved against the accepted-friends list |

## The matching ladder

Candidates come only from **accepted** friends ([api/friends](../api/friends.md)) —
never from `requested`, `declined`, or the wider `profiles` table. Matching is
case-insensitive and runs in tiers, stopping at the first tier that yields any match:

1. exact full name (`first last`)
2. exact first name, or exact last name
3. prefix match on first or last name
4. substring match anywhere in the full name

A later tier is never consulted once an earlier one matches. This keeps an exact
"Chris" from being drowned out by every "Christine", "Christopher" and "Chrischi".

## The outcomes

**Exactly one match** — proceed, and echo the resolved full name *and* id in the
confirmation so the caller can see who was acted on.

**Zero matches** — exit 2, naming what was searched and how many friends were searched,
with the command to list them. Never fall back to a wider pool.

```
error: no accepted friend matches "cristine"
code: NO_MATCH
help[2]:
  Run `squadquest-axi friends --search cris` to search your friend list
  Run `squadquest-axi friends` to list all 122
```

**Two or more matches** — exit 2 with every candidate and their id, so the agent's next
move is one unambiguous re-invocation. Never pick the "best" one, never pick the first,
never rank by recency or interaction history.

```
error: "chris" matches 4 accepted friends — re-run with an id
code: AMBIGUOUS_NAME
candidates[4]{name,id}:
  Chris Porto,cacf05f1-...
  Christine B-Tastic,a4c7b11b-...
  Christopher Yamas,29823f6e-...
  Christian Kunkel,5ad7bc02-...
```

`AMBIGUOUS_NAME` and `NO_MATCH` are usage errors (exit 2), not operation failures — the
agent's intent could not be determined, so nothing was attempted.

## Multiple people in one command

`invite` takes several people at once, and the backend takes them as an array
([api/members](../api/members.md)). Resolution is therefore **all-or-nothing**: resolve
every name first, and if *any* name is ambiguous or unmatched, exit 2 having invited
nobody.

A partial invite is the worst possible outcome — some people notified, the caller
uncertain who, and no clean retry. Report every problem name in one error so the caller
fixes them all in a single correction.

## What never resolves a name

- **`send-friend-request` takes a phone number, never a name.** It can text someone
  outside the graph ([api/friends](../api/friends.md)), so there is nothing to fuzzy
  match against and no fuzzy input is accepted.
- Event ids, topic names, and other non-person identifiers have their own rules; a topic
  near-miss fails with candidates rather than creating
  ([api/topics](../api/topics.md)).
