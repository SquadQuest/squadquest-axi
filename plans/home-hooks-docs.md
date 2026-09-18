---
status: done
depends: [events-read]
specs:
  - specs/commands/setup.md
  - specs/commands/home.md
  - specs/architecture.md
---

# Plan: session integration + generated skill

## Scope

`squadquest-axi setup` (install/status/uninstall across Claude Code, Codex and OpenCode),
plus the generated Agent Skill and the CI drift gate that keeps it honest.

Depends only on `events-read`, since the home view is what the hook prints — it can land
in parallel with the write plans.

## Implements

- `specs/commands/setup.md` — the whole document
- `specs/commands/home.md` — its role as hook output
- `specs/architecture.md` — the `npm run docs` generation and `--check` gate

## Approach

1. Per-agent installers behind one interface: Claude Code (`settings.json` hooks), Codex
   (`hooks.json` plus `[features].hooks = true`), OpenCode (managed plugin file). Detect
   which are present and skip the rest with a reason.
2. Resolve the hook command to the bare binary name when it resolves on `PATH` to *this*
   executable, else the absolute path — so global installs stay portable without risking
   a different binary.
3. Path repair: rewrite an existing hook whose path is stale rather than appending a
   second entry. Re-running with the same path is a silent no-op.
4. `scripts/generate-skill.ts` builds `SKILL.md` from `src/reference.ts` — the same source
   `--help` reads — stripping live state and rewriting examples to `npx -y squadquest-axi`.
5. `npm run docs:check` in CI fails when the committed skill drifts from the generator.
6. README documents hook and skill as two routes to one outcome, needing only one.

## Validation

- [x] `setup` installs for every detected agent and skips absent ones with a reason
- [x] Re-running with an unchanged path is a silent no-op
- [x] A stale path is rewritten in place, not duplicated
- [x] The hook command uses the bare name only when `PATH` resolves it to this executable
- [ ] Codex install sets `[features].hooks = true` without clobbering other config — **unverified**; no Codex install present to test against
- [x] `--status` reports installed/path/current/scope per agent
- [x] `--uninstall` removes only our hooks and is idempotent
- [ ] A real session-start in Claude Code prints the home view — **unverified**; not installed into the owner's real agent config without asking
- [x] The hook prints the unauthenticated variant and exits 0 on a machine with no session
- [x] `npm run docs` regenerates `SKILL.md`; `docs:check` fails on a hand-edit
- [x] The generated skill contains no live state and no bare-binary examples

## Risks / unknowns

- **Editing users' shared config files.** A malformed write breaks their agent, not just
  our tool. Read-modify-write with a parse check, and never rewrite a key we don't own.
- **A hook that errors pollutes every session.** The home view must exit 0 unauthenticated
  and on a network failure — validated here, not assumed from `events-read`.
- **Hook config formats are moving targets** across three agents. Pin what's verified and
  note the date; a format change should fail loudly in `--status`, not silently no-op.

## Notes

- **Verified in a sandbox, not in the owner's config.** Install / re-run / uninstall were
  exercised against a throwaway project-scope `.claude/settings.json` seeded with an
  unrelated `permissions` key: install added only `hooks.SessionStart`, a re-run reported
  `unchanged`, and uninstall removed our entry while leaving `permissions` untouched.
  Installing into the real `~/.claude/settings.json` is the user's call, not a test.
- **`readJson` refuses to write over a file it cannot parse.** Clobbering someone's agent
  config is worse than not installing, so a malformed file surfaces as a skipped agent
  with the reason rather than a silent rewrite.
- **An explicitly named `--agent` installs whether or not detection finds it.** The user
  knows their setup better than directory sniffing does.
- **The docs gate was proven by breaking it**: a hand-edit to `SKILL.md` makes
  `docs:check` exit 1, and regenerating makes it pass. A gate never seen to fail is not
  known to work.

## Follow-ups

- **Two criteria are unverified for the same reason**: confirming a real session-start
  render, and the Codex `[features].hooks = true` edit, both need installing into live
  agent config. The Codex TOML edit in particular is append-only and unexercised.
