---
status: done
depends: [friends-resolution]
specs:
  - specs/api/friends.md
  - specs/commands/friends.md
---

# Plan: friend requests

## Scope

`friends request --phone`, `friends accept <id>`, `friends decline <id>`.

A small leaf plan, separated from `friends-resolution` for one reason: `request` can send
an SMS to someone who has never heard of SquadQuest. That deserves its own scope, its own
review, and its own tests.

## Implements

- `specs/api/friends.md` — `send-friend-request`, `action-friend-request`
- `specs/commands/friends.md` — `request`, `accept`, `decline`

## Approach

1. `friends request --phone <e164> [--first-name] [--last-name]`. **No name resolution
   exists on this command** — there is nothing to match against, which is the point.
   Normalize to E.164 client-side and echo the normalized form.
2. The confirmation must distinguish the two outcomes: a request sent to an existing
   member, versus an **SMS invitation sent to a non-member**. The caller should know which
   happened without checking their phone bill.
3. `accept`/`decline` take the **friendship id** from `friends --pending`, matching
   `action-friend-request`. Any action other than the two is rejected client-side.
4. Both are idempotent — re-accepting is exit 0 with a no-op note.

## Validation

- [x] `request` rejects a malformed phone before any network call
- [x] The normalized E.164 number is echoed in the confirmation
- [x] `request` accepts no name-shaped input at all
- [ ] The confirmation distinguishes existing-member request from non-member SMS — **unverified**
- [x] `accept` and `decline` work against ids from `--pending`
- [x] An invalid action value is rejected client-side, before the call
- [x] Re-accepting an accepted friendship is exit 0, no-op
- [ ] The non-member path is exercised against a dev instance — **not done**; no dev instance exists yet

## Risks / unknowns

- **This command spends money and contacts strangers.** A wrong digit texts an
  uninvolved person. The echo of the normalized number is the only safety net that
  exists after the fact — make it prominent, not a footnote.
- **`normalizePhone` is server-side**, so client and server could normalize differently
  and disagree about which number was contacted. Echo what the *server* reports where the
  response makes that available, not only what we sent.

## Notes

- **Verified only on the paths that contact nobody**: a name-shaped `--phone` is rejected
  before any call, a missing `--phone` exits 2 naming the number-only rule, and
  `accept` with an unknown id is a no-op at exit 0.
- **`parseSubcommand` strips the subcommand**, so the friendship id is `positional[0]`,
  not `[1]`. Caught immediately; worth knowing for any future subcommand that takes an
  argument.
- **The response echo is preferred over our own normalization** where the backend provides
  one, because `normalizePhone` runs server-side too and the two could disagree about
  which number was actually contacted.
- **`accept`/`decline` check the pending list first** rather than posting optimistically,
  so an already-actioned request is a clean no-op instead of a backend error.

## Follow-ups

- **The SMS-to-a-non-member path has never been run.** Two criteria are left unchecked
  rather than assumed: the branch is written from the function's source, not from observed
  behaviour, so the wording that distinguishes "request sent to a member" from "SMS sent
  to a stranger" is unproven. Exercising it means texting a real phone, which needs a dev
  instance and a number the tester owns. This is the highest-risk unverified path in the
  tool — it spends money and contacts people outside SquadQuest.
