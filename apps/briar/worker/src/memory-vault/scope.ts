import { getClaimedChannelReply } from "../channels";
import { sha256 } from "../crypto-digest";
import { HttpError } from "../http-response";
import { getClaimedIssueAgentReply } from "../issue-agent-reply-repository";
import { MemoryVaultError } from "./errors";
import { memoryVaultEnabled, type MemoryVaultEnv } from "./flag";
import type { VaultKey, VaultScopeKind } from "./vault-repository";

/**
 * Derives the one vault a run may touch from its authenticated claim (spec §3,
 * §6.1). The caller never names an organization, owner, agent, channel,
 * project or vault: everything comes from the claim row that the Worker
 * credential, claim token hash, Worker binding and device all have to match.
 */
export type MemoryVaultWorkKind = "issue" | "issueReply" | "channelReply" | "projectAgentTask";

export type MemoryVaultClaim = {
  readonly kind: MemoryVaultWorkKind;
  readonly workId: string;
  readonly runId: string;
  readonly claimToken: string;
  /** Channel replies carry their workspace in the claim identity. */
  readonly workspaceId: string | null;
};

export type MemoryVaultWorker = {
  readonly workspaceId: string;
  readonly deviceId: string;
  /** `briar_execution_workers.id` of the authenticated binding. */
  readonly workerId: string;
  /** The project the Worker binding authenticated for. */
  readonly projectId: string;
};

export type MemoryVaultDmSpace = {
  readonly id: string;
  readonly ownerUserId: string;
  readonly useEnabled: boolean;
  readonly autoEnabled: boolean;
};

export type ResolvedVaultScope = {
  readonly key: VaultKey;
  readonly dmSpace: MemoryVaultDmSpace | null;
  readonly claimTokenHash: string;
  readonly workId: string;
  readonly agentId: string;
  /** The claim's trigger message was written by the DM owner (dm) or by a person (group, issue reply). */
  readonly triggeredByPerson: boolean;
};

const inactive = () => new MemoryVaultError("claim_inactive", "The claim for this run is no longer active");

const TERMINAL_RUN_STATUSES = new Set(["completed", "cancelled", "blocked", "failed"]);

async function channelReplyScope(db: D1Database, claim: MemoryVaultClaim, worker: MemoryVaultWorker,
  claimTokenHash: string, observedAt: string): Promise<ResolvedVaultScope> {
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
    // A revoked DM memory fence means the claim may not continue at all.
    if (error instanceof HttpError && error.status === 409) throw inactive();
    throw error;
  }
  if (!job || job.organization_id !== worker.workspaceId) throw inactive();
  const trigger = await db.prepare(`select author_user_id from briar_channel_messages
    where id = ? and channel_id = ? and deleted_at is null`)
    .bind(job.trigger_message_id, job.channel_id).first<{ author_user_id: string | null }>();
  // The space was bound to this exact claim when it was handed out
  // (bindDmMemoryReplyClaim); no fence means the channel is not an eligible DM.
  const space = await db.prepare(`select space.id, space.owner_user_id, space.use_enabled, space.auto_enabled
    from briar_dm_memory_reply_fences fence
    join briar_dm_memory_spaces space on space.id = fence.space_id
    where fence.job_id = ? and fence.claim_token_hash = ? and space.status = 'active'
      and space.revocation_epoch = fence.revocation_epoch
      and space.organization_id = ? and space.channel_id = ? and space.agent_id = ?`)
    .bind(job.id, claimTokenHash, job.organization_id, job.channel_id, job.agent_id)
    .first<{ id: string; owner_user_id: string; use_enabled: number; auto_enabled: number }>();
  const fenced = await db.prepare(`select 1 from briar_dm_memory_reply_fences where job_id = ?`)
    .bind(job.id).first();
  if (fenced && !space) throw inactive();
  if (space) {
    return {
      key: { organizationId: job.organization_id, agentId: job.agent_id, scopeKind: "dm", scopeKey: space.id },
      dmSpace: {
        id: space.id,
        ownerUserId: space.owner_user_id,
        useEnabled: space.use_enabled === 1,
        autoEnabled: space.auto_enabled === 1,
      },
      claimTokenHash,
      workId: claim.workId,
      agentId: job.agent_id,
      triggeredByPerson: trigger?.author_user_id === space.owner_user_id,
    };
  }
  return {
    key: { organizationId: job.organization_id, agentId: job.agent_id, scopeKind: "group", scopeKey: job.channel_id },
    dmSpace: null,
    claimTokenHash,
    workId: claim.workId,
    agentId: job.agent_id,
    triggeredByPerson: Boolean(trigger?.author_user_id),
  };
}

const projectScope = (input: {
  organizationId: string; agentId: string; projectId: string; claimTokenHash: string; workId: string;
  triggeredByPerson: boolean;
}): ResolvedVaultScope => ({
  key: { organizationId: input.organizationId, agentId: input.agentId, scopeKind: "project", scopeKey: input.projectId },
  dmSpace: null,
  claimTokenHash: input.claimTokenHash,
  workId: input.workId,
  agentId: input.agentId,
  triggeredByPerson: input.triggeredByPerson,
});

/**
 * Validates the claim and returns its vault scope; null when the claim is live
 * but has no Agent (an issue run without an assigned Agent has no vault).
 */
