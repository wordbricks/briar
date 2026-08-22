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

# Mobile App Changes

When modifying the mobile app, make the corresponding changes for both iOS and Android. Do not consider a mobile app change complete if only one platform has been updated.

# Web Deployments

Deploy all production web changes to Cloudflare. The landing site under
`apps/landing/` deploys to the existing `briar-landing` Cloudflare Worker
(`https://briar-landing.wbai.workers.dev`). Do not use OpenAI Sites or another
hosting provider for production web deployments. Build and test the landing
site from the merged `main` branch, then deploy the generated vinext Worker
with Wrangler while preserving its `ASSETS` and `IMAGES` bindings.

## Learning more about Effect

This repository uses the Effect TypeScript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.
