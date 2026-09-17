# Principles

Decisive trade-offs that steer every implementation decision in this repo. When two
reasonable approaches conflict, these pick the winner.

## 1. Never invent a person

The single most damaging thing this tool can do is send a notification to the wrong
human. Every command that acts on a person resolves a name to an id and **confirms the
match before acting**; an ambiguous name is an error, never a best guess.

- Always favor **failing with the candidate list** over picking the closest match.
- A name that resolves to exactly one friend proceeds. Zero or 2+ exits 2 with the
  candidates, so the agent can re-invoke with an id.
- Ids are always accepted in place of names, and always echoed back in confirmations.

## 2. Notifications are the product, not a side effect

SquadQuest exists to get people out of the house. Anything that creates or changes a
member's relationship to an event — RSVPs, invitations — goes through the backend's
**edge functions**, which is where notification fan-out lives. Direct table writes
produce a row that looks correct and silently tells nobody.

- Always favor the **edge function** over the equivalent PostgREST write.
- When a verb has no edge function, say so in the spec rather than quietly inserting.

## 3. Verbs, not endpoints

The caller wants "invite Christine to the Flyers game", not "resolve a profile id, then
POST to a function with a JSON body". Every command is named for the user's intent and
does the whole job, including whatever multi-call choreography that requires.

- Always favor **one command that does the real task** over a thin REST mirror.
- Multi-step choreography (create event → RSVP yourself → invite others) belongs inside
  the tool, not in the caller's head.

## 4. Public repo, private lives

This repo is public and the data it touches is a private friend graph. The tool ships;
the data never does.

- No real names, phone numbers, event contents, tokens, avatars, or friend-graph
  excerpts in source, tests, fixtures, commit messages, issues, or PR bodies.
- Test fixtures use invented people.
- Error messages echo back what the user passed, never unrelated records they could see.
- Credentials live in the user's config dir at `0600`, never in the repo, never in
  environment-variable examples with real values.

## 5. The backend is quirky; absorb it

The production backend has sharp edges that cost a caller real time to rediscover. The
tool's job is to know them so nobody else has to.

- The **legacy anon key** is the one that works; the current key 401s. The client tries
  and falls back, exactly as the Flutter app does.
- Times cross the wire as **UTC ISO-8601**; users think in local wall clock.
- Geometry is **WKT** (`POINT(lon lat)`) — longitude first, which is the opposite of how
  every human writes coordinates.
- Always favor **absorbing the quirk with a comment pointing at the spec** over exposing
  it in the command surface.

## 6. Read cheap, write loud

Reads should be safe to fire speculatively; writes should be impossible to fire by
accident.

- Reads default to small schemas and never mutate.
- Every write echoes the resulting state so the agent can verify without a follow-up read.
- Idempotent writes are no-ops with exit 0, never errors (AXI §6).
