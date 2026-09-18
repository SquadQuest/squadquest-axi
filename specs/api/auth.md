# API: auth

SquadQuest v1 authenticates with **phone number + SMS one-time code** through Supabase
GoTrue. There is no password, no email, and no OAuth. This shapes the whole CLI auth
story: login is inherently two commands, because a human has to read a text message
between them.

## Request a code

```
POST /auth/v1/otp
{ "phone": "+12155550123" }
```

The Flutter client calls `supabase.auth.signInWithOtp(phone:)`. Sends an SMS via Twilio
and returns `200` with an empty body. **Unverified:** whether the instance rejects
unknown numbers or silently creates a pending user — must be confirmed during
implementation, since it decides whether "login with a number that has no account" is an
error or a signup.

## Verify the code

```
POST /auth/v1/verify
{ "phone": "+12155550123", "token": "325237", "type": "sms" }
```

The Flutter client calls `supabase.auth.verifyOTP(type: OtpType.sms, …)`. Returns a
session:

```
access_token, refresh_token, token_type, expires_in, expires_at, user
```

`user.id` is the profile id used everywhere else — it is the FK target for
`instances.created_by`, `instance_members.member`, and both sides of `friends`.

## Refresh

```
POST /auth/v1/token?grant_type=refresh_token
{ "refresh_token": "<token>" }
```

Observed `expires_at` on a fresh production session was **7 days** out, which is unusually
long for GoTrue (the default is 1 hour) and suggests instance configuration. Don't rely
on the duration — treat any `401` as "refresh and retry once", and only report an auth
failure if the refresh itself fails.

## Test-phone bypass

The client recognises a `TEST_PHONE` number and swaps OTP for password auth
(`signInWithPassword(phone:, password: <the "code">)`), skipping the SMS entirely. This
exists for automated testing against a dev instance.

This client should support the same bypass for its own integration tests, configured per
environment. It must **never** ship a real test number or credential — see
[principles § public repo, private lives](../principles.md).

## Phone normalization

`send-friend-request` runs a `normalizePhone` helper server-side, so the backend is
tolerant of formatting there. The auth endpoints are **not** documented to normalize.
Normalize to E.164 client-side before sending, and echo back the normalized form so a
user who typed `(215) 555-0123` can see what was actually used.

## What the client stores

Per [architecture](../architecture.md), `session.json` (mode `0600`) in the config dir
holds `access_token`, `refresh_token`, `expires_at`, and a cached self-profile
(`id`, `first_name`, `last_name`) so the home view needs zero discovery calls.

The phone number is stored only as the cached profile's own field. The OTP code is never
persisted.

## Failure modes worth translating

| Cause | What the user should be told |
| --- | --- |
| verify called with no prior `otp` request | request a code first, with the exact command |
| expired or wrong code | request a fresh code — codes are short-lived |
| refresh token rejected | session expired, log in again |
| no stored session | log in, with the exact command |
