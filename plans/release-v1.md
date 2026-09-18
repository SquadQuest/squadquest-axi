---
status: blocked
depends: [rsvp-invite, events-write, home-hooks-docs, friend-requests]
specs:
  - specs/architecture.md
awaits:
  - "BOT_GITHUB_TOKEN at the SquadQuest org — required by release-publish; unverified"
  - "npm publish rights for the squadquest-axi name; first publish is manual by design"
---

# Plan: release v1

## Scope

Wiring the develop→main Release-PR automation, bootstrapping the first npm publish, and
shipping `1.0.0`.

Last by construction. `events-draft` is deliberately **not** a dependency — it has the
most unknowns and shouldn't hold a release hostage.

## Implements

- `specs/architecture.md` — the release section

## Approach

1. Copy the four workflow wrappers from `harvest-axi`/`gws-axi`: `release-prepare.yml`
   (push to develop), `release-validate.yml` (PR to main), `release-publish.yml` (merge),
   `publish-npm.yml` (release published). They're thin wrappers around
   `JarvusInnovations/infra-components` actions and carry details not worth re-deriving.
2. **Confirm `BOT_GITHUB_TOKEN` exists at the SquadQuest org.** `release-publish` needs
   it, and the org split means it can't be inherited from JarvusInnovations. This is the
   known cost of putting the repo here and it fails at exactly the wrong moment if missed.
3. Bootstrap npm: the first publish is manual because trusted publishing generally can't
   be configured for a package that doesn't exist yet. Publish once by hand, then wire
   OIDC trust for subsequent releases.
4. Approve the first `github-actions[bot]` workflow run — on a repo with no history the
   bot counts as a first-time contributor and checks sit at `action_required` with no
   explanation.
5. Verify the built package before shipping: `files` correct, bin executable, no config,
   fixtures, or `.env` in the tarball.

## Validation

- [x] The four release workflows are wired from the proven gws-axi wrappers
- [ ] `release-validate` passes on a correctly-titled release PR
- [ ] `BOT_GITHUB_TOKEN` is confirmed present at the SquadQuest org
- [ ] The first workflow run is approved and subsequent runs start unprompted
- [x] `npm pack` contains dist, LICENSE, README.md and the generated skill — 72 files
- [x] The packed tarball contains no credentials, fixtures, tests, or `.env`
- [ ] `npx squadquest-axi` works from a clean machine with no global install
- [ ] The published bin is executable
- [ ] Merging the Release PR tags and publishes
- [ ] `develop` still exists after the release merge (the ruleset holds)
- [ ] The generated skill installs via `npx skills add SquadQuest/squadquest-axi`

## Risks / unknowns

- **The `develop`-deletion trap.** Auto-delete is on, and the Release PR's head branch is
  `develop`. The deletion rulesets are already in place — this plan's job is to *verify*
  they held after the first real release merge, not to assume it.
- **Org-level secrets** are the one concrete cost of choosing the SquadQuest org over
  JarvusInnovations. Check early; discovering it at publish time wastes a release.
- **Name availability on npm** is unverified.
- **A red `release-validate` on a non-release PR into main is expected** — the workflow
  has no title filter. Don't retitle a hotfix PR to appease it.

## Notes

- **`squadquest-axi` is available on npm** (registry returns 404 for the name).
- **The org secret could not be verified**, and that is not the same as absent: the
  `organization-secrets` endpoint returns empty for `gws-axi` too, which certainly *does*
  have `BOT_GITHUB_TOKEN`. The query needs `admin:org`, which this token lacks. So the
  plan's first `awaits` stands — unresolved, not disproved.
- **Workflows are wired** from the gws-axi wrappers, with `bun-version` pinned to 1.4.0 to
  match `.tool-versions`.
- **The package was verified by packing it**: 72 files, dist + LICENSE + README + the
  generated SKILL.md, and nothing matching `.env`, `session`, `config.json`, `test/` or
  `token`.

## Follow-ups

This plan is **blocked, not done**. Three things remain and all three need the owner:

1. Confirm `BOT_GITHUB_TOKEN` exists at the SquadQuest org (needs `admin:org`, or the
   org settings page).
2. The **first npm publish is manual by design** — trusted publishing can't be configured
   for a package that doesn't exist yet. Publishing is outward-facing and irreversible,
   so it is the owner's call, not something to do unprompted.
3. Approve the first `github-actions[bot]` workflow run; on a repo with no history the bot
   counts as a first-time contributor and checks sit at `action_required`.

Unchecked criteria below are the ones that can only be proven by actually releasing.
