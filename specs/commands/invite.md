# Command: invite

```
squadquest-axi invite "<name|id>" ["<name|id>" ...] --event <id>
```

The command this whole tool exists to make one step. "Invite Christine to the Flyers
game" should be one line, not a name lookup followed by a hand-assembled function call
([principles § verbs, not endpoints](../principles.md)).

## Resolution

Names resolve per [behaviors/name-resolution](../behaviors/name-resolution.md) against
**accepted friends only**. Resolution is **all-or-nothing**: every name is resolved
before anything is sent, and any ambiguous or unmatched name exits 2 having invited
nobody.

This is not fastidiousness. The backend takes an array and notifies on insert
([api/members](../api/members.md)) — so a partially-resolved batch that fired anyway
would notify some people, leave the caller unsure which, and offer no clean retry.

## Output

```
invited[2]{name,id,status}:
  Christine B.,a4c7b11b-...,invited
  Aaron O.,775aee26-...,invited
skipped[1]{name,reason}:
  Alex H.,already invited
event: Flyers vs Colorado Avalanche (Mon Oct 19 6:00-6:45 PM EDT)
```

Resolved names *and* ids are echoed so the caller can verify who was actually reached.

`skipped` reflects the backend's own behavior: `invite` filters out users who already
have a member row ([api/members](../api/members.md)). Re-inviting is therefore a safe
no-op — exit 0, never an error (AXI §6). When *every* name is skipped, say so plainly
rather than printing an empty `invited` block.

## Permission

The `invite` function has no server-side permission check — the TODO is still in the
source ([api/members](../api/members.md)). So the client checks locally: you may invite
to an event you host or are a member of. Anything else exits 2 with the reason.

This is a client-side guard over a server-side gap. It is not a security boundary and the
spec should not pretend otherwise; it exists so the tool doesn't help someone do
something the app wouldn't let them do.

## What it does not promise

A created invitation is not a delivered notification — recipients without a registered
push token, or with event invitations disabled, are silently skipped by the backend
([api/members](../api/members.md)). The output reports rows created. It never claims
someone's phone buzzed.

## Not for strangers

`invite` only ever operates on existing accepted friends. Adding someone new to the graph
is [friends request](friends.md), which takes a phone number and can send an SMS to
someone who has never heard of SquadQuest. These are deliberately different commands with
deliberately different inputs.
