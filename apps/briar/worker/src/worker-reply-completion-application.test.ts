import { create } from "@bufbuild/protobuf";
import {
  ChannelReplyClaimIdentitySchema,
  ChannelReplyArtifactsActionSchema,
  ChannelReplyDocumentActionSchema,
  ChannelReplyIssueActionSchema,
  CompleteChannelReplyRequestSchema,
  CompleteIssueReplyRequestSchema,
  IssueReplyClaimIdentitySchema,
  ReplyIssueDraftSchema,
  WorkClaimIdentitySchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { createHash } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { HuntEventInput } from "./db";
import {
  claimNextIssueAgentReply,
  createIssueMessage,
  createTeamAgent,
  enqueueIssueAgentReply,
  recordHuntEvent,
} from "./db";
import { sha256 } from "./crypto-digest";
import {
  channelReplySessionRetentionUntil,
  claimNextChannelAgentReply,
  createChannel,
  createChannelMessage,
  enqueueChannelAgentReplies,
} from "./channels";
import type { IssueAgentReplyJobRow } from "./issue-agent-reply-repository";
import {
  enqueueExpiredUploadCleanup,
  enqueueUploadObjectCleanup,
  processUploadCleanupQueue,
} from "./upload-repository";
import {
  uploadReservedFileApplication,
  UploadApplicationError,
} from "./upload-application";
import {
  prepareReplyAttachmentUploadsApplication,
  ReplyCompletionApplicationError,
  completeChannelReplyApplication,
  completeIssueReplyApplication,
} from "./worker-reply-completion-application";
import {
  completeChannelReplyInputFromProto,
  completeIssueReplyInputFromProto,
  type PreparedReplyAttachmentUploadsInput,
} from "./worker-reply-completion-mappers";
import { workerClaimRuntimeFixture } from "./test-helpers/worker-runtime";

const organizationId = "a9000000-0000-4000-8000-000000000001";
const projectId = "b9000000-0000-4000-8000-000000000001";
const deviceId = "c9000000-0000-4000-8000-000000000001";
const workerId = "d9000000-0000-4000-8000-000000000001";
const ownerId = "reply-completion-owner";
const signingSecret = "reply-completion-secret".repeat(4);
const baseAt = Date.parse("2026-08-31T08:00:00.000Z");
const at = (seconds: number) => new Date(baseAt + seconds * 1_000).toISOString();
const digestBytes = (value: ArrayBuffer) =>
  Uint8Array.from(createHash("sha256").update(new Uint8Array(value)).digest());

const event = (sequence: number): HuntEventInput => ({
  source: "issue",
  sourceKey: `reply-completion-${sequence}`,
  title: `Reply completion ${sequence}`,
  stage: "queued",
  status: "backlog",
  workflowStage: null,
  eventKey: `reply-completion-${sequence}:backlog`,
  occurredAt: at(sequence),
  actor: "reply-completion-test",
  repository: "Reply completion",
  detail: null,
  priority: null,
  branch: null,
  commitSha: null,
  tracker: null,
  issueDescription: null,
  resultSummary: null,
  structuredResult: null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: at(sequence),
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
});

describe("reply completion application", () => {
  const db = cloudflareEnv.DB;
  const bucket = cloudflareEnv.ATTACHMENTS;
  let agentId: string;
  let sequence = 0;
  const env = () => ({
    DB: db,
    ATTACHMENTS: bucket,
    ARCHIVES: bucket,
    BETTER_AUTH_SECRET: signingSecret,
  }) as unknown as Env;
  const worker = {
    principal: { organizationId, deviceId },
    binding: { id: workerId, project_id: projectId },
  };

  beforeAll(async () => {
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, 'Owner', 'reply-completion@example.com', 1, ?, ?)`,
      ).bind(ownerId, at(0), at(0)),
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Reply Completion', 'reply-completion', ?, ?)`,
      ).bind(organizationId, at(0), at(0)),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, at(0), at(0)),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Reply Project', ?, ?, ?)`,
      ).bind(projectId, ownerId, organizationId, "a".repeat(64), at(0), at(0)),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_project_settings (
           project_id, workflow_json, mandatory_checkpoints_json,
           created_at, updated_at
         ) values (?, ?, '[]', ?, ?)`,
      ).bind(projectId, JSON.stringify({
        version: 2,
        requirements: [],
        stages: [{ id: "implementing", label: "Implement", required: true }],
        execution: { checkpoints: [] },
        completion: { requiredStages: ["implementing"] },
      }), at(0), at(0)),
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Reply Device', ?, 'online', ?, ?, ?)`,
      ).bind(
        deviceId,
        organizationId,
        ownerId,
        "b".repeat(64),
        at(0),
        at(0),
        at(0),
      ),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, label, host_fingerprint, runtime_proto_json, state,
           last_heartbeat_at, created_at, updated_at, device_id
         ) values (?, ?, 'Reply Worker', ?, ?, 'online', ?, ?, ?, ?)`,
      ).bind(
        workerId,
        projectId,
        "c".repeat(64),
        workerClaimRuntimeFixture().runtimeProtoJson,
        at(0),
        at(0),
        at(0),
        deviceId,
      ),
    ]);
    agentId = (await createTeamAgent(db, projectId, {
      name: "Reply Agent",
      provider: "codex",
      model: null,
      effort: null,
      responsibility: "Complete reply jobs.",
      calendarColor: "#123456",
    })).id;
    await db.prepare(
      `update briar_execution_workers
       set runtime_proto_json = ?, accepting_work = 1,
           readiness_state = 'ready', last_heartbeat_at = ?, updated_at = ?
       where id = ?`,
    ).bind(
      workerClaimRuntimeFixture().runtimeProtoJson,
      at(0),
      at(0),
      workerId,
    ).run();
  }, 60_000);

  const seedClaim = async (attempt: 1 | 2 | 3 = 1) => {
    sequence += 1;
    const suffix = sequence.toString(16).padStart(12, "0");
    const runId = await recordHuntEvent(db, projectId, event(sequence));
    await db.prepare(
      `update briar_hunt_runs set agent_id = ? where id = ? and project_id = ?`,
    ).bind(agentId, runId, projectId).run();
    const triggerMessageId = `f1000000-0000-4000-8000-${suffix}`;
    const replyMessageId = `f2000000-0000-4000-8000-${suffix}`;
    const workId = `f3000000-0000-4000-8000-${suffix}`;
    await createIssueMessage(db, {
      id: triggerMessageId,
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentProvider: null,
      body: "Please reply.",
      createdAt: at(sequence),
    });
    await enqueueIssueAgentReply(db, {
      id: workId,
      projectId,
      runId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      replyMessageId,
      agentId,
      createdAt: at(sequence),
    });
    if (attempt > 1) {
      await db.prepare(
        `update briar_issue_agent_reply_jobs set attempts = ? where id = ?`,
      ).bind(attempt - 1, workId).run();
    }
    const claimToken = `briar_reply_claim_${suffix.padStart(64, "0")}`;
    const claimed = await claimNextIssueAgentReply(db, projectId, {
      workerId,
      agentProvider: "codex",
      claimTokenHash: await sha256(claimToken),
      claimedAt: at(100 + sequence),
      leaseExpiresAt: at(1_000 + sequence),
      staleBefore: at(-1_000),
    });
    expect(claimed?.id).toBe(workId);
    return { workId, runId, claimToken, attempt };
  };

  const identity = (claim: Awaited<ReturnType<typeof seedClaim>>) =>
    create(WorkClaimIdentitySchema, {
      workId: claim.workId,
      runId: claim.runId,
      claimToken: claim.claimToken,
      work: {
        case: "issueReply",
        value: create(IssueReplyClaimIdentitySchema),
      },
    });

  const seedChannelClaim = async () => {
    sequence += 1;
    const suffix = sequence.toString(16).padStart(12, "0");
    const channelId = `e4000000-0000-4000-8000-${suffix}`;
    const triggerMessageId = `e5000000-0000-4000-8000-${suffix}`;
    await createChannel(db, {
      id: channelId,
      organizationId,
      kind: "channel",
      dmKey: null,
      slug: `reply-completion-${sequence}`,
      name: `Reply completion ${sequence}`,
      topic: null,
      visibility: "public",
      defaultProjectId: projectId,
      createdByUserId: ownerId,
      agentIds: [agentId],
      createdAt: at(sequence),
    });
    await createChannelMessage(db, {
      id: triggerMessageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@Reply-Agent prepare the follow-up.",
      mentionedUserIds: [],
      mentionedAgentIds: [agentId],
      createdAt: at(sequence),
    });
    const [job] = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      agents: [{ id: agentId, projectId, provider: "codex" }],
      createdAt: at(sequence),
    });
    const claimToken = `briar_channel_claim_${suffix.padStart(64, "0")}`;
    const claimed = await claimNextChannelAgentReply(db, organizationId, {
      deviceId,
      workerId,
      ...workerClaimRuntimeFixture({
        agentProvider: "codex",
        providers: ["codex"],
      }),
      claimTokenHash: await sha256(claimToken),
      claimedAt: at(100 + sequence),
      leaseExpiresAt: at(1_000 + sequence),
    });
    expect(claimed?.id).toBe(job.id);
    return { workId: job.id, channelId, claimToken };
  };

  const channelIdentity = (
    claim: Awaited<ReturnType<typeof seedChannelClaim>>,
  ) => create(WorkClaimIdentitySchema, {
    workId: claim.workId,
    runId: claim.channelId,
    claimToken: claim.claimToken,
    work: {
      case: "channelReply",
      value: create(ChannelReplyClaimIdentitySchema, { organizationId }),
    },
  });

  it("consumes a verified upload once and replays only the exact receipt", async () => {
    const claim = await seedClaim();
    const body = new TextEncoder().encode("verified attachment").buffer;
    const prepareRequest: PreparedReplyAttachmentUploadsInput = {
      requestId: "fa000000-0000-4000-8000-000000000001",
      projectId,
      workerId,
      claim: {
        replyKind: "issue",
        organizationId: null,
        workId: claim.workId,
        runId: claim.runId,
        claimToken: claim.claimToken,
      },
      attachments: [{
        clientId: "artifact",
        filename: "artifact.html",
        contentType: "text/html",
        byteSize: body.byteLength,
        sha256: digestBytes(body),
      }, {
        clientId: "unused",
        filename: "unused.html",
        contentType: "text/html",
        byteSize: body.byteLength,
        sha256: digestBytes(body),
      }],
    };
    const prepared = await prepareReplyAttachmentUploadsApplication({
      db,
      env: env(),
      worker,
      request: prepareRequest,
      observedAt: at(200 + sequence),
    });
    const prepareReplay = await prepareReplyAttachmentUploadsApplication({
      db,
      env: env(),
      worker,
      request: prepareRequest,
      observedAt: at(200 + sequence),
    });
    expect(prepareReplay.replayed).toBe(true);
    expect(prepareReplay.uploads[0]).toMatchObject({
      attachmentId: prepared.uploads[0]?.attachmentId,
      expiresAt: prepared.uploads[0]?.expiresAt,
    });
    await expect(prepareReplyAttachmentUploadsApplication({
      db,
      env: env(),
      worker,
      request: {
        ...prepareRequest,
        attachments: [{
          ...prepareRequest.attachments[0]!,
          filename: "different.html",
        }],
      },
      observedAt: at(200 + sequence),
    })).rejects.toMatchObject({ reason: "replay_conflict" });
    const upload = prepared.uploads[0]!;

    await expect(uploadReservedFileApplication({
      db,
      bucket,
      signingSecret,
      uploadId: upload.attachmentId,
      capability: upload.uploadCapability,
      contentType: "text/html",
      body,
      observedAt: at(201 + sequence),
    })).resolves.toBeDefined();
    await expect(uploadReservedFileApplication({
      db,
      bucket,
      signingSecret,
      uploadId: upload.attachmentId,
      capability: upload.uploadCapability,
      contentType: "text/html",
      body,
      observedAt: at(202 + sequence),
    })).resolves.toMatchObject({ replayed: true });

    const requestId = "fb000000-0000-4000-8000-000000000001";
    const completion = completeIssueReplyInputFromProto(create(
      CompleteIssueReplyRequestSchema,
      {
        requestId,
        projectId,
        workerId,
        work: identity(claim),
        outcome: {
          case: "success",
          value: {
            body: "Done.",
            attachments: [{ uploadId: upload.attachmentId }],
          },
        },
      },
    ));
    const first = await completeIssueReplyApplication({
      db,
      env: env(),
      worker,
      request: completion,
      observedAt: at(210 + sequence),
    });
    expect(first).toEqual({
      replayed: false,
      disposition: "completed",
      retainedUntil: null,
    });
    await expect(completeIssueReplyApplication({
      db,
      env: env(),
      worker,
      request: completion,
      observedAt: at(211 + sequence),
    })).resolves.toMatchObject({ replayed: true, disposition: "completed" });

    await expect(completeIssueReplyApplication({
      db,
      env: env(),
      worker,
      request: { ...completion, requestId: crypto.randomUUID() },
      observedAt: at(212 + sequence),
    })).rejects.toMatchObject({ reason: "replay_conflict" });
    if (completion.outcome.case !== "success") {
      throw new Error("Expected successful completion fixture");
    }
    await expect(completeIssueReplyApplication({
      db,
      env: env(),
      worker,
      request: {
        ...completion,
        outcome: {
          case: "success",
          completion: { ...completion.outcome.completion, body: "Changed." },
        },
      },
      observedAt: at(213 + sequence),
    })).rejects.toMatchObject({ reason: "replay_conflict" });

    await expect(db.prepare(
      `select consumer_id, consumed_at
       from briar_uploads where upload_id = ?`,
    ).bind(upload.attachmentId).first()).resolves.toEqual({
      consumer_id: requestId,
      consumed_at: at(210 + sequence),
    });
    await expect(db.prepare(
      `select count(*) as count from briar_issue_attachments where id = ?`,
    ).bind(upload.attachmentId).first()).resolves.toEqual({ count: 1 });

    const unused = prepared.uploads[1]!;
    const unusedObject = await db.prepare(
      `select object_key from briar_uploads where upload_id = ?`,
    ).bind(unused.attachmentId).first<{ object_key: string }>();
    await expect(enqueueExpiredUploadCleanup(
      db,
      at(1_001 + sequence),
    )).resolves.toBe(1);
    await expect(db.prepare(
      `select upload.consumed_at, cleanup.object_key as cleanup_object_key
       from briar_uploads upload
       left join briar_upload_cleanup_queue cleanup
         on cleanup.object_key = upload.object_key
       where upload.upload_id in (?, ?)
       order by upload.upload_id`,
    ).bind(upload.attachmentId, unused.attachmentId).all()).resolves.toMatchObject({
      results: [
        expect.objectContaining({ consumed_at: at(210 + sequence) }),
      ],
    });
    await expect(db.prepare(
      `select object_key from briar_upload_cleanup_queue
       where object_key = ?`,
    ).bind(unusedObject!.object_key).first()).resolves.toEqual({
      object_key: unusedObject!.object_key,
    });
  });

  it("rejects unuploaded, mismatched, expired, and substituted capabilities", async () => {
    const claim = await seedClaim();
    const body = new TextEncoder().encode("reserved bytes").buffer;
    const prepareRequest: PreparedReplyAttachmentUploadsInput = {
      requestId: crypto.randomUUID(),
      projectId,
      workerId,
      claim: {
        replyKind: "issue",
        organizationId: null,
        workId: claim.workId,
        runId: claim.runId,
        claimToken: claim.claimToken,
      },
      attachments: [{
        clientId: "reserved",
        filename: "reserved.png",
        contentType: "image/png",
        byteSize: body.byteLength,
        sha256: digestBytes(body),
      }],
    };
    const prepared = await prepareReplyAttachmentUploadsApplication({
      db,
      env: env(),
      worker,
      request: prepareRequest,
      observedAt: at(300 + sequence),
    });
    const upload = prepared.uploads[0]!;
    const request = completeIssueReplyInputFromProto(create(
      CompleteIssueReplyRequestSchema,
      {
        requestId: crypto.randomUUID(),
        projectId,
        workerId,
        work: identity(claim),
        outcome: {
          case: "success",
          value: {
            body: "Not uploaded.",
            attachments: [{ uploadId: upload.attachmentId }],
          },
        },
      },
    ));
    await expect(completeIssueReplyApplication({
      db,
      env: env(),
      worker,
      request,
      observedAt: at(301 + sequence),
    })).rejects.toMatchObject({ reason: "claim_conflict" });
    await expect(uploadReservedFileApplication({
      db,
      bucket,
      signingSecret,
      uploadId: upload.attachmentId,
      capability: upload.uploadCapability,
      contentType: "text/html",
      body,
      observedAt: at(302 + sequence),
    })).rejects.toMatchObject({ reason: "invalid_request" });
    await expect(uploadReservedFileApplication({
      db,
      bucket,
      signingSecret,
      uploadId: upload.attachmentId,
      capability: upload.uploadCapability,
      contentType: "image/png",
      body: body.slice(0, body.byteLength - 1),
      observedAt: at(303 + sequence),
    })).rejects.toMatchObject({ reason: "invalid_request" });
    await expect(uploadReservedFileApplication({
      db,
      bucket,
      signingSecret,
      uploadId: upload.attachmentId,
      capability: upload.uploadCapability,
      contentType: "image/png",
      body: new Uint8Array(body.byteLength).fill(120).buffer,
      observedAt: at(304 + sequence),
    })).rejects.toMatchObject({ reason: "invalid_request" });
    await expect(uploadReservedFileApplication({
      db,
      bucket,
      signingSecret,
      uploadId: crypto.randomUUID(),
      capability: upload.uploadCapability,
      contentType: "image/png",
      body,
      observedAt: at(305 + sequence),
    })).rejects.toMatchObject({ reason: "invalid_capability" });
    await expect(prepareReplyAttachmentUploadsApplication({
      db,
      env: env(),
      worker,
      request: prepareRequest,
      observedAt: at(901 + sequence),
    })).rejects.toMatchObject({ reason: "replay_conflict" });
    await expect(uploadReservedFileApplication({
      db,
      bucket,
      signingSecret,
      uploadId: upload.attachmentId,
      capability: upload.uploadCapability,
      contentType: "image/png",
      body,
      observedAt: at(1_001 + sequence),
    })).rejects.toBeInstanceOf(UploadApplicationError);
    await db.prepare(
      `update briar_issue_agent_reply_jobs
       set status = 'failed', claim_token_hash = null, lease_expires_at = null
       where id = ?`,
    ).bind(claim.workId).run();
  });

  it("completes channel artifacts once and rejects every crossed claim scope", async () => {
    const claim = await seedChannelClaim();
    const observedAt = at(220 + sequence);
    const completion = completeChannelReplyInputFromProto(create(
      CompleteChannelReplyRequestSchema,
      {
        requestId: crypto.randomUUID(),
        projectId,
        workerId,
        work: channelIdentity(claim),
        outcome: {
          case: "success",
          value: {
            body: "The plan and follow-up are ready.",
            conversationId: "channel-conversation-1",
            action: {
              case: "artifacts",
              value: create(ChannelReplyArtifactsActionSchema, {
                document: create(ChannelReplyDocumentActionSchema, {
                  title: "Implementation plan",
                  markdown: "# Plan\n\nShip the generated contract.",
                  projectId,
                }),
                proposal: {
                  case: "issue",
                  value: create(ChannelReplyIssueActionSchema, {
                    projectId,
                    issue: create(ReplyIssueDraftSchema, {
                      title: "Ship generated reply completion",
                      description: "Remove the remaining handwritten wire path.",
                      priority: 2,
                    }),
                    executeAfterCreate: false,
                  }),
                },
              }),
            },
          },
        },
      },
    ));

    for (const crossed of [{
      worker: {
        ...worker,
        binding: { ...worker.binding, id: "another-worker" },
      },
      request: completion,
    }, {
      worker: {
        ...worker,
        principal: { organizationId, deviceId: crypto.randomUUID() },
      },
      request: completion,
    }, {
      worker: {
        ...worker,
        principal: { organizationId: crypto.randomUUID(), deviceId },
      },
      request: completion,
    }, {
      worker,
      request: {
        ...completion,
        projectId: "b9000000-0000-4000-8000-000000000002",
      },
    }]) {
      await expect(completeChannelReplyApplication({
        db,
        env: env(),
        worker: crossed.worker,
        request: crossed.request,
        observedAt,
      })).rejects.toMatchObject({ reason: "claim_conflict" });
    }

    const first = await completeChannelReplyApplication({
      db,
      env: env(),
      worker,
      request: completion,
      observedAt,
    });
    expect(first).toEqual({
      replayed: false,
      disposition: "completed",
      retainedUntil: channelReplySessionRetentionUntil(observedAt),
    });
    await expect(completeChannelReplyApplication({
      db,
      env: env(),
      worker,
      request: completion,
      observedAt: at(221 + sequence),
    })).resolves.toEqual({
      ...first,
      replayed: true,
    });
    await expect(db.prepare(
      `select
         (select count(*) from briar_channel_message_documents
          where message_id = job.reply_message_id) as document_count,
         (select count(*) from briar_channel_action_proposals
          where reply_message_id = job.reply_message_id) as proposal_count
       from briar_channel_agent_reply_jobs job where job.id = ?`,
    ).bind(claim.workId).first()).resolves.toEqual({
      document_count: 1,
      proposal_count: 1,
    });
  });

  it("records retries one and two as requeued and attempt three as failed", async () => {
    for (const attempt of [1, 2, 3] as const) {
      const claim = await seedClaim(attempt);
      const completion = completeIssueReplyInputFromProto(create(
        CompleteIssueReplyRequestSchema,
        {
          requestId: crypto.randomUUID(),
          projectId,
          workerId,
          work: identity(claim),
          outcome: { case: "failure", value: { error: `attempt ${attempt}` } },
        },
      ));
      const result = await completeIssueReplyApplication({
        db,
        env: env(),
        worker,
        request: completion,
        observedAt: at(400 + sequence),
      });
      expect(result.disposition).toBe(attempt === 3 ? "failed" : "requeued");
      await expect(db.prepare(
        `select status, claim_token_hash from briar_issue_agent_reply_jobs
         where id = ?`,
      ).bind(claim.workId).first()).resolves.toEqual({
        status: attempt === 3 ? "failed" : "queued",
        claim_token_hash: null,
      });
      if (attempt < 3) {
        await db.prepare(
          `update briar_issue_agent_reply_jobs set status = 'failed' where id = ?`,
        ).bind(claim.workId).run();
      }
    }
  });

  it("preserves infrastructure failures while classifying a vanished claim", async () => {
    for (const claimRemainsActive of [true, false]) {
      const claim = await seedClaim();
      const completion = completeIssueReplyInputFromProto(create(
        CompleteIssueReplyRequestSchema,
        {
          requestId: crypto.randomUUID(),
          projectId,
          workerId,
          work: identity(claim),
          outcome: { case: "success", value: { body: "Done." } },
        },
      ));
      const claimed = await db.prepare(
        `select * from briar_issue_agent_reply_jobs where id = ?`,
      ).bind(claim.workId).first<IssueAgentReplyJobRow>();
      if (!claimed) throw new Error("Expected a claimed issue reply fixture");
      const infrastructureFailure = new Error("D1 became unavailable");
      const getClaimedIssueAgentReply = vi.fn()
        .mockResolvedValueOnce(claimed)
        .mockResolvedValueOnce(claimRemainsActive ? claimed : null);
      const operation = completeIssueReplyApplication({
        db,
        env: env(),
        worker,
        request: completion,
        observedAt: at(500 + sequence),
      }, {
        getClaimedIssueAgentReply,
        findReplyCompletionReceipt: vi.fn(async () => null),
        resolveReplyCompletionAttachments: vi.fn(async () => []),
        completeIssueAgentReplyOutput: vi.fn(async () => {
          throw infrastructureFailure;
        }),
      });
      if (claimRemainsActive) {
        await expect(operation).rejects.toBe(infrastructureFailure);
      } else {
        await expect(operation).rejects.toMatchObject({
          reason: "claim_conflict",
        });
      }
      expect(getClaimedIssueAgentReply).toHaveBeenCalledTimes(2);
    }

    const claim = await seedClaim();
    const completion = completeIssueReplyInputFromProto(create(
      CompleteIssueReplyRequestSchema,
      {
        requestId: crypto.randomUUID(),
        projectId,
        workerId,
        work: identity(claim),
        outcome: { case: "success", value: { body: "Done." } },
      },
    ));
    const guardedAbort = new Error(
      "D1_ERROR: invalid reply completion receipt: SQLITE_CONSTRAINT_TRIGGER",
    );
    const claimed = await db.prepare(
      `select * from briar_issue_agent_reply_jobs where id = ?`,
    ).bind(claim.workId).first<IssueAgentReplyJobRow>();
    if (!claimed) throw new Error("Expected a claimed issue reply fixture");
    const getClaimedIssueAgentReply = vi.fn(async () => claimed);
    await expect(completeIssueReplyApplication({
      db,
      env: env(),
      worker,
      request: completion,
      observedAt: at(500 + sequence),
    }, {
      getClaimedIssueAgentReply,
      findReplyCompletionReceipt: vi.fn(async () => null),
      resolveReplyCompletionAttachments: vi.fn(async () => []),
      completeIssueAgentReplyOutput: vi.fn(async () => {
        throw guardedAbort;
      }),
    })).rejects.toMatchObject({ reason: "claim_conflict" });
    expect(getClaimedIssueAgentReply).toHaveBeenCalledOnce();
  });

  it("keeps failed R2 cleanup durable and retries with generation CAS", async () => {
    const objectKey = "reply-attachments/orphaned/retry";
    await enqueueUploadObjectCleanup(db, {
      objectKey,
      batchRequestId: crypto.randomUUID(),
      observedAt: at(600),
    });
    const deleteObject = vi.fn()
      .mockRejectedValueOnce(new Error("temporary R2 failure"))
      .mockResolvedValueOnce(undefined);
    await expect(processUploadCleanupQueue(
      db,
      { delete: deleteObject },
      at(600),
    )).resolves.toEqual({ processed: 1, deleted: 0, failed: 1 });
    await expect(db.prepare(
      `select attempts, generation, last_error
       from briar_upload_cleanup_queue where object_key = ?`,
    ).bind(objectKey).first()).resolves.toEqual({
      attempts: 1,
      generation: 2,
      last_error: "temporary R2 failure",
    });
    await expect(processUploadCleanupQueue(
      db,
      { delete: deleteObject },
      at(603),
    )).resolves.toEqual({ processed: 1, deleted: 1, failed: 0 });
    await expect(db.prepare(
      `select object_key from briar_upload_cleanup_queue
       where object_key = ?`,
    ).bind(objectKey).first()).resolves.toBeNull();
  });

  it("keeps a cleanup request replaced while R2 deletion is in flight", async () => {
    const objectKey = "reply-attachments/orphaned/replaced";
    const originalBatchRequestId = crypto.randomUUID();
    const replacementBatchRequestId = crypto.randomUUID();
    await enqueueUploadObjectCleanup(db, {
      objectKey,
      batchRequestId: originalBatchRequestId,
      observedAt: at(610),
    });
    const deleteObject = vi.fn(async () => {
      await db.prepare(
        `delete from briar_upload_cleanup_queue where object_key = ?`,
      ).bind(objectKey).run();
      await enqueueUploadObjectCleanup(db, {
        objectKey,
        batchRequestId: replacementBatchRequestId,
        observedAt: at(611),
      });
    });

    await expect(processUploadCleanupQueue(
      db,
      { delete: deleteObject },
      at(610),
    )).resolves.toEqual({ processed: 1, deleted: 0, failed: 0 });
    await expect(db.prepare(
      `select batch_request_id, queued_at, generation
       from briar_upload_cleanup_queue where object_key = ?`,
    ).bind(objectKey).first()).resolves.toEqual({
      batch_request_id: replacementBatchRequestId,
      queued_at: at(611),
      generation: 1,
    });
  });
});
