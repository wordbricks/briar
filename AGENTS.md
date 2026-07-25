# Auto Hunt Worktrees

Auto Hunt gives every claimed issue its own git worktree, created from the
latest remote base branch. Work only inside the worktree that
`briar auto-hunt next` returns (`issue.worktree.path`) and never edit the
connected repository checkout, which every run shares. Manage worktrees through
`briar auto-hunt worktree list|show|remove` rather than raw `git worktree`
commands. See [docs/operations/auto-hunt-worktrees.md](docs/operations/auto-hunt-worktrees.md).

Gitignored files a fresh checkout needs (currently `.env.keys`) belong in
`.worktreeinclude`; add new ones there or worktree runs will fail on commands
that read them.

# Mobile App Changes

When modifying the mobile app, make the corresponding changes for both iOS and Android. Do not consider a mobile app change complete if only one platform has been updated.
