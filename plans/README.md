# Plans

Plans are **motion**; [`../specs/`](../specs/README.md) are **state**. A plan is the
work-in-flight record that bridges a spec to merged code — it names the specs it
implements, declares what it's blocked on, and freezes to `done` as the durable record of
what actually got built.

The full protocol lives in
[`.agents/skills/specops/references/plans-protocol.md`](../.agents/skills/specops/references/plans-protocol.md).
Read it before authoring or closing a plan.

Don't maintain a status table or a DAG drawing in this file — both rot. The CLI
regenerates that view on demand:

```sh
.agents/skills/specops/scripts/specops          # dashboard
.agents/skills/specops/scripts/specops next     # what's ready to work on
.agents/skills/specops/scripts/specops dag      # the dependency graph
```
