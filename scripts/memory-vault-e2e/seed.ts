/**
 * Seeds the local D1 of the e2e dev server.
 *
 * Raw local inserts only where the product has no RPC a test can drive
 * without a browser sign-in or a device enrolment: the two people and their
 * sessions, the workspace and its members, the project, and the Worker
 * (device, credential, runtime advertisement). Everything else goes through
 * the real RPCs as the person: the Agent (AgentService), the two DMs and the
 * group channel (ChannelService), DM memory opt-in (DmMemoryService).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { agentProviders } from "../../apps/briar/src/lib/agent-provider";
import { emptyAgentProviderCapabilityCatalog } from "../../apps/briar/src/lib/agent-provider-contract";
import type { WorkerRuntimeInput } from "../../apps/briar/src/lib/worker-runtime-proto";
import { createWorkerControlClient } from "../../apps/briar/src-cli/worker-control-client";
import { workerRuntimeProtoJsonFixture } from "../../apps/briar/worker/src/test-helpers/worker-runtime";
import { apiUrl, appClients, d1, type E2eState, sha256Hex } from "./lib";

const AGENT_PROVIDER_CLAUDE = 2;
const CHANNEL_VISIBILITY_PRIVATE = 2;

export async function seed(): Promise<E2eState> {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const userA = { id: randomUUID(), token: `e2e-session-${randomBytes(16).toString("hex")}` };
  const userB = { id: randomUUID(), token: `e2e-session-${randomBytes(16).toString("hex")}` };
  const workerId = randomUUID();
  const deviceId = randomUUID();
  const workerToken = `briar_worker_${randomBytes(16).toString("hex")}`;
  // The CLI advertises `memoryVaultProtocol = 1` (docs/operations/memory-vault.md, rollout step 2).
  const runtime = JSON.parse(workerRuntimeProtoJsonFixture({ agentProvider: "claude", providers: ["claude"] }));
  runtime.capabilities = { ...runtime.capabilities, memoryVaultProtocol: 1 };

  const statements: Array<[string, Array<string | number | null>]> = [
    [`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt) values (?, 'E2E User A', ?, 1, ?, ?)`,
      [userA.id, `${userA.id}@e2e.invalid`, now, now]],
    [`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt) values (?, 'E2E User B', ?, 1, ?, ?)`,
      [userB.id, `${userB.id}@e2e.invalid`, now, now]],
    [`insert into "session" (id, expiresAt, token, createdAt, updatedAt, userId) values (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), expires, userA.token, now, now, userA.id]],
    [`insert into "session" (id, expiresAt, token, createdAt, updatedAt, userId) values (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), expires, userB.token, now, now, userB.id]],
    [`insert into briar_organizations (id, name, handle, created_at, updated_at) values (?, 'E2E Org', ?, ?, ?)`,
      [workspaceId, `e2e-${workspaceId.slice(0, 8)}`, now, now]],
    [`insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at) values (?, ?, 'owner', ?, ?)`,
      [workspaceId, userA.id, now, now]],
    [`insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at) values (?, ?, 'developer', ?, ?)`,
      [workspaceId, userB.id, now, now]],
    [`insert into briar_teams (id, owner_user_id, organization_id, name, agent_token_hash, created_at, updated_at) values (?, ?, ?, 'E2E Project', ?, ?, ?)`,
      [projectId, userA.id, workspaceId, sha256Hex(randomUUID()), now, now]],
    [`insert into briar_execution_worker_devices (id, organization_id, owner_user_id, label, device_identity_hash, state, last_heartbeat_at, created_at, updated_at)
      values (?, ?, ?, 'E2E Device', ?, 'online', ?, ?, ?)`,
      [deviceId, workspaceId, userA.id, sha256Hex(deviceId), now, now, now]],
    [`insert into briar_execution_worker_credentials (device_id, token_hash, created_at) values (?, ?, ?)`,
      [deviceId, sha256Hex(workerToken), now]],
    [`insert into briar_execution_workers (id, project_id, device_id, label, host_fingerprint, runtime_proto_json, state, accepting_work,
        readiness_state, last_heartbeat_at, created_at, updated_at)
      values (?, ?, ?, 'E2E Worker', ?, ?, 'online', 1, 'ready', ?, ?, ?)`,
      [workerId, projectId, deviceId, "e".repeat(64), JSON.stringify(runtime), now, now, now]],
  ];
  for (const [sql, params] of statements) await d1(sql, params);

  const a = appClients(userA.token);
  const b = appClients(userB.token);
  const agentName = "Mori";
  const agent = await a.agents.createWorkspaceAgent({
    workspaceId,
    name: agentName,
    provider: AGENT_PROVIDER_CLAUDE,
    responsibility: "Personal assistant for the memory vault end-to-end check",
  });
  const agentId = agent.agent!.agentId;
  const dmA = (await a.channels.createDirectMessage({ workspaceId, memberIds: [], agentIds: [agentId] })).channel!.id;
  const dmB = (await b.channels.createDirectMessage({ workspaceId, memberIds: [], agentIds: [agentId] })).channel!.id;
  const group = (await a.channels.createChannel({
    workspaceId, name: "e2e-group", visibility: CHANNEL_VISIBILITY_PRIVATE,
  })).channel!.id;
  await a.channels.setChannelMember({ workspaceId, channelId: group, userId: userB.id, membership: { case: "add", value: {} } });
  await a.channels.setChannelAgent({ workspaceId, channelId: group, agentId, membership: { case: "add", value: {} } });

  return {
    workspaceId, projectId, userA, userB, agentId, agentName, workerId, deviceId, workerToken,
    dmA, dmB, group, adminToken: randomBytes(24).toString("hex"),
  };
}

/** Turns DM memory on (recall + automatic writing) as the DM's owner, through DmMemoryService. */
export async function enableDmMemory(token: string, workspaceId: string, channelId: string) {
  const client = appClients(token).dmMemory;
  const listed = await client.listDmMemories({ workspaceId, channelId });
  const space = listed.spaces.find((candidate) => candidate.id === listed.selectedSpaceId) ?? listed.spaces[0];
  const updated = await client.updateDmMemorySettings({
    workspaceId,
    channelId,
    requestId: randomUUID(),
    memorySpaceId: space?.id,
    expectedMemoryRevision: space?.memoryRevision ?? 0n,
    useEnabled: true,
    autoEnabled: true,
  });
  return { eligible: listed.eligible, space: updated.space };
}

