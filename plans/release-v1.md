---
status: done
depends: [rsvp-invite, events-write, home-hooks-docs, friend-requests]
specs:
  - specs/architecture.md
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
- [x] `release-validate` passes on a correctly-titled release PR
- [x] `BOT_GITHUB_TOKEN` is confirmed present at the SquadQuest org
- [x] The first workflow run is approved and subsequent runs start unprompted
- [x] `npm pack` contains dist, LICENSE, README.md and the generated skill — 72 files
- [x] The packed tarball contains no credentials, fixtures, tests, or `.env`
- [x] The packed tarball installs clean and runs — home view, exit 0, `--version` correct
- [x] The packed bin carries the executable bit (`-rwxr-xr-x`)
- [x] Merging the Release PR tags and publishes
- [x] `develop` still exists after the release merge (the ruleset holds)
- [x] The generated skill installs via `npx skills add SquadQuest/squadquest-axi`

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
- **Grepping the pack listing was not the same as reading it.** A leak-grep over
  `npm pack --dry-run` came back clean and I called the package verified; reading the
  actual file list afterwards showed `dist/src/commands/stub.js` — the `notImplemented`
  scaffold — still shipping, with zero importers left once every command landed. Removed;
  the package went 72 → 70 files. The lesson is the obvious one: a filter only finds what
  you thought to look for.
- **Verified by installing the tarball, not just inspecting it**: `npm install` of the
  packed artifact into a clean prefix, then running the binary with an empty config dir —
  home view renders, exit 0, `--version` reports 0.1.0, and the bin carries
  `-rwxr-xr-x`.

## Closeout

Three releases shipped: **0.1.0** manually (to claim the name so trusted publishing could
be configured), **0.1.1** through the automation, and **0.2.0** with real release notes.
All criteria are now met by an actual release rather than by inspection.

- **The `develop`-deletion trap did not fire.** `git ls-remote --heads` shows both
  branches after two release merges. The deletion ruleset is doing its job.
- **Trusted publishing works**: 0.2.0 carries a SLSA provenance attestation signed from
  GitHub Actions and logged to Sigstore. No `NPM_TOKEN` is stored anywhere.
- **Verified by installing from the registry**, not by reading a green check: `0.2.0`
  installs clean, `--version` is right, `editCommand`/`uncancelCommand` are present, and
  `events create` without `--topic` exits 2.
- **The advice to close PR #1 was wrong.** It was merged instead and published fine, so
  the caution about a red first run cost a release number for nothing.
- **"Published" lags "publish succeeded" by minutes.** npm's own output says the package
  "is being processed"; a registry check immediately after a green job reported the old
  version and looked like a failure. Read the publish log before concluding anything.
- **The first-time-contributor approval gate bites on the `pull_request` event
  separately** from `push`, and `action_required` is the run's **conclusion**, not its
  `status` — filtering on `status` silently matches nothing and the "approvals" do
  nothing. PR #2 sat a week behind two unapproved duplicate runs because of that.
