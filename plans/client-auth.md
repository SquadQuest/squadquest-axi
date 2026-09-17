---
status: planned
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

- [ ] `auth login --phone` normalizes to E.164, echoes it, and sends a code
- [ ] A malformed phone exits 2 before any network call
- [ ] `auth verify` stores `session.json` at `0600` and caches the self profile
- [ ] `auth verify` with no prior login exits 2 pointing at `auth login`
- [ ] A wrong/expired code exits 2 with the request-a-fresh-code command
- [ ] The anon-key probe selects the legacy key against production and `doctor` says so
- [ ] An expired access token triggers exactly one refresh and one retry, transparently
- [ ] A failed refresh surfaces "session expired, log in again", not a token error
- [ ] `auth status` names the active credential source; `SQUADQUEST_AXI_TOKEN` wins
- [ ] `auth logout` is idempotent, notes a lingering env token, and doesn't claim revocation
- [ ] `doctor` runs unauthenticated, reporting `skipped` with reasons
- [ ] `doctor` flags a loosened `session.json` mode as a failing check
- [ ] No command prints the access token

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

## Follow-ups
