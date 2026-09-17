# squadquest-axi specs

These specs declare the **desired state** of squadquest-axi. Implementation follows spec — the spec leads, the code conforms. Work-in-flight is tracked in [`../plans/`](../plans/); each plan names the specs it implements.

## Layout

```
specs/
├── README.md              # this file
├── principles.md          # project-wide decisive rules (the philosophy)
├── architecture.md        # stack, structure, build, config, docs generation
├── api/                   # the SquadQuest v1 backend contract we consume
│   ├── conventions.md      # base URL, the legacy-anon-key fallback, PostgREST vs edge functions, errors
│   ├── auth.md             # phone OTP request/verify, session storage, refresh
│   ├── instances.md        # the event object: fields, WKT geometry, UTC times, visibility, status
│   ├── members.md          # RSVPs and invitations — both edge-function-only
│   ├── friends.md          # the friend graph: two FK aliases, accepted/requested/declined
│   └── topics.md           # the topic taxonomy and subscriptions
├── behaviors/             # cross-cutting rules spanning multiple commands
│   ├── identity-and-session.md  # credential store, whoami, expiry handling
│   ├── name-resolution.md       # friend names → ids, ambiguity, never-guess rule
│   └── time-and-place.md        # human time/place in, UTC + WKT out
└── commands/              # one file per command surface
    ├── home.md             # no-args ambient view
    ├── auth.md             # login / status / logout + doctor
    ├── setup.md            # session-hook lifecycle
    ├── events.md           # list / view / create / cancel
    ├── invite.md           # invite friends to an event
    ├── rsvp.md             # set your own status on an event
    ├── friends.md          # the friend graph
    └── topics.md           # list / create topics
```

## Conventions

- Specs declare **what** must be true, not **how** to build it.
- Every command spec lists its default TOON schema (the minimal column set), its flags, and its contextual-disclosure suggestions.
- When code and spec diverge, the spec is right and the code is a bug — fix the spec first if the spec is wrong.
- The `api/` specs are derived from the SquadQuest v1 Flutter client (the `v1` branch of `SquadQuest/SquadQuest`, which is the shipping production app) and confirmed against the production backend on 2026-09-17. Fields marked **unverified** were inferred and must be confirmed during implementation; confirming or correcting them is a spec update, not a code workaround.
- **v1 is the target.** v2 is a ground-up rebuild on a different backend (Fastify/Bun + Postgres). This tool speaks v1 until v2 ships, and the API layer is isolated behind `src/squadquest/` so a v2 adapter can slot in without touching command code.
