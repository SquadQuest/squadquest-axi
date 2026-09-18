# Command: friends

The friend graph — the pool every name in [invite](invite.md) resolves against.

## friends list

`squadquest-axi friends [list] [--search <text>] [--pending] [--limit N]`

Default: accepted friends, alphabetical, limit 100. The limit is high on purpose — a
normal graph is 100+ people and the common need is "find the one I mean", which a
truncated list defeats (AXI §2).

```
count: 122 accepted
friends[122]{name,id}:
  Aaron O.,775aee26-...
  Abbie S.,468159b1-...
  ...
help[2]:
  Run `squadquest-axi friends --search chris` to narrow by name
  Run `squadquest-axi invite "<name>" --event <id>` to invite someone
```

Two fields only. Phone numbers, photos, push tokens and notification settings are never
rendered ([principles § public repo, private lives](../principles.md)) — they aren't
needed to pick a person, and a friend list is the densest concentration of other
people's contact details the tool touches.

`--search` applies the same matching ladder as name resolution
([behaviors/name-resolution](../behaviors/name-resolution.md)), so what the caller sees
here is exactly what `invite` will match. A search that shows one result guarantees an
unambiguous invite.

`--pending` lists incoming and outgoing requests instead:

```
pending[2]{name,id,direction,since}:
  Dana R.,c81f...,incoming,3d
  Sam T.,9e02...,outgoing,11d
help[1]:
  Run `squadquest-axi friends accept <id>` or `friends decline <id>`
```

## friends request

`squadquest-axi friends request --phone <e164> [--first-name "..."] [--last-name "..."]`

**Takes a phone number, never a name** — there is nothing to match against, because the
point is reaching someone who may not be in the graph at all.

If the number belongs to nobody, the backend sends an **SMS invitation** via Twilio
([api/friends](../api/friends.md)). This is the only command in the tool that contacts
someone outside SquadQuest, so:

- The number is echoed in normalized E.164 form in the confirmation, so a mistyped digit
  is visible after the fact.
- The confirmation states whether an SMS was sent to a non-member or a request was sent
  to an existing member — the caller should know which happened.
- Names are optional and used only for the SMS to a non-member.

## friends accept / decline

`squadquest-axi friends accept <id>` · `squadquest-axi friends decline <id>`

Takes the **friendship id** from `--pending`, not a person id — that's what the backend
action takes ([api/friends](../api/friends.md)), and accepting a person you have no
pending request from is not a meaningful operation.

Both are idempotent: accepting an already-accepted friendship is exit 0 with a no-op
note. Any action other than accept/decline is rejected client-side before the call.
