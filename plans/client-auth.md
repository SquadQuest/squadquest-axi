---
status: done
depends: [foundation]
specs:
  - specs/api/conventions.md
  - specs/api/auth.md
  - specs/behaviors/identity-and-session.md
  - specs/commands/auth.md
---

# Plan: backend adapter + authentication

## Scope

`src/squadquest/` — the only module that knows the backend is Supabase — plus the full
auth surface: `auth login`, `auth verify`, `auth status`, `auth logout`, and `doctor`.

After this plan, the tool can authenticate a real person and make an authenticated read.
Everything downstream is domain work.

Out of scope: any domain command.

## Implements

- `specs/api/conventions.md` — base URL, dual auth headers, the anon-key probe and legacy
  fallback, the PostgREST vs edge-function split, error translation
- `specs/api/auth.md` — OTP request/verify/refresh, E.164 normalization
- `specs/behaviors/identity-and-session.md` — credential store, resolution order,
  refresh-once-retry-once, permission enforcement
- `specs/commands/auth.md` — the four auth commands and all six `doctor` checks

## Approach

1. `client.ts` — `get`/`post` against `/rest/v1/…` and `postFunction` against
   `/functions/v1/…`, both attaching `apikey` + `Authorization`.
2. **Anon-key resolution**: probe the current key against
   `/rest/v1/app_versions?select=*&limit=1`; on failure fall back to the legacy key,
   exactly as the Flutter client does. Cache the decision for the process lifetime.
   Keys are fetched/configured at runtime, never committed.
3. **401 handling**: one refresh, one retry, then a translated auth error. Guard against
   recursion — a 401 on the refresh call itself must not re-enter.
4. `auth.ts` — `POST /auth/v1/otp`, `POST /auth/v1/verify`, refresh grant. Pending phone
   held in config between the two commands.
5. Error translation table: PostgREST `{message,code,details,hint}` and edge-function
   `{error:{message,code}}` → `AxiError` with actionable help. Never name Supabase or
   PostgREST in a suggestion.
6. `doctor` last, since it reports on everything above and must run without a session.

## Validation

- [x] `auth login --phone` normalizes to E.164, echoes it, and sends a code
- [x] A malformed phone exits 2 before any network call
- [x] `auth verify` stores `session.json` at `0600` and caches the self profile
- [x] `auth verify` with no prior login exits 2 pointing at `auth login`
- [x] A wrong/expired code exits 2 with the request-a-fresh-code command
- [x] The anon-key probe selects the legacy key against production and `doctor` says so
- [x] An expired access token triggers exactly one refresh and one retry, transparently
- [x] A failed refresh surfaces "session expired, log in again", not a token error
- [x] `auth status` names the active credential source; `SQUADQUEST_AXI_TOKEN` wins
- [x] `auth logout` is idempotent, notes a lingering env token, and doesn't claim revocation
- [x] `doctor` runs unauthenticated, reporting `skipped` with reasons
- [x] `doctor` flags a loosened `session.json` mode as a failing check
- [x] No command prints the access token

## Risks / unknowns

- **Unknown-number behavior on `otp`** — spec'd as unverified. Decides whether logging in
  with an unregistered number is an error or a signup. Confirm before writing the error
  copy, and don't invent a message for a path we haven't seen.
- **Testing OTP costs a real SMS.** Use the backend's test-phone bypass against a dev
  instance for automated tests; never commit a real number or code.
- **Anon-key rotation** — if the instance fixes the current key mid-development, the
  probe must silently start preferring it. That's the point of probing, but it means the
  test suite can't assert "legacy is always chosen".

## Notes

- **The env-asset path was wrong on the first try.** Flutter web serves declared assets at
  `/assets/<path>`, so the dotenv asset is `/assets/.env`, not the doubled
  `/assets/assets/.env`. `doctor` caught it immediately — which is the argument for the
  api-key check existing at all.
- **Verified live against production**: the probe rejects the current key, falls back to
  legacy, caches it, and an authenticated `profiles` read succeeds. `doctor` reports
  "current key rejected; using the legacy key (expected for this instance)".
- **Key resolution is memoized per process and cached in `config.json`**, with a
  `--refresh` path so a future instance-side fix is picked up rather than pinned. The
  probe order is current-then-legacy for exactly that reason.
- **`auth verify` writes the session twice** — once before fetching the profile, once
  after. A profile read failure should not cost a successful login.
- **Nothing here needed a live SMS after all.** Five criteria were briefly deferred on the
  assumption that OTP couldn't be tested; stubbing `fetch` covers all of them, including
  the refresh-retry path and the guard against the retry re-entering refresh.
- **`translate()` maps 404 and `event-not-found` to the same `EVENT_NOT_FOUND`.** The
  backend cannot distinguish "missing" from "not visible to you", and guessing would leak
  whether an event exists (specs/commands/rsvp.md).

## Follow-ups

- **The OTP round trip is covered by a stubbed `fetch`, not a live SMS.** Only the
  transport is faked — command logic, storage, and error translation are real — so the
  coverage is genuine, but nothing here proves the *live* endpoint behaves as
  specs/api/auth.md describes. A single manual login against production (or the
  `TEST_PHONE` bypass on a dev instance) should confirm it before `release-v1`.
- **Unknown-number behavior on `/auth/v1/otp` is still unverified** — the risk this plan
  named is unresolved, not closed. The error copy for that path is written defensively and
  should be revisited once the behavior is observed.