/** The Worker's runtime advertisement: Claude only, `memoryVaultProtocol = 1` (as the shipped CLI). */
function runtimeInput(): WorkerRuntimeInput {
  const providerHealth = Object.fromEntries(agentProviders.map((provider) => [provider, {
    installed: provider === "claude", authenticated: provider === "claude", healthy: provider === "claude",
    reason: provider === "claude" ? null : "not_installed", usageExhausted: false, maxUsedPercent: null,
  }])) as WorkerRuntimeInput["providerHealth"];
  return {
    agentProvider: "claude",
    providerHealth,
    providerCapabilities: emptyAgentProviderCapabilityCatalog(),
    versions: { briar: "1.2.229" },
    worktrees: true,
    remoteUpdates: { supported: true, protocol: 1 },
    workflowRequirements: [],
    memoryVault: { protocol: 1 },
  };
}

/**
 * One `WorkerControlService.HeartbeatWorker` through the CLI's own client. A
 * claim is refused once the last heartbeat is stale, so run.ts repeats it the
 * way a running Worker does.
 */
export async function heartbeat(state: Pick<E2eState, "workerToken" | "workerId">) {
  await createWorkerControlClient(apiUrl, state.workerToken).heartbeat({
    workerId: state.workerId,
    runtime: runtimeInput(),
    acceptingWork: true,
    readinessState: "ready",
  });
}
