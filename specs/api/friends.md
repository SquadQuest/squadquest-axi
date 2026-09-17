# API: friends (the friend graph)

SquadQuest is explicitly not a social network — you only ever see people you already
know. The `friends` table is that boundary, and every name this client resolves comes
from it.

## Columns

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `requester` | uuid → profiles | who sent the request |
| `requestee` | uuid → profiles | who received it |
| `status` | enum | `requested` \| `accepted` \| `declined` |
| `created_at` | timestamptz | |
| `actioned_at` | timestamptz | when accepted/declined |

The relationship is **undirected once accepted** — which side you're on is an artifact of
who asked. Every read has to collapse that: given the current user, the friend is
whichever of `requester`/`requestee` isn't them.

## The two-FK embed problem

`friends` has two FKs to `profiles`, so a bare `profiles(...)` embed is ambiguous and
PostgREST rejects it. Name the constraints:

```
GET /rest/v1/friends
  ?select=id,status,
    requester:profiles!friends_requester_fkey(id,first_name,last_name),
    requestee:profiles!friends_requestee_fkey(id,first_name,last_name)
  &status=eq.accepted
  &or=(requester.eq.<me>,requestee.eq.<me>)
```

Confirmed working against production on 2026-09-17. The same hazard applies to
[instance_members](members.md).

## Profile fields

`profiles` carries `id`, `first_name`, `last_name`, `phone`, `photo`, `trail_color`, and
notification/push settings. The edge functions run a `scrubProfile` helper before
returning profiles to a caller, which strips the fields a peer shouldn't see.

**A direct PostgREST read is not scrubbed.** When only a name is needed, select only
`id,first_name,last_name` rather than `*` — per
[principles § public repo, private lives](../principles.md), don't pull fields the task
doesn't need, and never render phone numbers or push tokens in output.

## Friend requests

```
POST /functions/v1/send-friend-request
{ "phone": "...", "first_name": "...", "last_name": "..." }
```

Only `phone` is required; the names are used when the number belongs to nobody yet, in
which case the backend sends an **SMS invitation** via Twilio. That makes this the one
command in the tool that can text a stranger — it must never be reachable by accident or
inferred from a partial match.

```
POST /functions/v1/action-friend-request
{ "friend_id": "<uuid>", "action": "accepted" | "declined" }
```

Any other `action` value is `400 invalid-action`.

## Reads via edge function

`get-friends-network`, `get-profile`, and `get-friend-profile` are client-callable and
return scrubbed profiles. Prefer them over raw `profiles` reads wherever they cover the
need.

**Unverified:** their exact parameters and response shapes — confirm during
implementation, and prefer them over the PostgREST query above if they turn out to cover
the accepted-friends listing, since they scrub by default.

## Why this spec matters more than the others

Name resolution is the tool's sharpest edge. A friend list of a hundred-plus people with
overlapping first names is the normal case, and the failure mode is notifying the wrong
human. The rules live in
[behaviors/name-resolution.md](../behaviors/name-resolution.md); this spec is only the
data they operate on.
