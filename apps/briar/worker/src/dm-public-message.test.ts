import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createTeamAgent } from "./db";
import {
  createChannel,
  createChannelMessage,
  enqueueChannelAgentReplies,
  listChannelRootMessages,
} from "./channels";
import { claimNextChannelReplyWork } from "./channel-reply-claim-routes";
import {
  DmPublicMessageError,
  publishDmPublicMessageBatchApplication,
} from "./dm-public-message-application";
import type { PublishDmPublicMessageBatchInput } from "./dm-public-message-mappers";
import { workerClaimRuntimeFixture } from "./test-helpers/worker-runtime";
import { completeChannelReplyApplication } from "./worker-reply-completion-application";
import type { ChannelReplyCompletionInput } from "./worker-reply-completion-mappers";
import { executionWorkerBindingById } from "./workers";

const workspaceId = "da100000-0000-4000-8000-000000000001";
const projectId = "da200000-0000-4000-8000-000000000001";
const deviceId = "da300000-0000-4000-8000-000000000001";
const workerId = "da400000-0000-4000-8000-000000000001";
const ownerId = "dm-public-message-owner";
const createdAt = "2026-09-08T04:00:00.000Z";

describe("durable DM public messages", () => {
  const db = env.DB;
  let agentId: string;

  beforeAll(async () => {
    const runtime = JSON.parse(workerClaimRuntimeFixture().runtimeProtoJson);
    runtime.capabilities.dmPublicMessages = {
      protocol: 1,
      providers: ["AGENT_PROVIDER_CODEX"],
    };
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, 'Owner', 'dm-public-message@example.com', 1, ?, ?)`,
      ).bind(ownerId, createdAt, createdAt),
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'DM Public Message', 'dm-public-message-test', ?, ?)`,
      ).bind(workspaceId, createdAt, createdAt),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(workspaceId, ownerId, createdAt, createdAt),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'DM Public Message', ?, ?, ?)`,
      ).bind(
        projectId,
        ownerId,
        workspaceId,
        "a".repeat(64),
        createdAt,
        createdAt,
      ),
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'DM Device', ?, 'online', ?, ?, ?)`,
      ).bind(
        deviceId,
        workspaceId,
        ownerId,
        "b".repeat(64),
        createdAt,
        createdAt,
        createdAt,
      ),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_project_settings (
           project_id, workflow_json, mandatory_checkpoints_json,
           created_at, updated_at
         ) values (?, ?, '[]', ?, ?)`,
      ).bind(
        projectId,
        JSON.stringify({
          version: 2,
          requirements: [],
          stages: [{ id: "implementing", label: "Implement", required: true }],
          execution: { checkpoints: [] },
          completion: { requiredStages: ["implementing"] },
        }),
        createdAt,
        createdAt,
      ),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, label, host_fingerprint, runtime_proto_json, state,
           accepting_work, readiness_state, last_heartbeat_at,
           created_at, updated_at, device_id
         ) values (?, ?, 'DM Worker', ?, ?, 'online', 1, 'ready', ?, ?, ?, ?)`,
      ).bind(
        workerId,
        projectId,
        "c".repeat(64),
        JSON.stringify(runtime),
        createdAt,
        createdAt,
        createdAt,
        deviceId,
      ),
    ]);
    agentId = (await createTeamAgent(db, projectId, {
      name: "DM Agent",
      provider: "codex",
      model: null,
      effort: null,
      responsibility: "Answer the owner in direct messages.",
      calendarColor: "#123456",
    })).id;
  }, 60_000);

  it("publishes an ordered batch, replays it, and completes by final reference", async () => {
    const channelId = "db100000-0000-4000-8000-000000000001";
    const triggerId = "db200000-0000-4000-8000-000000000001";
    await createChannel(db, {
      id: channelId,
      workspaceId,
      kind: "dm",
      dmKey: `dm:${ownerId}:${agentId}`,
      slug: "dm-public-message",
      name: "DM public message",
      topic: null,
      visibility: "private",
      defaultProjectId: projectId,
      createdByUserId: ownerId,
      agentIds: [agentId],
      createdAt,
    });
    await createChannelMessage(db, {
      id: triggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Please investigate.",
      mentionedUserIds: [],
      mentionedAgentIds: [agentId],
      createdAt,
    });
    const [job] = await enqueueChannelAgentReplies(db, {
      workspaceId,
      channelId,
      channelKind: "dm",
      triggerMessageId: triggerId,
      parentMessageId: triggerId,
      agents: [{ id: agentId, projectId, provider: "codex" }],
      createdAt,
    });
    const heartbeatAt = new Date().toISOString();
    await db.batch([
      db.prepare(
        `update briar_execution_workers set last_heartbeat_at = ? where id = ?`,
      ).bind(heartbeatAt, workerId),
      db.prepare(
        `update briar_execution_worker_devices
         set last_heartbeat_at = ? where id = ?`,
      ).bind(heartbeatAt, deviceId),
    ]);
    const binding = await executionWorkerBindingById(db, deviceId, workerId);
    expect(binding).not.toBeNull();
    const worker = {
      principal: { workspaceId, deviceId, ownerUserId: ownerId },
      binding: binding!,
    };
    const claim = await claimNextChannelReplyWork({
      input: { workspaceId, workerId },
      db,
      env,
      authenticatedWorker: worker,
    });
    expect(claim?.workId).toBe(job.id);
    expect(claim?.dmPublicMessageProtocol).toBe(1);
    const request = (
      requestId: string,
      publicationKind: "intermediate" | "final",
      parts: PublishDmPublicMessageBatchInput["parts"],
    ): PublishDmPublicMessageBatchInput => ({
      requestId,
      projectId,
      workerId,
      claim: {
        replyKind: "channel",
        workspaceId,
        workId: job.id,
        runId: channelId,
        claimToken: claim!.claimToken,
      },
      expectedInputRevision: claim!.inputRevision,
      publicationKind,
      parts,
    });
    const intermediateRequest = request(
      "db300000-0000-4000-8000-000000000001",
      "intermediate",
      [
        { body: "I started checking.", purpose: "acknowledgement" },
        { body: "The first detail is confirmed.", purpose: "discovery" },
      ],
    );
    const first = await publishDmPublicMessageBatchApplication({
      db,
      env,
      worker,
      request: intermediateRequest,
    });
    expect(first).toMatchObject({
      firstSequence: 1,
      lastSequence: 2,
      publicationKind: "intermediate",
      replayed: false,
    });
    const ordered = await listChannelRootMessages(db, channelId);
    expect(ordered.slice(-2).map((message) => ({
      body: message.body,
      metadata: message.dmMetadata,
    }))).toEqual([
      {
        body: "I started checking.",
        metadata: {
          batchId: first.batchId,
          partIndex: 0,
          conversationSequence: 1,
          purpose: "acknowledgement",
        },
      },
      {
        body: "The first detail is confirmed.",
        metadata: {
          batchId: first.batchId,
          partIndex: 1,
          conversationSequence: 2,
          purpose: "discovery",
        },
      },
    ]);
    const replay = await publishDmPublicMessageBatchApplication({
      db,
      env,
      worker,
      request: intermediateRequest,
    });
    expect(replay).toEqual({ ...first, replayed: true });
    await expect(publishDmPublicMessageBatchApplication({
      db,
      env,
      worker,
      request: {
        ...intermediateRequest,
        parts: [{ body: "Changed.", purpose: "progress" }],
      },
    })).rejects.toMatchObject({
      reason: "request_conflict",
    } satisfies Partial<DmPublicMessageError>);

    const final = await publishDmPublicMessageBatchApplication({
      db,
      env,
      worker,
      request: request(
        "db400000-0000-4000-8000-000000000001",
        "final",
        [{ body: "The investigation is complete.", purpose: "result" }],
      ),
    });
    expect(final).toMatchObject({
      firstSequence: 3,
      lastSequence: 3,
      publicationKind: "final",
      messageIds: [job.reply_message_id],
    });
    const beforeCompletion = await db.prepare(
      `select count(*) as count from briar_channel_messages
       where channel_id = ?`,
    ).bind(channelId).first<{ count: number }>();
    const completion: ChannelReplyCompletionInput = {
      requestId: "db500000-0000-4000-8000-000000000001",
      projectId,
      workerId,
      claim: {
        replyKind: "channel",
        workspaceId,
        workId: job.id,
        runId: channelId,
        claimToken: claim!.claimToken,
      },
      attachmentIds: [],
      conversationId: "dm-public-message-conversation",
      publishedFinalBatchId: final.batchId,
      outcome: {
        case: "success",
        completion: {
          body: "The investigation is complete.",
          memoryCitations: null,
          memorySaveRequest: null,
          document: null,
          issueProposal: null,
          issueBatchProposal: null,
          executionProposal: null,
          skillExecutionProposal: null,
          delegation: null,
          agentMessage: null,
        },
      },
    };
    const completed = await completeChannelReplyApplication({
      db,
      env,
      worker,
      request: completion,
      observedAt: new Date().toISOString(),
    });
    expect(completed).toMatchObject({
      replayed: false,
      disposition: "completed",
      finalBatchId: final.batchId,
      finalMessageId: job.reply_message_id,
    });
    const afterCompletion = await db.prepare(
      `select count(*) as count from briar_channel_messages
       where channel_id = ?`,
    ).bind(channelId).first<{ count: number }>();
    expect(afterCompletion).toEqual(beforeCompletion);
    await expect(completeChannelReplyApplication({
      db,
      env,
      worker,
      request: completion,
      observedAt: new Date().toISOString(),
    })).resolves.toMatchObject({
      replayed: true,
      finalBatchId: final.batchId,
      finalMessageId: job.reply_message_id,
    });
  }, 60_000);
});
