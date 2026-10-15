import type { AgentProvider } from "../../../src/lib/agent-provider";
import {
  asTeamId,
  asWorkspaceId,
  type TeamId,
  type WorkspaceId,
} from "../../../src/lib/entity-ids";
import { getClaimedChannelReply } from "../channels";
import { sha256 } from "../crypto-digest";
import { HttpError } from "../http-response";
import { getClaimedIssueAgentReply } from "../issue-agent-reply-repository";
import { toolError } from "./errors";

/**
 * Derives everything a workspace tool may touch from the authenticated claim
 * (docs/plans/agent-workspace-tools.md §Authorization). The caller never names
 * an organization, team or Agent: the Worker credential, the Worker binding,
 * the claim token hash and a live lease all have to match a running job, the
 * same checks the memory vault makes (memory-vault/scope.ts).
 */
export type AgentWorkspaceWorkKind = "issue" | "issueReply" | "channelReply" | "projectAgentTask";

export type AgentWorkspaceClaimInput = {
  readonly kind: AgentWorkspaceWorkKind;
  readonly workId: string;
  readonly runId: string;
  readonly claimToken: string;
  /** Channel replies carry their workspace in the claim identity. */
  readonly workspaceId: string | null;
};

export type AgentWorkspaceWorker = {
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly workerId: string;
  /** The team the Worker binding authenticated for. */
  readonly projectId: string;
};

/** The Agent the claim runs as; every note and post is attributed to it. */
export type ClaimAgent = {
  readonly id: string;
  readonly name: string;
};

/** What a claim may act on. One concept per field; nothing falls back to another. */
export type AgentWorkspaceScope = {
  readonly organizationId: WorkspaceId;
  /** Issue tools act on this team only: the Worker binding's team. */
  readonly teamId: TeamId;
  readonly workKind: AgentWorkspaceWorkKind;
  /** Idempotency scope: stable across retries and re-claims of the same work. */
  readonly workId: string;
  /** Null for an issue run without an assigned Agent; channel tools then refuse. */
  readonly agent: ClaimAgent | null;
  /** The provider running the turn, recorded as the author provider. */
  readonly provider: AgentProvider;
  /** The issue an `issue` claim is executing: its status belongs to `briar run`. */
  readonly executingRunId: string | null;
  /** The channel a channel-reply claim answers in: its reply goes through the reply itself. */
  readonly replyChannelId: string | null;
};

const inactive = () => toolError("claim_inactive", "The claim for this run is no longer active");

const TERMINAL_RUN_STATUSES = new Set(["completed", "cancelled", "blocked", "failed"]);

type AgentRow = { id: string; name: string; organization_id: string };

async function agentInOrganization(db: D1Database, agentId: string | null, organizationId: string) {
  if (agentId === null) return null;
  const agent = await db.prepare(`select id, name, organization_id from briar_project_agents where id = ?`)
    .bind(agentId).first<AgentRow>();
  // An Agent deleted mid-run leaves its claim without an identity to write as.
  if (!agent || agent.organization_id !== organizationId) return null;
  return { id: agent.id, name: agent.name } satisfies ClaimAgent;
}

async function teamOrganization(db: D1Database, teamId: string) {
  const team = await db.prepare(`select organization_id from briar_projects where id = ?`)
    .bind(teamId).first<{ organization_id: string | null }>();
  return team?.organization_id ?? null;
}

export async function resolveAgentWorkspaceScope(db: D1Database, input: {
  readonly claim: AgentWorkspaceClaimInput;
  readonly worker: AgentWorkspaceWorker;
  readonly provider: AgentProvider;
  readonly observedAt: string;
}): Promise<AgentWorkspaceScope> {
  const { claim, worker, observedAt } = input;
  if (!claim.claimToken || claim.claimToken.length > 200) throw inactive();
  const claimTokenHash = await sha256(claim.claimToken);
  const organizationId = await teamOrganization(db, worker.projectId);
  if (organizationId === null || organizationId !== worker.workspaceId) throw inactive();
  const scope = (fields: {
    agentId: string | null;
    executingRunId: string | null;
    replyChannelId: string | null;
  }) => agentInOrganization(db, fields.agentId, organizationId).then((agent): AgentWorkspaceScope => ({
    organizationId: asWorkspaceId(organizationId),
    teamId: asTeamId(worker.projectId),
    workKind: claim.kind,
    workId: claim.workId,
    agent,
    provider: input.provider,
    executingRunId: fields.executingRunId,
    replyChannelId: fields.replyChannelId,
  }));
  switch (claim.kind) {
    case "issue": {
      const run = await db.prepare(`select agent_id, worker_id, claim_token_hash, lease_expires_at, status
        from briar_hunt_runs where id = ? and project_id = ?`)
        .bind(claim.runId, worker.projectId)
        .first<{ agent_id: string | null; worker_id: string | null; claim_token_hash: string | null;
          lease_expires_at: string | null; status: string }>();
      if (!run || run.worker_id !== worker.workerId || run.claim_token_hash !== claimTokenHash ||
          !run.lease_expires_at || run.lease_expires_at <= observedAt || TERMINAL_RUN_STATUSES.has(run.status)) {
        throw inactive();
      }
      return scope({ agentId: run.agent_id, executingRunId: claim.runId, replyChannelId: null });
    }
    case "issueReply": {
      const job = await getClaimedIssueAgentReply(db, worker.projectId, claim.workId, {
        workerId: worker.workerId,
        claimTokenHash,
        observedAt,
      });
      if (!job) throw inactive();
      // A job that names no Agent answers as the issue's own Agent.
      const run = await db.prepare(`select agent_id from briar_hunt_runs where id = ? and project_id = ?`)
        .bind(job.run_id, job.project_id).first<{ agent_id: string | null }>();
      return scope({ agentId: job.agent_id ?? run?.agent_id ?? null, executingRunId: null, replyChannelId: null });
    }
    case "projectAgentTask": {
      const job = await db.prepare(`select agent_id from briar_project_agent_task_jobs
        where id = ? and project_id = ? and status = 'running' and claimed_worker_id = ?
          and claim_token_hash = ? and lease_expires_at > ? and cancel_requested_at is null`)
        .bind(claim.workId, worker.projectId, worker.workerId, claimTokenHash, observedAt)
        .first<{ agent_id: string }>();
      if (!job) throw inactive();
      return scope({ agentId: job.agent_id, executingRunId: null, replyChannelId: null });
    }
    case "channelReply": {
      if (!claim.claimToken.startsWith("briar_channel_claim_") || claim.workspaceId !== worker.workspaceId) {
        throw inactive();
      }
      let job: Awaited<ReturnType<typeof getClaimedChannelReply>>;
      try {
        job = await getClaimedChannelReply(db, {
          jobId: claim.workId,
          deviceId: worker.deviceId,
          workerId: worker.workerId,
          claimTokenHash,
          observedAt,
        });
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) throw inactive();
        throw error;
      }
      if (!job || job.organization_id !== organizationId) throw inactive();
      return scope({ agentId: job.agent_id, executingRunId: null, replyChannelId: job.channel_id });
    }
  }
}
