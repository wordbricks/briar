# Workflow Worktrees

Auto Hunt gives every claimed issue its own git worktree, created from the
latest remote base branch. Work only inside the worktree that
`briar queue claim` returns (`work.workspace.path`) and never edit the
connected repository checkout, which every run shares. Manage worktrees through
`briar worktree list|show|remove` rather than raw `git worktree`
commands. See [docs/operations/workflow-worktrees.md](docs/operations/workflow-worktrees.md).

Gitignored files a fresh checkout needs (currently `.env.keys`) belong in
`.worktreeinclude`; add new ones there or worktree runs will fail on commands
that read them.

# D1 Schema Changes

Any approach that could write a million or more D1 rows — a migration, a
backfill, a rebuild — must be disclosed and explicitly approved before it runs.
Estimate the row count first (`docs/operations/d1-schema-changes.md` explains
how), state the figure and what drives it, and wait for a decision. Never settle
on your own that the cost is acceptable, and never let the number stay unknown
because the change looked small: the case that produced this rule was a
one-value enum addition to a 1,011-row table that would have written over three
million rows.

Never put an enum that can grow into a `CHECK (col in (…))` list. SQLite cannot
alter a CHECK in place and D1 blocks every shortcut, so adding one value means
rebuilding the table and parking every row its foreign-key cascade reaches —
1.2 million rows for a 1,011-row table, in the case that produced this rule. Use
a lookup table and a foreign key instead, as `migrations/0204_agent_provider_lookup.sql`
did for agent providers; a new value is then one `insert`. Keep CHECK for fixed
conditions: lengths, ranges, formats, cross-column invariants.

When a rebuild is unavoidable, generate the migration rather than writing it,
and do not park a descendant that reaches the table through a nullable foreign
key — null the column and restore it instead. Read
[docs/operations/d1-schema-changes.md](docs/operations/d1-schema-changes.md)
before changing any column constraint.

# Mobile App Changes

When modifying the mobile app, make the corresponding changes for both iOS and Android. Do not consider a mobile app change complete if only one platform has been updated.

# Web Deployments

Deploy all production web changes to Cloudflare. The landing site under
`apps/landing/` deploys to the existing `briar-landing` Cloudflare Worker
(`https://briar-landing.wbai.workers.dev`). Do not use OpenAI Sites or another
hosting provider for production web deployments. Build and test the landing
site from the merged `main` branch, then deploy the generated vinext Worker
with Wrangler while preserving its `ASSETS` and `IMAGES` bindings.

## Source Code Reference

Use `opensrc path` inside other commands to read source:

\`\`\`bash
rg "pattern" $(opensrc path <package>)
cat $(opensrc path <package>)/path/to/file
\`\`\`

## Learning more about Effect

This repository uses the Effect TypeScript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.
