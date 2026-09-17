---
status: planned
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

- [ ] `friends` lists accepted friends alphabetically with exactly `name,id`
- [ ] No phone number, photo URL, or push token appears in any output
- [ ] Both FK-aliased embeds resolve in one query, against the real schema
- [ ] Requester and requestee sides both collapse to the correct other person
- [ ] Exact "Chris" is not drowned out by Christine/Christopher/Chrischi (tier stops)
- [ ] Zero matches exits 2 with the search command and the friend count
- [ ] 2+ matches exits 2 listing every candidate with its id
- [ ] `resolveAll` with one bad name among several returns an error naming **all** bad
      names and no ids
- [ ] Matching is case-insensitive and handles single-word and non-Latin display names
- [ ] `--pending` shows direction and age for incoming and outgoing requests
- [ ] Fixtures contain only invented people

## Risks / unknowns

- **The ladder is a judgment call.** Real graphs have nicknames, emoji and initials-only
  names that no tier matches. The mitigation is that failure is cheap and loud: an
  unmatched name lists the search command. Watch for cases where it's *annoying* and
  resist the urge to fix them by loosening into guessing.
- **`get-friends-network` may change the data shape** — confirm before building the
  listing on the raw query, or accept a refactor later.

## Notes

## Follow-ups
