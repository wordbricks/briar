import type { ClaimedChannelReply } from "./worker-queue-contract";

/**
 * Which workspace a claimed channel reply actually ran in. Written into the
 * `channel reply session:` log so the next latency investigation can tell a
 * turn that paid for a checkout from one that never needed it.
 *
 * - `none`: no repository checkout at all
 * - `reused`: a cached session worktree already on this Worker's disk
 * - `created`: a worktree fetched and added before the first round
 * - `on_demand`: a worktree the Agent asked for mid-turn
 */
export type ChannelReplyWorkspaceKind =
  | "none"
  | "reused"
  | "created"
  | "on_demand";

/** Only the claim fields the worktree gate reads. */
export type ChannelReplyWorktreeGateInput = Pick<
  ClaimedChannelReply,
  | "snapshot"
  | "activeSkill"
  | "skillExecutionTarget"
  | "delegation"
  | "agentMessageHop"
  | "inboundAgentMessage"
  | "routing"
>;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

/**
 * The channel kind carried by a claim's untrusted prompt snapshot, or null when
 * the snapshot does not name one. Read by the worktree gate below and by the
 * Worker loop, which renews a direct message's lease on a short interval so a
 * steer is noticed while the turn can still absorb it.
 */
export function channelReplySnapshotChannelKind(
  snapshot: unknown,
): string | null {
  const kind = record(record(snapshot)?.channel)?.kind;
  return typeof kind === "string" ? kind : null;
}

/**
 * Whether this reply starts with no repository checkout.
 *
 * A channel reply is never where code changes: project-changing work goes
 * through an issue proposal that a separate Worker run executes. So a plain DM
 * conversation turn pays neither the fetch nor the `git worktree add` up
 * front, and asks for a checkout only when it turns out to need one.
 *
 * Everything else keeps the old behaviour verbatim. A routing or execution
 * turn owns its retained worktree, a Skill execution and an Agent-to-Agent hop
 * are not conversation, and a delegated turn answers from a project it must be
 * able to read. Widening this to channel mentions later is one line: drop the
 * `dm` check.
 */
export function channelReplyStartsWithoutWorktree(
  reply: ChannelReplyWorktreeGateInput,
): boolean {
  if (channelReplySnapshotChannelKind(reply.snapshot) !== "dm") return false;
  if (reply.activeSkill !== null) return false;
  if (reply.skillExecutionTarget !== null) return false;
  if (reply.delegation !== null) return false;
  if (reply.agentMessageHop !== 0) return false;
  if (reply.inboundAgentMessage !== null) return false;
  if (reply.routing !== null) return false;
  return true;
}
