import { create } from "@bufbuild/protobuf";
import { DmScheduleToolOperationSchema } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { createChannel } from "../channels";
import { createOrganizationAgent } from "../organization-agents";
import { captureDmPublicMessageClaim } from "../dm-public-message-repository";
import { workerRuntimeProtoJsonFixture } from "./worker-runtime";

/** One live claimed ordinary Codex DM; only local D1 fixtures call this. */
export async function dmScheduleFixture(db: D1Database, now = new Date().toISOString()) {
  const organizationId = crypto.randomUUID(), projectId = crypto.randomUUID();
  const deviceId = crypto.randomUUID(), workerId = crypto.randomUUID(), agentId = crypto.randomUUID();
  const ownerId = crypto.randomUUID(), channelId = crypto.randomUUID();
  const jobId = crypto.randomUUID(), sourceId = crypto.randomUUID(), sessionId = crypto.randomUUID();
  const claimTokenHash = "c".repeat(64);
  const sourceAt = new Date(Date.parse(now) - 30_000).toISOString();
  const runtime = JSON.parse(workerRuntimeProtoJsonFixture({ agentProvider: "codex", providers: ["codex"] }));
  runtime.capabilities.dmReplyRouting = { protocol: 1, providers: ["AGENT_PROVIDER_CODEX"] };
  runtime.capabilities.dmPublicMessages = { protocol: 1, providers: ["AGENT_PROVIDER_CODEX"] };
  await db.batch([
    db.prepare(`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values (?, 'Schedule Owner', ?, 1, ?, ?)`).bind(ownerId, `${ownerId}@example.test`, now, now),
    db.prepare(`insert into briar_organizations (id, name, handle, created_at, updated_at)
      values (?, 'Schedule Org', ?, ?, ?)`).bind(organizationId, organizationId, now, now),
    db.prepare(`insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
      values (?, ?, 'owner', ?, ?)`).bind(organizationId, ownerId, now, now),
    db.prepare(`insert into briar_teams (id, owner_user_id, organization_id, name, agent_token_hash, created_at, updated_at)
      values (?, ?, ?, 'Schedule Test', ?, ?, ?)`).bind(projectId, ownerId, organizationId, projectId.replaceAll("-", "").repeat(2), now, now),
    db.prepare(`insert into briar_execution_worker_devices (id, organization_id, owner_user_id, label,
      device_identity_hash, state, last_heartbeat_at, created_at, updated_at)
      values (?, ?, ?, 'Schedule Device', ?, 'online', ?, ?, ?)`).bind(deviceId, organizationId, ownerId, deviceId.replaceAll("-", "").repeat(2), now, now, now),
    db.prepare(`insert into briar_execution_workers (id, project_id, device_id, label, host_fingerprint,
      runtime_proto_json, state, accepting_work, readiness_state, last_heartbeat_at, created_at, updated_at)
      values (?, ?, ?, 'Schedule Worker', ?, ?, 'online', 1, 'ready', ?, ?, ?)`)
      .bind(workerId, projectId, deviceId, "d".repeat(64), JSON.stringify(runtime), now, now, now),
  ]);
  await createOrganizationAgent(db, { id: agentId, organizationId, name: "Schedule Assistant", provider: "codex",
    model: null, responsibility: "Answer scheduled work in the original DM.", effort: null, createdAt: now });
  await createChannel(db, { id: channelId, organizationId, kind: "dm", dmKey: `schedule:${channelId}`,
    slug: `schedule-${channelId}`, name: "Schedule Assistant", topic: null, visibility: "private",
    defaultProjectId: null, createdByUserId: ownerId, agentIds: [agentId], createdAt: now });
  await db.batch([
    db.prepare(`insert into briar_channel_messages (id, channel_id, author_user_id, body, created_at, updated_at)
      values (?, ?, ?, 'Five minutes later, check the saved report again.', ?, ?)`).bind(sourceId, channelId, ownerId, sourceAt, sourceAt),
    db.prepare(`insert into briar_channel_reply_sessions (id, organization_id, channel_id, thread_root_message_id,
      agent_id, provider, last_activity_at, retained_until, created_at, updated_at)
      values (?, ?, ?, ?, ?, 'codex', ?, ?, ?, ?)`).bind(sessionId, organizationId, channelId, sourceId, agentId,
        now, new Date(Date.parse(now) + 86400_000).toISOString(), now, now),
    db.prepare(`insert into briar_channel_agent_reply_jobs (id, organization_id, channel_id, agent_id, session_id,
      trigger_message_id, parent_message_id, reply_message_id, agent_provider, status, routing_action,
      claimed_device_id, claimed_worker_id, claim_token_hash, claimed_at, lease_expires_at, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, 'codex', 'running', 'new', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(jobId, organizationId, channelId, agentId, sessionId, sourceId, sourceId, crypto.randomUUID(),
        deviceId, workerId, claimTokenHash, now, new Date(Date.parse(now) + 86400_000).toISOString(), now, now),
  ]);
  const identity = { jobId, organizationId, channelId, workerId, deviceId, claimTokenHash, observedAt: now };
  if (!await captureDmPublicMessageClaim(db, identity)) throw new Error("Schedule fixture publication claim missing");
  const operation = create(DmScheduleToolOperationSchema, { action: "create", requestKey: "reminder-1",
    instruction: "Check the saved report and explain what changed.", delaySeconds: 300,
    timeZone: "Asia/Seoul", timeZoneConfirmed: true });
  return { ...identity, projectId, ownerId, agentId, sourceId, sourceAt, sessionId, runtime, operation };
}
