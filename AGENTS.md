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
