---
name: briar-workflow
description: Execute or track repository work through a Briar project's configured workflow. Use only when the agent is running inside the Briar app and is claiming queued work, recording run events and evidence, completing a run, or recovering a blocked or failed run.
---

# Briar Workflow

This file is a discovery stub. The detailed, version-matched workflow guide is embedded in
the Briar binary so the instructions cannot drift from the commands that will execute them.

## Resolve the CLI

Use `briar` when it is available on `PATH`. Otherwise, execute `scripts/briar` from this
Skill directory; it resolves the standard Briar installation. Choose once and use that same
executable for every Briar command in the run.

In examples below, replace `briar` with the selected script path when the command is not on
`PATH`; do not create an alias or switch executables midway.

If the selected executable cannot run, report its exact error and stop. Do not substitute
another Briar checkout or reconstruct commands from memory.

## Load the guide

Before running any project, queue, run, evidence, or worktree command, load the full guide:

```text
briar skills get briar-workflow
```

Read the returned Markdown completely, then follow it for the rest of the task. The guide
covers preflight, workflow snapshots, queue claims, workspace rules, run events, evidence,
Velen, optional Linear mirroring, release stages, completion, recovery, and cleanup.

Do not use the former bundled reference files or cached copies of this stub as operational
guidance. If `skills get` is unavailable, the selected CLI is not compatible with this
Skill; report that version mismatch and stop.
