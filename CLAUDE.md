# squadquest-axi

An agent-ergonomic CLI for [SquadQuest](https://squadquest.app) — the privacy-first app
for planning real-world hangouts with people you actually know.

This repo is **PUBLIC**. It ships a tool, never instance data: no real user names, phone
numbers, event contents, tokens, or friend-graph excerpts in any git surface — source,
tests, fixtures, commit messages, issues, or PR bodies. Test fixtures use invented
people. See `specs/principles.md`.

## What this tool is

A thin, honest client over the SquadQuest backend that exposes **high-level verbs** an
agent can reach for directly — `events`, `invite`, `friends`, `rsvp` — rather than making
the caller assemble REST calls. It follows the **AXI** standard (token-efficient TOON
output, minimal default schemas, structured errors on stdout, contextual next-step hints,
content-first home view). Invoke the `axi` skill before changing any command's output
shape.

## Spec-driven development (specops)

This project uses spec-driven development. `specs/` is the source of truth for what
*should be true*; `plans/` is the work-in-flight DAG that bridges specs to merged code.
The **specops** skill carries the full methodology — invoke it (the skill triggers on
"spec", "plan", starting a feature, etc.) before writing specs, planning, or building.

- **Specs lead.** Before changing behavior, change the spec; bring code into conformance
  after. Spec↔code drift is a bug, not debt. Specs merge implemented-or-planned; a spec
  still being designed rides a draft planning PR, not the main branch.
- **`plans/` is the planning system — not your built-in plan mode.** Every chunk of work
  lands as a file in `plans/` that freezes to `done` as the durable record of what got
  built. Don't let an ephemeral plan substitute for it, and don't skip it for "small"
  changes. (Classic trap: an ad-hoc plan of "write spec X, then build it" that ends with
  neither a reviewed spec nor a plan file — split those into the two real artifacts.)
- **When to author a plan depends on intent:** mapping out a batch of specs → finish the
  batch first, then propose a *set* of plans; speccing one bounded feature in a mature
  project → draft the spec change and its plan in tandem; intent unclear → ask. The skill
  details each mode.
- **A spec change ripples to its plans.** After editing a spec, review the plans that
  implement it (`grep -l '<spec-path>' plans/*.md`) and offer to update them.

Query the DAG: `.agents/skills/specops/scripts/specops next` (what to work on next) and
`.agents/skills/specops/scripts/specops dag` (graph). Run `/audit-spec-drift` to compare
specs against the implementation.

## Source control

- Conventional commits (`feat(events): ...`, `fix(auth): ...`)
- `develop` is the default branch; `main` is the release target, written only by the
  develop→main Release PR
- **Merge commits only** — never squash, never rebase-merge, never backmerge