export async function resolveMemoryVaultScope(db: D1Database, input: {
  readonly claim: MemoryVaultClaim;
  readonly worker: MemoryVaultWorker;
  readonly observedAt: string;
}): Promise<ResolvedVaultScope | null> {
  const { claim, worker, observedAt } = input;
  if (!claim.claimToken || claim.claimToken.length > 200) throw inactive();
  const claimTokenHash = await sha256(claim.claimToken);
  switch (claim.kind) {
    case "channelReply":
      return channelReplyScope(db, claim, worker, claimTokenHash, observedAt);
    case "issue": {
      const run = await db.prepare(`select run.agent_id, run.worker_id, run.claim_token_hash, run.lease_expires_at,
          run.status, run.project_id, project.organization_id
        from briar_hunt_runs run join briar_projects project on project.id = run.project_id
        where run.id = ? and run.project_id = ?`)
        .bind(claim.runId, worker.projectId)
        .first<{ agent_id: string | null; worker_id: string | null; claim_token_hash: string | null;
          lease_expires_at: string | null; status: string; project_id: string; organization_id: string | null }>();
      if (
        !run || run.worker_id !== worker.workerId || run.claim_token_hash !== claimTokenHash ||
        !run.lease_expires_at || run.lease_expires_at <= observedAt || TERMINAL_RUN_STATUSES.has(run.status) ||
        run.organization_id !== worker.workspaceId
      ) {
        throw inactive();
      }
      if (!run.agent_id) return null;
      return projectScope({ organizationId: run.organization_id, agentId: run.agent_id, projectId: run.project_id,
        claimTokenHash, workId: claim.runId, triggeredByPerson: false });
    }
    case "issueReply": {
      const job = await getClaimedIssueAgentReply(db, worker.projectId, claim.workId, {
        workerId: worker.workerId,
        claimTokenHash,
        observedAt,
      });
      if (!job) throw inactive();
      const context = await db.prepare(`select project.organization_id, message.author_user_id
        from briar_projects project
        left join briar_issue_messages message on message.id = ? and message.project_id = project.id
        where project.id = ?`)
        .bind(job.trigger_message_id, job.project_id)
        .first<{ organization_id: string | null; author_user_id: string | null }>();
      if (!context || context.organization_id !== worker.workspaceId) throw inactive();
      if (!job.agent_id) return null;
      return projectScope({ organizationId: context.organization_id, agentId: job.agent_id,
        projectId: job.project_id, claimTokenHash, workId: claim.workId,
        triggeredByPerson: Boolean(context.author_user_id) });
    }
    case "projectAgentTask": {
      const job = await db.prepare(`select job.agent_id, job.project_id, project.organization_id
        from briar_project_agent_task_jobs job join briar_projects project on project.id = job.project_id
        where job.id = ? and job.project_id = ? and job.status = 'running'
          and job.claimed_worker_id = ? and job.claim_token_hash = ?
          and job.lease_expires_at > ? and job.cancel_requested_at is null`)
        .bind(claim.workId, worker.projectId, worker.workerId, claimTokenHash, observedAt)
        .first<{ agent_id: string; project_id: string; organization_id: string | null }>();
      if (!job || job.organization_id !== worker.workspaceId) throw inactive();
      return projectScope({ organizationId: job.organization_id, agentId: job.agent_id, projectId: job.project_id,
        claimTokenHash, workId: claim.workId, triggeredByPerson: false });
    }
  }
}

export type VaultAccess = {
  readonly enabled: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
  /** `--user-requested` is honoured on this turn. */
  readonly userRequestedWritable: boolean;
};

export { memoryVaultEnabled, type MemoryVaultEnv } from "./flag";

/** Opt-in and authority (spec §4). */
export function vaultAccess(env: MemoryVaultEnv, scope: ResolvedVaultScope): VaultAccess {
  if (!memoryVaultEnabled(env)) {
    return { enabled: false, readable: false, writable: false, userRequestedWritable: false };
  }
  if (scope.dmSpace) {
    return {
      enabled: true,
      readable: scope.dmSpace.useEnabled,
      writable: scope.dmSpace.autoEnabled,
      userRequestedWritable: scope.triggeredByPerson,
    };
  }
  return { enabled: true, readable: true, writable: true, userRequestedWritable: scope.triggeredByPerson };
}

export function assertWritable(access: VaultAccess, userRequested: boolean) {
  if (!access.enabled) throw new MemoryVaultError("memory_disabled", "Memory is not available for this run");
  if (userRequested) {
    if (!access.userRequestedWritable) {
      throw new MemoryVaultError(
        "write_not_allowed",
        "--user-requested applies only on a turn the person started by asking for it",
      );
    }
    return;
  }
  if (!access.writable) {
    throw new MemoryVaultError(
      "write_not_allowed",
      "Automatic memory writing is off here; write only when the person asks, with --user-requested",
    );
  }
}

export function assertReadable(access: VaultAccess) {
  if (!access.readable) throw new MemoryVaultError("memory_disabled", "Memory recall is off for this conversation");
}

/** The one status line injected after the README (spec §4, §7). */
export function vaultStatusLine(scopeKind: VaultScopeKind, access: VaultAccess) {
  if (scopeKind !== "dm") {
    return `Memory status: this ${scopeKind === "group" ? "conversation's" : "project's"} memory is on; list, read, search, journal and save are allowed. Personal profiles (type person) are not kept here.`;
  }
  const recall = access.readable
    ? "recall is on (list, read, search)"
    : "recall is off; do not list, read or search memory";
  const write = access.writable
    ? "journal and save are allowed"
    : access.userRequestedWritable
      ? "journal and save only what the person asks you to remember on this turn, with --user-requested"
      : "do not write to memory on this turn";
  return `Memory status: ${recall}; ${write}.`;
}
