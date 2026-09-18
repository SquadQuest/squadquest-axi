---
status: done
depends: [client-auth]
specs:
  - specs/api/friends.md
  - specs/behaviors/name-resolution.md
  - specs/commands/friends.md
---

# Plan: friend graph + name resolution

## Scope

Reading the friend graph and the resolver every people-command depends on:
`friends list`, `friends --search`, `friends --pending`, and `src/squadquest/resolve.ts`.

This lands before any command that acts on a person, because the resolver is the guard
that makes those commands safe to ship.

Out of scope: `friends request/accept/decline` (`friend-requests`), invite (`rsvp-invite`).

## Implements

- `specs/api/friends.md` — the two-FK embed disambiguation, narrow profile selects
- `specs/behaviors/name-resolution.md` — the whole document
- `specs/commands/friends.md` — `list`, `--search`, `--pending`

## Approach

1. Fetch accepted friendships with both FK-aliased embeds in one query, then collapse
   requester/requestee to "the other person" relative to the current user.
2. Select only `id,first_name,last_name`. Never `*` — a raw PostgREST read is unscrubbed
   and carries phone numbers and push tokens we must not render.
3. `resolve.ts` — the tiered ladder (exact full → exact first/last → prefix → substring),
   case-insensitive, stopping at the first tier that yields anything. Returns a
   discriminated result: `{kind: "one", …} | {kind: "none"} | {kind: "many", candidates}`.
   Callers can't accidentally treat "many" as success.
4. `resolveAll(names)` for the multi-person case: resolves everything, collects **all**
   failures, and returns either every id or a combined error. No partial success shape
   exists in the type.
5. `friends --search` calls the same resolver so the listing and the matcher can't drift.
6. Evaluate whether `get-friends-network` covers the accepted listing — it scrubs by
   default and would be preferable. Spec'd as unverified; confirm and update the spec
   either way.

## Validation

- [x] `friends` lists accepted friends alphabetically with exactly `name,id`
- [x] No phone number, photo URL, or push token appears in any output
- [x] Both FK-aliased embeds resolve in one query, against the real schema
- [x] Requester and requestee sides both collapse to the correct other person
- [x] Exact "Chris" is not drowned out by Christine/Christopher/Chrischi (tier stops)
- [x] Zero matches exits 2 with the search command and the friend count
- [x] 2+ matches exits 2 listing every candidate with its id
- [x] `resolveAll` with one bad name among several returns an error naming **all** bad
      names and no ids
- [x] Matching is case-insensitive and handles single-word and non-Latin display names
- [x] `--pending` shows direction and age for incoming and outgoing requests
- [x] Fixtures contain only invented people

## Risks / unknowns

- **The ladder is a judgment call.** Real graphs have nicknames, emoji and initials-only
  names that no tier matches. The mitigation is that failure is cheap and loud: an
  unmatched name lists the search command. Watch for cases where it's *annoying* and
  resist the urge to fix them by loosening into guessing.
- **`get-friends-network` may change the data shape** — confirm before building the
  listing on the raw query, or accept a refactor later.

## Notes

- **The tiering in the spec was wrong, and a test caught it.** Splitting "exact full name"
  from "exact first/last" into separate tiers means a friend with **no last name** has a
  full name equal to their first name, wins the earlier tier alone, and silently shadows
  everyone sharing that first name. Typing `Ada` resolved to the lone "Ada" instead of
  reporting her and "Ada Lovelace" as ambiguous — a wrong-person pick with no warning,
  which is precisely the failure this plan exists to prevent. Single-word display names
  are common, so this was the normal case, not an edge case.
  **Fixed in both places**: exact is now one tier, and
  specs/behaviors/name-resolution.md carries a section explaining why.
- **Verified live against a 122-person graph.** `--search chris` returns exactly one (the
  exact first-name tier stopping before prefix), while `--search christ` correctly returns
  three as ambiguous.
- **`resolveAllIn` was extracted as the pure core** of `resolveAll` so the all-or-nothing
  rule is testable without a network.
- **`--pending` suppresses the accept/decline hint when every request is outgoing** —
  found live, where all 8 pending requests were outgoing and the hint pointed at a no-op.
- **Resolution needs a cached self profile** to collapse requester/requestee. An env-only
  token has none, so `friends` fails with `NO_SELF` rather than guessing which side is
  you.

## Follow-ups

- **`get-friends-network` is still unevaluated** (criterion left unchecked). It scrubs
  profiles by default, which would be preferable to the raw PostgREST read this plan
  shipped. Worth confirming before `release-v1`; the read is correct either way, just less
  defensive than the edge function.
