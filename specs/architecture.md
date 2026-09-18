# Architecture

## Stack

- **TypeScript**, ESM, `module: NodeNext`, strict — compiled by `tsc` to `dist/`.
- **[`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js)** provides CLI dispatch, flag
  validation, `AxiError`, and exit-code mapping. It is the house baseline; don't
  hand-roll argument parsing.
- **[`@toon-format/toon`](https://toonformat.dev/)** renders all stdout. JSON stays
  internal; conversion happens at the output boundary only.
- **bun** for development and dependency management, **node ≥20** at runtime.
- **vitest** for tests. Toolchain versions are pinned in `.tool-versions` via `asdf` —
  never hand-edit that file.

## Structure

```
bin/squadquest-axi.ts     # shebang entry, delegates to src/cli.ts
src/
├── cli.ts                # runAxiCli dispatch, formatError, USAGE→exit 2 remap
├── reference.ts          # DESCRIPTION + top-level and per-command help text
├── version.ts
├── config.ts             # credential store: ~/.config/squadquest-axi/ (0600)
├── flags.ts              # shared flag parsing/validation helpers
├── squadquest/           # the backend adapter — ALL network access lives here
│   ├── client.ts          # base URL, anon-key fallback, PostgREST + functions calls
│   ├── auth.ts            # phone OTP request/verify, session refresh
│   ├── resolve.ts         # name → id resolution (see specs/behaviors/name-resolution.md)
│   └── types.ts
├── commands/             # one module per command surface, mirrors specs/commands/
└── output/               # TOON schema definitions + rendering
```

**The adapter boundary matters.** `src/squadquest/` is the only place that knows the
backend is Supabase. Commands deal in domain objects. When v2 lands on a different
backend (Fastify/Bun + Postgres), a second adapter slots in behind the same interface
and the command layer is untouched.

## Configuration and credentials

- Config dir: `$SQUADQUEST_AXI_CONFIG_DIR`, else `~/.config/squadquest-axi/`.
- `session.json` (mode `0600`) holds the access token, refresh token, and a cached
  self-profile so a fresh session needs zero discovery calls.
- `SQUADQUEST_AXI_TOKEN` overrides the stored session for CI-style use; `doctor` reports
  which source is active.
- The backend base URL defaults to production and is overridable via
  `SQUADQUEST_AXI_URL` for self-hosted and local-dev instances.

## Error handling

Per AXI §6, all errors render as TOON on **stdout** with an actionable `help`. Exit codes:
`0` success (including idempotent no-ops), `1` operation failure, `2` usage error
(missing required flag, unknown flag, ambiguous name). Raw dependency errors never reach
stdout — `cli.ts` wraps anything unrecognized as `INTERNAL_ERROR` pointing at `doctor`.

## Session integration

`squadquest-axi setup` installs a `SessionStart` hook (Claude Code, Codex, OpenCode) that
prints the home view, so an agent opens every session already knowing what's coming up.
An installable skill is generated from the same home-view content via `npm run docs`,
with a `--check` CI gate that fails when the committed skill drifts.

## Release

`develop` → `main` Release-PR automation via `JarvusInnovations/infra-components`.
Merging the Release PR tags and publishes to npm. Merge commits only.
