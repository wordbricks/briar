import { claimNextChannelReplyWork } from "../channel-reply-claim-routes";
import { createChannel, createChannelMessage, enqueueChannelAgentReplies } from "../channels";
import { sha256 } from "../crypto-digest";
import { InMemoryVaultGitStore } from "../memory-vault/in-memory-git-store";
import type { MemoryVaultCaller, MemoryVaultDeps } from "../memory-vault/operations";
import { createWorkspaceAgent } from "../workspace-agents";
import { requireWorkerProjectBinding } from "../worker-route-auth";
import { workerRuntimeProtoJsonFixture } from "./worker-runtime";

/**
 * One workspace with two people, one Agent and one Worker, able to hand out
 * real live claims of every kind a vault serves: DM replies (bound to their DM
 * memory space by the production claim path), group channel replies, issue
 * runs and project Agent tasks. Local D1 fixtures only.
 */
export async function memoryVaultFixture(db: D1Database) {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const workerId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const workerToken = `briar_worker_${crypto.randomUUID().replaceAll("-", "")}`;
  const runtimeJson = workerRuntimeProtoJsonFixture({ agentProvider: "codex", providers: ["codex"] });
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values (?, 'Vault Owner', ?, 1, ?, ?)`).bind(ownerId, `${ownerId}@example.test`, now, now),
    db.prepare(`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values (?, 'Vault Other', ?, 1, ?, ?)`).bind(otherUserId, `${otherUserId}@example.test`, now, now),
    db.prepare(`insert into briar_organizations (id, name, handle, created_at, updated_at)
      values (?, 'Vault Org', ?, ?, ?)`).bind(workspaceId, workspaceId, now, now),
    db.prepare(`insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
      values (?, ?, 'owner', ?, ?)`).bind(workspaceId, ownerId, now, now),
    db.prepare(`insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
      values (?, ?, 'developer', ?, ?)`).bind(workspaceId, otherUserId, now, now),
    db.prepare(`insert into briar_teams (id, owner_user_id, organization_id, name, agent_token_hash, created_at, updated_at)
      values (?, ?, ?, 'Vault Project', ?, ?, ?)`).bind(projectId, ownerId, workspaceId, projectId.replaceAll("-", "").repeat(2), now, now),
    db.prepare(`insert into briar_execution_worker_devices (id, organization_id, owner_user_id, label,
        device_identity_hash, state, last_heartbeat_at, created_at, updated_at)
      values (?, ?, ?, 'Vault Device', ?, 'online', ?, ?, ?)`)
      .bind(deviceId, workspaceId, ownerId, deviceId.replaceAll("-", "").repeat(2), now, now, now),
    db.prepare(`insert into briar_execution_worker_credentials (device_id, token_hash, created_at)
      values (?, ?, ?)`).bind(deviceId, await sha256(workerToken), now),
    db.prepare(`insert into briar_execution_workers (id, project_id, device_id, label, host_fingerprint,
        runtime_proto_json, state, accepting_work, readiness_state, last_heartbeat_at, created_at, updated_at)
      values (?, ?, ?, 'Vault Worker', ?, ?, 'online', 1, 'ready', ?, ?, ?)`)
      .bind(workerId, projectId, deviceId, "e".repeat(64), runtimeJson, now, now, now),
  ]);
  await createWorkspaceAgent(db, {
    id: agentId, workspaceId, name: "Vault Agent", provider: "codex", model: null,
    responsibility: "Memory vault tests", effort: null, createdAt: now,
  });

  const worker = { workspaceId, deviceId, workerId, projectId };
  const request = () => new Request("https://briar.example", { headers: { authorization: `Bearer ${workerToken}` } });

  /** Advertise (or stop advertising) `capabilities.memoryVaultProtocol = 1` on this Worker. */
  async function setVaultCapable(capable: boolean) {
    await db.prepare(capable
      ? `update briar_execution_workers set runtime_proto_json =
          json_set(runtime_proto_json, '$.capabilities.memoryVaultProtocol', 1) where id = ?`
      : `update briar_execution_workers set runtime_proto_json =
          json_remove(runtime_proto_json, '$.capabilities.memoryVaultProtocol') where id = ?`)
      .bind(workerId).run();
  }

  /**
   * Posts a message from `author` in a fresh channel and claims the Agent's
   * reply on this Worker. `vaultEnabled` claims with `MEMORY_VAULT_ENABLED`.
   */
  async function claimChannel(kind: "dm" | "channel", author: string, body = "Please remember this.",
    options: { vaultEnabled?: boolean } = {}) {
    const channelId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const at = new Date().toISOString();
    await createChannel(db, kind === "dm"
      ? {
          id: channelId, workspaceId, kind: "dm", dmKey: `agent:${JSON.stringify([author, channelId])}`, slug: channelId,
          name: "Vault DM", visibility: "private", topic: null, defaultProjectId: null, createdByUserId: author,
          agentIds: [agentId], createdAt: at,
        }
      : {
          id: channelId, workspaceId, kind: "channel", dmKey: null, slug: channelId, name: "Vault group",
          visibility: "public", topic: null, defaultProjectId: null, createdByUserId: author,
          memberIds: [ownerId, otherUserId], agentIds: [agentId], createdAt: at,
        });
    await createChannelMessage(db, {
      id: messageId, channelId, parentMessageId: null, authorUserId: author, authorAgentId: null,
      authorAgentName: null, authorAgentProvider: null, body, mentionedUserIds: [], mentionedAgentIds: [agentId],
      createdAt: at,
    });
    const jobs = await enqueueChannelAgentReplies(db, {
      workspaceId, channelId, triggerMessageId: messageId, parentMessageId: messageId,
      agents: [{ id: agentId, projectId: null, provider: "codex" }], createdAt: at,
    });
    // Past the DM settle window: the person stopped typing.
    await db.prepare(`update briar_channel_agent_reply_jobs set created_at = ? where id = ?`)
      .bind(new Date(Date.now() - 120_000).toISOString(), jobs[0]!.id).run();
    const claimed = await claimNextChannelReplyWork({
      input: { workspaceId, workerId },
      db,
      env: {
        DB: db, DM_MEMORY_RETRIEVAL_ENABLED: "true", DM_MEMORY_MINIMUM_SCORE: "",
        MEMORY_VAULT_ENABLED: options.vaultEnabled ? "true" : "false",
      } as unknown as Env,
      authenticatedWorker: await requireWorkerProjectBinding(db, request(), projectId, workerId),
    });
    if (!claimed || claimed.workId !== jobs[0]!.id) throw new Error("The fixture reply was not claimed");
    const caller: MemoryVaultCaller = {
      claim: { kind: "channelReply", workId: claimed.workId, runId: claimed.runId, claimToken: claimed.claimToken, workspaceId },
      worker,
    };
    return { caller, channelId, messageId, jobId: claimed.workId, claimToken: claimed.claimToken, runId: claimed.runId, claimed };
  }

  async function spaceOf(channelId: string) {
    const space = await db.prepare(`select id from briar_dm_memory_spaces where channel_id = ? and agent_id = ?`)
      .bind(channelId, agentId).first<{ id: string }>();
    if (!space) throw new Error("No DM memory space was bound");
    return space.id;
  }

  async function setDmMemory(channelId: string, flags: { use: boolean; auto: boolean }) {
    await db.prepare(`update briar_dm_memory_spaces set use_enabled = ?, auto_enabled = ?, ever_saved = ?
      where channel_id = ? and agent_id = ?`)
      .bind(flags.use ? 1 : 0, flags.auto ? 1 : 0, flags.use ? 1 : 0, channelId, agentId).run();
  }

  /** A live issue run assigned to this Agent and claimed by this Worker. */
  async function claimIssueRun(options: { agent?: boolean } = {}) {
    const runId = crypto.randomUUID();
    const claimToken = `briar_claim_${crypto.randomUUID().replaceAll("-", "")}`;
    const at = new Date().toISOString();
    await db.prepare(`insert into briar_hunt_runs (
        id, project_id, source, source_key, title, stage, status, workflow_stage, workflow_snapshot_json,
        issue_checkpoints_json, repository, started_at, last_event_at, created_at, updated_at,
        worker_id, claim_token_hash, lease_expires_at, agent_id)
      values (?, ?, 'issue', ?, 'Vault run', 'implementing', 'running', 'implementing', '{}', '[]',
        'briar/vault', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(runId, projectId, `vault-${runId}`, at, at, at, at, workerId, await sha256(claimToken),
        new Date(Date.now() + 3_600_000).toISOString(), options.agent === false ? null : agentId)
      .run();
    const caller: MemoryVaultCaller = {
      claim: { kind: "issue", workId: runId, runId, claimToken, workspaceId: null },
      worker,
    };
    return { caller, runId, claimToken };
  }

  /** A running project Agent task claimed by this Worker. */
  async function claimAgentTask() {
    const taskId = crypto.randomUUID();
    const claimToken = `briar_claim_${crypto.randomUUID().replaceAll("-", "")}`;
    const at = new Date().toISOString();
    await db.prepare(`insert into briar_project_agent_task_jobs (
        id, project_id, agent_id, request, request_id, status, preferred_worker_id, claimed_worker_id,
        claim_token_hash, claimed_at, lease_expires_at, attempts, created_at, updated_at)
      values (?, ?, ?, 'Vault task', ?, 'running', ?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind(taskId, projectId, agentId, crypto.randomUUID(), workerId, workerId, await sha256(claimToken), at,
        new Date(Date.now() + 3_600_000).toISOString(), at, at)
      .run();
    const caller: MemoryVaultCaller = {
      claim: { kind: "projectAgentTask", workId: taskId, runId: taskId, claimToken, workspaceId: null },
      worker,
    };
    return { caller, taskId, claimToken };
  }

  return {
    workspaceId, projectId, ownerId, otherUserId, agentId, workerId, deviceId, workerToken, worker, request,
    claimChannel, claimIssueRun, claimAgentTask, spaceOf, setDmMemory, setVaultCapable,
  };
}

export type MemoryVaultFixture = Awaited<ReturnType<typeof memoryVaultFixture>>;

export function memoryVaultDeps(db: D1Database, overrides: Partial<MemoryVaultDeps> = {}) {
  const store = new InMemoryVaultGitStore();
  const deps: MemoryVaultDeps & { store: InMemoryVaultGitStore } = {
    db,
    env: { MEMORY_VAULT_ENABLED: "true" },
    store,
    sleep: async () => {},
    ...overrides,
  } as MemoryVaultDeps & { store: InMemoryVaultGitStore };
  return deps;
}
