# Agent workspace tools: issues and channels

Status: implemented on `claude/agent-workspace-tools` (2026-10-15), not deployed.

## Decision

Agents use Briar's task space (issues) and channel space the way a teammate
does: they share what others need in channels, create follow-up issues
themselves, note important findings on issues, and move issue status as work
progresses. This reverses the earlier rule in
[organization-chat-channels.md](organization-chat-channels.md) that agents never
create issues and only leave proposals.

User decisions (final):

1. **Fully autonomous.** No proposal or approval step for creating issues,
   adding notes, changing status or posting. The one exception is anything that
   would start Auto Hunt execution: putting an issue into `queued` creates a
   pending execution proposal on the issue (the existing
   `briar_issue_execution_proposals` path), and the tool answers that approval
   is pending. A person approves it with AcceptIssueExecutionProposal, unchanged.
2. **Channel scope.** Any non-DM, unarchived organization channel whose roster
   (`briar_channel_agents`) holds the run's Agent. DMs are never listed, read or
   posted to. Posts are limited per organization.
3. **All contexts.** Auto Hunt issue runs, issue conversation replies,
   channel/DM replies (including A2A hops and DM schedules, which are ordinary
   channel-reply claims), and project Agent tasks.

## Shape

The existing `tools` launcher (`memory-tools.js`, already shipped with every
Worker, sandbox image and desktop install) gains two command families next to
`tools memory`:

| Command | Effect |
| --- | --- |
| `tools issue list [--status S,S] [--text T] [--cursor C] [--limit N]` | Issues of the run's team, newest update first |
| `tools issue show <issue>` | Fields, description, last 20 notes, pending approval |
| `tools issue create --title T [--description D\|--description-file F] [--priority P] [--parent I] [--queue] [--request-key K]` | Backlog issue created by the Agent; `--queue` asks for execution approval |
| `tools issue note <issue> [text\|--body-file F] [--request-key K]` | Agent-authored note in the issue conversation |
| `tools issue status <issue> <backlog\|blocked\|completed\|cancelled\|queued> [--reason R] [--request-key K]` | Move; `queued` → approval request; a reason becomes a note |
| `tools issue update <issue> [--title] [--description…] [--priority] [--request-key K]` | Edit fields |
| `tools channel list` | Member channels (non-DM) |
| `tools channel read <channel> [--thread M] [--cursor C] [--limit N]` | Timeline or one thread |
| `tools channel post <channel> [text\|--body-file F] [--thread M] [--request-key K]` | Agent-authored post |

`<issue>` is a key (`AH-12`, including transfer aliases) or id; `<channel>` is
an id, slug or name. Output is one JSON object; exit 0/1/2 like `tools memory`.

Transport is the memory vault's (memory-vault-spec.md §6.1): the frame goes
through the per-turn file relay to the Worker CLI process holding the claim,
which calls new `WorkerQueueService` RPCs (`AgentIssue*`, `AgentChannel*`) with
the Worker credential, the claim identity and the turn's provider. The relay and
the launcher are now opened for every turn of the four run kinds, also when the
run has no memory vault; `tools memory` then answers `memory_unavailable`.

Each turn's trusted instructions get a `# Briar issues and channels` section
(before the memory section) saying when to use the tools, with one sentence per
run kind about how its own conversation relates to them.

## Authorization

The server derives everything from the claim (`agent-workspace-tools/claim.ts`):
Worker credential → Worker binding → claim token hash → running job with a live
lease on that Worker (the memory vault's checks). The caller never names an
organization, team or Agent.

* **Issue scope**: the team the Worker binding authenticated for. For issue,
  issue-reply and Agent-task claims that is the claim's own team.
* **Acting Agent**: the run's Agent (issue run `agent_id`; issue reply job agent,
  else the issue's agent; Agent task agent; channel reply agent). An issue run
  with no assigned Agent still gets issue tools, attributed to
  `author_agent_provider` only (shown as "Agent · Provider"); channel tools
  answer `no_agent`, because channel membership is a roster of Agents.
* **Provider**: the provider running the turn, sent by the Worker CLI and
  validated against the provider enum; it is display attribution only.

## Rules

* **Statuses.** An agent sets `backlog`, `blocked`, `completed`, `cancelled`.
  `queued` becomes an execution proposal, allowed only on a pristine backlog
  issue (the proposal insert guard's condition). `running`, `paused`, `failed`
  are lifecycle-owned and refused. An issue currently in execution (running,
  claimed, paused, or dispatched) is refused with `issue_in_execution`. The issue
  an `issue` claim is executing is refused with `own_run`: its status and result
  belong to `briar run`. Moves go through `moveHuntRun`, so hunt events,
  dashboard sync and the channel-approved reactivation rule apply as for a
  person's move.
* **Creation.** `recordHuntEvent` directly (like channel-approved issues), status
  backlog, `created_by_user_id` null, `requires_claim_token` 1, actor
  `agent:<id>`, context `{origin: "briar-agent-tool", createdByAgent, createdByProvider}`.
  DashboardRun exposes `created_by_agent`; desktop/web and iOS show the Agent as
  the creator.
* **Loop safety.** Notes and posts are direct agent-authored inserts. They never
  go through the person-message paths, carry no mentions and enqueue no reply
  job, so no tool call can start another agent turn. Agent-to-Agent work stays on
  the reply's `agentMessage` action with its hop and 30/hour limits. A person
  replying in a thread under an agent note still gets that Agent's reply, as for
  any agent message.
* **Own conversation.** A channel reply cannot post into the channel it is
  answering in; the reply is the answer there.
* **Rate limit.** 30 agent channel posts per organization per rolling hour (all
  agents together), the same ceiling as A2A. Constant
  `AGENT_CHANNEL_POST_HOURLY_LIMIT`; counted atomically with the insert.
* **Idempotency.** Every write carries a request key (`--request-key`, else a
  per-invocation UUID reused on the CLI's transport retries). A repeated
  `(organization, claim work, request key)` with the same payload returns the
  stored result with `replayed: true`; a different payload is
  `idempotency_conflict`.

## D1

`0223_agent_workspace_tool_requests.sql`: one new table
`briar_agent_workspace_tool_requests` (idempotency record and post rate counter)
plus a partial index. No rebuild, no backfill, no existing row touched; 0 rows
written by the migration. `operation` is bounded free text, not a CHECK list.

## Not covered

* **Desktop-run team-agent schedules.** `src/lib/team-agent-schedule-execution.ts`
  claims `briar_project_agent_schedule_runs` with the user's session and runs the
  Agent through the Tauri `run_project_agent` command, a local provider turn
  with its own host-tool loop and no Worker claim. There is no claim lease to
  authorize from and no `tools` relay. Covering it means either moving schedule
  runs onto Worker-claimed project Agent tasks or adding session-authorized host
  tools to the Rust loop; both are separate changes.
* The requests table is not pruned yet; rows are small and one per agent write.
* No per-organization ceiling on issue creation or notes.
