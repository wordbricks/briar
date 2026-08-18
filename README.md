<img src="./src/assets/app-icons/aubergine-riso.png" alt="Briar logo" width="72" />

# Briar

[English](README.md) · [简体中文](README.zh-CN.md)

Briar is a cloud-coordinated, local-execution Agent Development Environment for taking coding-agent work from issue to PR.

It turns issues into structured runs, gives each run an isolated Git worktree, and keeps progress, evidence, conversations, and human review in one place. Use Codex, Claude, Grok, or OpenCode through the accounts and local CLIs you already have.

[![Briar issue-to-complete demo](./landing/public/briar-issue-to-complete-demo.gif)](./landing/public/briar-issue-to-complete-demo.mp4)

## What it does

- Collect issues in a shared backlog and queue from the desktop, web, mobile companions, or Slack.
- Run saved project agents with Codex, Claude, Grok, and OpenCode.
- Process queued work through Auto Hunt, with a separate Git worktree for every claimed issue.
- Define repository-specific stages such as analysis, implementation, local QA, review, and release.
- Record retry-safe status updates and evidence so people can see what changed, what passed, and what still needs attention.
- Pause at review checkpoints, continue after approval, and keep the full issue conversation attached to the run.
- Connect GitHub for pull-request status, with optional Velen context and Linear mirroring.
- Keep repository source and paths on the machine running the agent.

## How to use

> [!WARNING]
> Briar needs at least one supported coding-agent CLI installed and authenticated: Codex CLI, Claude Code, Grok CLI, or OpenCode CLI.

Download the latest [Briar desktop release for macOS Apple Silicon](https://briar-api.wbai.workers.dev/releases/latest/mac-aarch64.dmg). Android companion builds and release notes are available on the [GitHub Releases page](https://github.com/wordbricks/briar/releases/latest).

1. Sign in and connect a local Git repository.
2. Choose an agent provider and review the workflow Briar generates for the project.
3. Create issues, set their priority, and move ready work into the queue.
4. Ask a saved project agent to run Auto Hunt when you want queued issues processed.
5. Follow each run from the dashboard, inspect its evidence, and approve or revise the result at review checkpoints.

Briar installs and keeps its CLI and workflow skills in sync when a project is connected. Velen, Linear, Slack, and GitHub integrations are optional.

## Local development

Requirements: Bun 1.3.14, Rust 1.96.0, the Tauri system prerequisites, Wrangler 4.x, and at least one supported coding-agent CLI.

```sh
bun install
bun run worker:types
bun tauri dev
```

Without a Worker URL, the app opens its built-in demo dashboard. To run the desktop app, local Worker, and local D1 database together, add the private key file required to decrypt the development environment and run:

```sh
bun run dev:all
```

Useful checks:

For the fastest pre-PR validation, run `bun run check`.

```sh
bun run check
bun test
bun run ci:local
```

## Privacy

Briar runs agents against the Git repository on your machine. Repository source and the local repository path are not uploaded to the Briar Worker.

The Worker stores account, organization, project, issue, and Auto Hunt state in Cloudflare D1, along with the task and Git metadata needed to coordinate runs. The coding-agent provider you choose still receives the prompts, file context, command output, and tool results required for its session through its own authenticated client.

## Some notes

Briar is under active development. Expect fast-moving internals and occasional rough edges.

Focused issues and pull requests are welcome, especially bug fixes, reliability improvements, documentation, and small maintenance changes.

## Contributing

Before opening a pull request, run the relevant local checks and keep changes scoped. Workflow and operations documentation lives in [`docs/`](docs/), including guides for [isolated worktrees](docs/operations/workflow-worktrees.md), [GitHub integration](docs/operations/github-integration.md), [Slack integration](docs/operations/slack-integration.md), and [production releases](docs/operations/production-release.md).

Need help or found a bug? [Open a GitHub issue](https://github.com/wordbricks/briar/issues).

## License

Except where otherwise noted, Briar is licensed under the [Apache License 2.0](LICENSE). Third-party components remain subject to their respective licenses.
