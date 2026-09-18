# API: instance_members (RSVPs and invitations)

`instance_members` joins a person to an event with a status. It is the table this client
**must never write directly** — see
[principles § notifications are the product](../principles.md).

## Columns

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `instance` | uuid → instances | |
| `member` | uuid → profiles | |
| `status` | enum | `invited` \| `no` \| `maybe` \| `yes` \| `omw` |
| `note` | text | optional message alongside an RSVP |
| `created_by` | uuid → profiles | who created the row (host, for invitations) |
| `chat_last_seen` | timestamptz | event-chat read marker |

`omw` is "on my way" — it's what flips a member onto the live map. It's a real RSVP state,
not a UI affordance, and belongs in the command surface.

## Reading

`GET /rest/v1/instance_members?instance=eq.<id>` returns rows with `member` as a bare
uuid. The embed `member:profiles(...)` **fails** — `instance_members` has two FKs to
`profiles` (`member` and `created_by`), so PostgREST needs the constraint named
explicitly, as with [friends](friends.md). Resolve profiles in a second call or name the
constraint; don't emit the error.

## Writing: both paths are edge functions

### RSVP (yourself)

```
POST /functions/v1/rsvp
{ "instance_id": "<uuid>", "status": "yes", "note": "optional" }
```

Acts as the authenticated user. The function verifies the event exists, checks visibility
access, upserts the row, and notifies the host (`guestRsvp`). Returns the hydrated member
record including the full profile.

Passing a null `status` withdraws the RSVP — the function returns a record whose status
is null and the client treats that as removal.

### Invite (other people)

```
POST /functions/v1/invite
{ "instance_id": "<uuid>", "users": ["<uuid>", ...] }
```

Takes an **array**, so inviting five people is one call, not five. The function:

1. loads the event (`404 event-not-found` if missing),
2. finds which of `users` already have a row and **skips them** — so invite is naturally
   idempotent and re-inviting is a safe no-op (AXI §6: exit 0, not an error),
3. inserts `invited` rows for the rest,
4. sends each an `eventInvitation` push.

Returns the created member records with hydrated, scrubbed profiles.

> **Permission gap.** The function carries a `TODO: check that user has permission to
> invite to this event` — there is currently no server-side check that the caller may
> invite. The client must not rely on the server to refuse; it should only offer invite
> on events the user hosts or is a member of, and say so plainly rather than discovering
> it by trying.

## Why direct writes are forbidden

A direct insert into `instance_members` may well succeed. It produces a row that renders
correctly in the app and sends **no notification** — no invitation, no host alert. The
person is invited in the database and uninvited in real life. Every RSVP and invitation
goes through the function.

## Notification gating

Recipients are skipped when they have no push token registered, or when the relevant key
is absent from their enabled-notifications list (`eventInvitation`, `guestRsvp`,
`eventChange`, `eventMessage`, ...). So a successful invite does **not** guarantee a
delivered notification, and the client should not claim it did. Report what was created;
don't promise a buzz in someone's pocket.
