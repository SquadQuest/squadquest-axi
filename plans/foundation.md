---
status: done
depends: []
specs:
  - specs/architecture.md
  - specs/principles.md
---

# Plan: CLI foundation

## Scope

The skeleton every other plan builds on: entry point, dispatch, output rendering, error
handling, config store, build, and CI. **No SquadQuest API calls** — this plan ships a CLI
that runs, validates flags, renders TOON, and fails correctly.

Out of scope: the backend adapter (`client-auth`), any command with real data.

## Implements

- `specs/architecture.md` — the `bin/` → `src/` layout, `axi-sdk-js` dispatch, TOON at the
  output boundary, config dir resolution, exit-code mapping
- `specs/principles.md` §6 — read cheap, write loud (the error/exit scaffolding)

## Approach

1. `bin/squadquest-axi.ts` — shebang, delegates to `src/cli.ts`.
2. `src/cli.ts` — `runAxiCli` from `axi-sdk-js`, mirroring nexudus-axi: a `USAGE_CODES`
   set remapped to exit 2, and a `formatError` that wraps anything unrecognized as
   `INTERNAL_ERROR` pointing at `doctor`. Exported so the remap is unit-testable.
3. `src/output/` — TOON encode helpers plus the shared schema shapes (`count: N of M`,
   truncation with total, `help[]` blocks).
4. `src/config.ts` — config dir resolution (`SQUADQUEST_AXI_CONFIG_DIR` → `~/.config/…`),
   dir at `0700`, `session.json` at `0600`, read/write/clear. No auth logic yet.
5. `src/reference.ts` — `DESCRIPTION`, top-level and per-command help text as data, so
   `--help` and the generated skill read from one source.
6. `src/version.ts`, `tsconfig` already in place, `.github/workflows/ci.yml` running
   typecheck + tests on node 22.
7. Stub commands that exit 2 with "not implemented yet" so dispatch is exercised end to
   end before any network code exists.

## Validation

- [x] `bun run dev` with no args prints bin/description without throwing
- [x] Unknown command exits 2 with a structured TOON error naming valid commands
- [x] Unknown flag on a known command exits 2 and lists that command's valid flags
- [x] `--help` works at top level and per command
- [x] A thrown non-`AxiError` renders as `INTERNAL_ERROR` on **stdout**, never a stack trace
- [x] Config dir is created `0700`; a written session file is `0600`
- [x] `npm run build` emits an executable `dist/bin/squadquest-axi.js`
- [x] CI green on a PR

## Risks / unknowns

- **axi-sdk-js version drift** — we're on 0.1.12, nexudus-axi on 0.1.11. Check whether
  `runAxiCli`'s signature or flag-validation behavior moved before copying its patterns.

## Notes

- **Ported rather than reinvented.** `flags.ts`, `output/{schema,render,index}.ts` and
  `version.ts` came from nexudus-axi with the tool name and the global flag swapped
  (`--space` → `--timezone`). Same rendering as the sibling *-axi tools, for free.
- **`axi-sdk-js` 0.1.12 matched 0.1.11's surface** — `runAxiCli`, `AxiError` and
  `exitCodeForError` all behaved as nexudus-axi uses them. The drift risk named in this
  plan did not materialize.
- **`AxiError` has no `details` field**, so `src/errors.ts` adds `DetailedError` to carry
  candidate lists on an error. `AMBIGUOUS_NAME` needs this to correct in one turn
  (AXI §4), and `friends-resolution` depends on it.
- **`encode()` inlines primitive arrays**, so `formatError` renders `help` through
  `renderHelp` instead — otherwise every error printed `help[2]: a,b` on one line rather
  than the AXI block form. Caught by smoke test, not by types.
- **Usage-class errors exit 2, which the ported CI smoke test did not expect** (it
  asserted exit 1). Adjusted, and `NOT_IMPLEMENTED` was added to `USAGE_CODES` so the
  stubs match their own documented behavior.

## Follow-ups

- `docs:check` is absent from CI until the skill generator lands — noted inline in
  `ci.yml`, tracked by `home-hooks-docs`.
- Stub commands throw before parsing flags, so unknown-flag rejection is currently proven
  at the parser level only. It becomes end-to-end as each command declares its `FlagSpec`.
