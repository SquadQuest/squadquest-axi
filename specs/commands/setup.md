# Command: setup

Session integration per AXI §7 — registers the tool into an agent's session lifecycle so
every conversation starts already knowing what's coming up, with no invocation.

## setup

`squadquest-axi setup [--agent claude-code|codex|opencode] [--scope project|global]`

Installs a `SessionStart` hook that runs the [home view](home.md). Default targets **all
three** supported agents that are present on the machine; `--agent` narrows it.

```
installed[2]{agent,scope,file}:
  claude-code,global,~/.claude/settings.json
  codex,global,~/.codex/hooks.json
skipped[1]{agent,reason}:
  opencode,not installed
help[1]:
  Run `squadquest-axi setup --status` to check, or `--uninstall` to remove
```

- **Explicit opt-in only.** No ordinary command ever installs a hook as a side effect.
- **Idempotent.** Re-running with the same resolved path is a silent no-op (AXI §6).
- **Path repair.** If a hook exists pointing at a stale executable path — after a
  reinstall, a version bump, or a move — setup rewrites it rather than adding a second
  entry.
- **Portable command.** The hook uses the bare binary name when it resolves on `PATH` to
  the current executable, and the absolute path otherwise, so a global install stays
  portable without risking a different binary.
- For Codex, ensures `[features].hooks = true` in `config.toml`.
- For OpenCode, writes a managed plugin to `~/.config/opencode/plugins/`.

## setup --status / --uninstall

`--status` reports per agent: installed, path, whether the path is current, and scope.
`--uninstall` removes only hooks this tool installed, and is idempotent.

## The skill (secondary path)

Per AXI §7, the hook is primary and an installable
[Agent Skill](https://agentskills.io) is the secondary discovery path — lower overhead,
broader agent support, no per-session token cost:

```sh
npx skills add SquadQuest/squadquest-axi
```

The skill is **generated from the same content the home view prints** (`npm run docs`),
with a `--check` CI gate that fails when the committed skill drifts. Single source of
truth; the skill can't fall out of date with the CLI's own guidance.

Because a skill is static and may be installed without the binary on `PATH`, the
generated version strips live state (upcoming events, counts) and rewrites command
examples to `npx -y squadquest-axi ...`.

The README presents hook and skill as two routes to the same outcome, and makes clear a
user needs only one.
