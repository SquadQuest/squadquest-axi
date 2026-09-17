# Command: auth + doctor

SquadQuest authenticates by phone and SMS code ([api/auth](../api/auth.md)), so login is
inherently **two commands** — a human has to read a text message in between. No prompt,
no TTY blocking (AXI §6).

## auth login

`squadquest-axi auth login --phone <number>`

Requests a code. Normalizes to E.164 and echoes the normalized form, so a mistyped digit
is visible before the caller goes hunting for a text that will never arrive.

```
otp: code sent to +1 215-555-0123
help[1]:
  Run `squadquest-axi auth verify <code>` with the code from your text messages
```

The pending phone number is held in the config dir so `verify` doesn't need it repeated.

## auth verify

`squadquest-axi auth verify <code>`

Exchanges the code for a session, writes `session.json` at `0600`, caches the self
profile, and confirms with the resolved identity plus hook status:

```
account: Chris A. (+1 215-555-0123)
session: stored, expires in 7 days
hook: not installed
help[2]:
  Run `squadquest-axi` to see what's coming up
  Run `squadquest-axi setup` to show upcoming events at the start of every session
```

Verify with no prior login → exit 2 pointing at `auth login`. Expired or wrong code →
exit 2 saying codes are short-lived, with the command to request a fresh one. The failure
message never distinguishes "wrong code" from "expired code" beyond what the backend
says — guessing would be inventing detail.

## auth status

`squadquest-axi auth status`

Identity, credential source, token age. Definitive when empty (AXI §5):

```
account: not signed in
help[1]:
  Run `squadquest-axi auth login --phone <number>` to sign in
```

Always names **which source** is active — stored session or `SQUADQUEST_AXI_TOKEN` — so a
stale env var shadowing a good session is diagnosable in one call
([behaviors/identity-and-session](../behaviors/identity-and-session.md)).

## auth logout

`squadquest-axi auth logout`

Removes the stored session. Idempotent (exit 0 when nothing is stored). Notes when
`SQUADQUEST_AXI_TOKEN` is still set, since commands will keep working and that otherwise
looks like a failed logout.

States that the token is forgotten locally, **not revoked server-side**. Implying
otherwise would be a security claim the command can't back.

## doctor

`squadquest-axi doctor` — ordered checks `{check, status: ok|fail|skipped, detail}`
preceded by `healthy:`:

1. **credentials** — stored or env? which?
2. **permissions** — is `session.json` `0600` and the config dir `0700`? A world-readable
   session token is a finding, not a style note.
3. **connectivity** — does the instance respond?
4. **anon key** — which key the instance accepts. Reports when the current key fails and
   the legacy fallback is in use ([api/conventions](../api/conventions.md)) — this is the
   single most confusing failure the backend can produce, and it should be one command to
   diagnose rather than an afternoon.
5. **token** — does an authenticated read succeed? Reports whether a refresh fired.
6. **hook** — session integration installed?

Each failing check carries the command that fixes it (AXI §9). `doctor` is what every
unexpected error points at, so it must never itself require a valid session to run —
checks that can't proceed report `skipped` with the reason.
