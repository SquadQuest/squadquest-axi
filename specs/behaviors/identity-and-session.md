# Behavior: identity and session

One account, one stored session. Simpler than the multi-tenant credential stores in
sibling AXI tools, because SquadQuest has exactly one production instance and a person
has exactly one phone number.

## The credential store

`$SQUADQUEST_AXI_CONFIG_DIR`, else `~/.config/squadquest-axi/`:

```
config.json     # { version, url? }          0644
session.json    # tokens + cached self       0600
```

`session.json` holds `access_token`, `refresh_token`, `expires_at`, and a `self` cache
(`id`, `first_name`, `last_name`, `cached_at`). The cache is what lets the home view
render without a discovery round-trip.

The directory is created `0700` and `session.json` written `0600`. If either exists with
looser permissions, `doctor` reports it as a failing check — a world-readable session
token is a real finding, not a style note.

## Resolution order

| Source | When |
| --- | --- |
| `SQUADQUEST_AXI_TOKEN` | always wins; for CI and scripted use |
| `session.json` | the normal path |
| nothing | every authenticated command exits 2 with the login command |

`doctor` and `auth status` always report **which source is active**, so a stale env var
shadowing a good stored session is diagnosable in one call rather than being mysterious.

## Expiry and refresh

Any `401` on a call that should have worked means: refresh once, retry once. Only if the
refresh itself fails does the user see an auth error, and then the message is "session
expired, log in again" with the command — never a raw token error.

A successful refresh rewrites `session.json` in place. Observed production sessions last
7 days ([api/auth](../api/auth.md)), but nothing may depend on that number.

## `whoami` is folded in, not a command

Identity belongs in `auth status` and the home view. A separate `whoami` would be a
command whose entire output is already in the thing an agent sees first.

## Logout

`auth logout` removes `session.json`. Idempotent — logging out when nothing is stored is
exit 0 with a note, not an error. It notes when `SQUADQUEST_AXI_TOKEN` is still set, since
the next command will still be authenticated and that would otherwise look like the
logout failed.

Logout does **not** invalidate the token server-side; it only forgets it locally. Say so
rather than implying the session was revoked.

## What is never stored or printed

Per [principles § public repo, private lives](../principles.md):

- The OTP code is never persisted.
- Push tokens and other people's phone numbers are never rendered, even when an API
  response includes them — select narrow, and strip on the way out.
- Your own phone number appears only in `auth status` and `doctor`, where confirming the
  account is the point.
- No command prints the access token. `doctor` reports its presence, source, and age.
