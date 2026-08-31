import { create } from "@bufbuild/protobuf";
import {
  CompleteIssueReplyRequestSchema,
  IssueReplyClaimIdentitySchema,
  WorkClaimIdentitySchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { createHash } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addChannelAgent,
  createChannel,
  createChannelMessage,
  reserveChannelExecutionProposalApproval,
  removeChannelAgent,
} from "./channels";
import type { HuntEventInput } from "./db";
import {
  createIssueActionProposal,
  createIssueExecutionProposal,
  createIssueMessage,
  createProjectAgent,
  acceptIssueCreateProposal,
  claimNextQueuedHuntRun,
  failIssueAgentReply,
  enqueueIssueAgentReply,
  getHuntRunForProject,
  getIssueExecutionProposal,
  listIssueAttachments,
  listIssueExecutionProposals,
  recordHuntEvent,
  renewIssueAgentReplyLease,
  reserveIssueCreateProposalApproval,
  reserveIssueExecutionProposalApproval,
  transferIssue,
} from "./db";
import {
  acceptOrganizationChannelExecutionProposal,
  acceptOrganizationChannelProposal,
} from "./channel-proposal-routes";
import {
  acceptProjectIssueActionProposal,
  acceptProjectIssueExecutionProposal,
} from "./issue-proposal-routes";
import { HttpError } from "./http-response";
import { createOrganizationAgent } from "./organization-agents";
import { RequestDecodeError } from "./request-schema";
import { workerCapabilitiesFixture } from "./test-helpers/worker-runtime";
import { completeIssueReplyApplication } from "./worker-reply-completion-application";
import { completeIssueReplyInputFromProto } from "./worker-reply-completion-mappers";
import {
  dispatchHuntRun,
  registerExecutionWorker,
  unassignHuntRun,
  WorkerConflictError,
} from "./workers";

const organizationId = "a1000000-0000-4000-8000-000000000001";
const projectAId = "a2000000-0000-4000-8000-000000000001";
const projectBId = "a2000000-0000-4000-8000-000000000002";
const ownerId = "execution-owner";
const memberId = "execution-member";
const ownerToken = "execution-owner-token";
const memberToken = "execution-member-token";
const projectAAgentToken = "briar_agent_execution_approval_test";
const executionWorkerCredential = "briar_worker_execution_credential";
const initialAt = "2026-08-11T00:00:00.000Z";

const providerCapabilities = {
  codex: {
    models: [
      {
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        efforts: [
          { id: "high", label: "High" },
          { id: "medium", label: "Medium" },
        ],
      },
      {
        id: "gpt-provider-reported-model",
        label: "Provider-reported model",
        efforts: [{ id: "high", label: "High" }],
      },
    ],
    defaultEfforts: [],
    allowCustomModels: false,
    error: null,
  },
  claude: {
    models: [],
    defaultEfforts: [],
    allowCustomModels: true,
    error: null,
  },
  cursor: {
    models: [],
    defaultEfforts: [],
    allowCustomModels: true,
    error: null,
  },
  grok: {
    models: [],
    defaultEfforts: [],
    allowCustomModels: false,
    error: null,
  },
  agy: {
    models: [],
    defaultEfforts: [],
    allowCustomModels: false,
    error: null,
  },
  opencode: {
    models: [],
    defaultEfforts: [],
    allowCustomModels: true,
    error: null,
  },
  openrouter: {
    models: [],
    defaultEfforts: [],
    allowCustomModels: true,
    error: null,
  },
};

const event = (
  sourceKey: string,
  title: string,
  occurredAt = initialAt,
): HuntEventInput => ({
  source: "issue",
  sourceKey,
  title,
  stage: "queued",
  status: "backlog",
  workflowStage: null,
  eventKey: `${sourceKey}:backlog`,
  occurredAt,
  actor: "execution-approval-test",
  repository: "Project A",
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
  sourceCreatedAt: occurredAt,
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
});
describe("conversational issue execution approval", () => {
  const db = cloudflareEnv.DB;
  const attachments = cloudflareEnv.ATTACHMENTS;
  let sequence = 0;
  let projectAgentId: string;

  beforeAll(async () => {
    for (const [id, name, token] of [
      [ownerId, "Owner", ownerToken],
      [memberId, "Member", memberToken],
    ]) {
      await db.batch([
        db.prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
        ).bind(id, name, `${id}@example.com`, initialAt, initialAt),
        db.prepare(
          `insert into "session" (
             id, expiresAt, token, createdAt, updatedAt, userId
           ) values (?, '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
        ).bind(`session-${id}`, token, initialAt, initialAt, id),
      ]);
    }
    await db.batch([
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Execution Org', 'execution-org', ?, ?)`,
      ).bind(organizationId, initialAt, initialAt),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, initialAt, initialAt),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'developer', ?, ?)`,
      ).bind(organizationId, memberId, initialAt, initialAt),
    ]);
    for (const [id, name] of [
      [projectAId, "Project A"],
      [projectBId, "Project B"],
    ]) {
      await db.batch([
        db.prepare(
          `insert into briar_projects (
             id, owner_user_id, organization_id, name, agent_token_hash,
             created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          ownerId,
          organizationId,
          name,
          createHash("sha256")
            .update(id === projectAId ? projectAAgentToken : `${id}:agent`)
            .digest("hex"),
          initialAt,
          initialAt,
        ),
        db.prepare(
          `insert into briar_project_settings (
             project_id, workflow_json, mandatory_checkpoints_json,
             created_at, updated_at
           ) values (?, ?, '[]', ?, ?)`,
        ).bind(
          id,
          JSON.stringify({
            version: 2,
            requirements: [],
            stages: [{ id: "implementing", label: "Implement", required: true }],
            execution: { checkpoints: [] },
            completion: { requiredStages: ["implementing"] },
          }),
          initialAt,
          initialAt,
        ),
      ]);
    }
    await db.batch(
      [projectAId, projectBId].map((projectId) =>
        db.prepare(
          `insert into briar_project_members (
             project_id, organization_id, user_id, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
        ).bind(projectId, organizationId, memberId, initialAt, initialAt)
      ),
    );
    projectAgentId = (await createProjectAgent(db, projectAId, {
      name: "Execution Agent",
      provider: "codex",
      model: null,
      effort: null,
      responsibility: "Own execution proposals.",
      calendarColor: "#123456",
    })).id;
    await registerExecutionWorker(db, projectAId, {
      id: "execution-any-worker",
      deviceId: "execution-device",
      organizationId,
      ownerUserId: ownerId,
      label: "Execution Worker",
      deviceIdentityHash: createHash("sha256").update("execution-device").digest("hex"),
      credentialTokenHash: createHash("sha256")
        .update(executionWorkerCredential).digest("hex"),
      agentProvider: "codex",
      capabilities: workerCapabilitiesFixture({ providerCapabilities }),
      versions: { briar: "1.0.0" },
      observedAt: new Date().toISOString(),
    });
  }, 60_000);

  const env = () => ({
    DB: db,
    ATTACHMENTS: attachments,
    BETTER_AUTH_SECRET: "test".repeat(8),
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
  }) as unknown as Env;

  type ChannelProposalApplicationCall = {
    kind: "create" | "execution";
    channelId: string;
    proposalId: string;
    token: string;
    request: Record<string, unknown>;
  };

  type IssueProposalApplicationCall = {
    kind: "action" | "execution";
    runId: string;
    proposalId: string;
    token: string;
    request?: Record<string, unknown>;
  };

  const invokeChannelProposal = async (
    call: ChannelProposalApplicationCall,
    runtimeEnv: Env,
  ) => {
    const userId = call.token === ownerToken
      ? ownerId
      : call.token === memberToken
      ? memberId
      : null;
    if (!userId) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    try {
      const result = call.kind === "create"
        ? await acceptOrganizationChannelProposal({
          db,
          env: runtimeEnv,
          organizationId,
          channelId: call.channelId,
          proposalId: call.proposalId,
          userId,
          request: call.request,
        })
        : await acceptOrganizationChannelExecutionProposal({
          db,
          env: runtimeEnv,
          organizationId,
          channelId: call.channelId,
          proposalId: call.proposalId,
          userId,
          request: call.request,
        });
      return Response.json(result);
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ message: error.message }, { status: error.status });
      }
      if (error instanceof WorkerConflictError) {
        return Response.json({ message: error.message }, { status: 409 });
      }
      return Response.json({ message: "Internal server error" }, { status: 500 });
    }
  };

  const invokeIssueProposal = async (call: IssueProposalApplicationCall) => {
    const session = await db.prepare(
      `select "userId" as user_id from "session" where token = ?`,
    ).bind(call.token).first<{ user_id: string }>();
    const userId = session?.user_id ?? null;
    if (!userId) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    try {
      const shared = {
        db,
        archivesBucket: attachments,
        projectId: projectAId,
        conversationRunId: call.runId,
        proposalId: call.proposalId,
        userId,
      };
      const result = call.kind === "action"
        ? await acceptProjectIssueActionProposal(shared)
        : await acceptProjectIssueExecutionProposal({
          ...shared,
          request: call.request ?? {},
        });
      return Response.json(result);
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ message: error.message }, { status: error.status });
      }
      if (error instanceof RequestDecodeError) {
        return Response.json({ message: error.message }, { status: 400 });
      }
      if (error instanceof WorkerConflictError) {
        return Response.json({ message: error.message }, { status: 409 });
      }
      return Response.json({ message: "Internal server error" }, { status: 500 });
    }
  };

  const worker = {
    fetch: (
      input: ChannelProposalApplicationCall | IssueProposalApplicationCall,
      runtimeEnv: Env,
    ) =>
      "channelId" in input
        ? invokeChannelProposal(input, runtimeEnv)
        : invokeIssueProposal(input),
  };

  const seedIssueProposal = async () => {
    sequence += 1;
    const suffix = sequence.toString(16).padStart(12, "0");
    const runId = await recordHuntEvent(
      db,
      projectAId,
      event(`execution-direct-${sequence}`, `Direct execution ${sequence}`),
    );
    const triggerMessageId = `b1000000-0000-4000-8000-${suffix}`;
    const replyMessageId = `b2000000-0000-4000-8000-${suffix}`;
    const jobId = `b3000000-0000-4000-8000-${suffix}`;
    const proposalId = `b4000000-0000-4000-8000-${suffix}`;
    await createIssueMessage(db, {
      id: triggerMessageId,
      projectId: projectAId,
      runId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentProvider: null,
      body: "이 이슈를 실행해 줘.",
      createdAt: initialAt,
    });
    await enqueueIssueAgentReply(db, {
      id: jobId,
      projectId: projectAId,
      runId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      replyMessageId,
      createdAt: initialAt,
    });
    await createIssueMessage(db, {
      id: replyMessageId,
      projectId: projectAId,
      runId,
      parentMessageId: triggerMessageId,
      authorUserId: null,
      authorAgentProvider: "codex",
      body: "실행 설정 승인이 필요합니다.",
      createdAt: initialAt,
    });
    const proposal = await createIssueExecutionProposal(db, {
      id: proposalId,
      projectId: projectAId,
      conversationRunId: runId,
      triggerMessageId,
      replyMessageId,
      createdAt: initialAt,
    });
    expect(proposal).not.toBeNull();
    return { runId, proposalId };
  };

  const acceptIssueRequest = (
    runId: string,
    proposalId: string,
    token = ownerToken,
    body: Record<string, unknown> = {
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      workerId: null,
    },
  ): IssueProposalApplicationCall => ({
    kind: "execution",
    runId,
    proposalId,
    token,
    request: body,
  });

  const seedClaimedIssueReply = async (input?: {
    claimToken?: string;
    claimedAt?: string;
    leaseExpiresAt?: string;
  }) => {
    sequence += 1;
    const suffix = sequence.toString(16).padStart(12, "0");
    const runId = await recordHuntEvent(
      db,
      projectAId,
      event(`execution-agent-output-${sequence}`, `Agent output ${sequence}`),
    );
    await db.prepare(
      `update briar_hunt_runs set agent_id = ? where id = ? and project_id = ?`,
    ).bind(projectAgentId, runId, projectAId).run();
    const triggerMessageId = `ba000000-0000-4000-8000-${suffix}`;
    const replyMessageId = `bb000000-0000-4000-8000-${suffix}`;
    const jobId = `bc000000-0000-4000-8000-${suffix}`;
    const claimToken = input?.claimToken ??
      `briar_reply_claim_${sequence.toString(16).padStart(64, "0")}`;
    const claimedAt = input?.claimedAt ??
      new Date(Date.now() - 1_000).toISOString();
    const leaseExpiresAt = input?.leaseExpiresAt ??
      new Date(Date.now() + 60_000).toISOString();
    await createIssueMessage(db, {
      id: triggerMessageId,
      projectId: projectAId,
      runId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentProvider: null,
      body: "이 이슈를 실행해 줘.",
      createdAt: claimedAt,
    });
    await enqueueIssueAgentReply(db, {
      id: jobId,
      projectId: projectAId,
      runId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      replyMessageId,
      createdAt: claimedAt,
    });
    await db.prepare(
      `update briar_issue_agent_reply_jobs
       set status = 'running', claimed_worker_id = ?, agent_provider = 'codex',
           claim_token_hash = ?, claimed_at = ?, lease_expires_at = ?,
           attempts = attempts + 1, updated_at = ?
       where id = ? and project_id = ?`,
    ).bind(
      "execution-any-worker",
      createHash("sha256").update(claimToken).digest("hex"),
      claimedAt,
      leaseExpiresAt,
      claimedAt,
      jobId,
      projectAId,
    ).run();
    return {
      runId,
      jobId,
      triggerMessageId,
      replyMessageId,
      claimToken,
    };
  };

  const completeIssueReply = async (
    jobId: string,
    runId: string,
    claimToken: string,
    body = "실행 설정을 선택하고 승인해 주세요.",
  ) => completeIssueReplyApplication({
    db,
    env: env(),
    worker: {
      principal: { organizationId, deviceId: "execution-device" },
      binding: { id: "execution-any-worker", project_id: projectAId },
    },
    request: completeIssueReplyInputFromProto(create(
      CompleteIssueReplyRequestSchema,
      {
        requestId: crypto.randomUUID(),
        projectId: projectAId,
        workerId: "execution-any-worker",
        work: create(WorkClaimIdentitySchema, {
          workId: jobId,
          runId,
          claimToken,
          work: {
            case: "issueReply",
            value: create(IssueReplyClaimIdentitySchema),
          },
        }),
        outcome: {
          case: "success",
          value: {
            body,
            action: { case: "execution", value: {} },
          },
        },
      },
    )),
  });

  it("dispatches only after explicit approval and finalizes both audits atomically", async () => {
    const { runId, proposalId } = await seedIssueProposal();
    const providerReportedModel = "gpt-provider-reported-model";
    expect(await getIssueExecutionProposal(db, projectAId, runId, proposalId))
      .toMatchObject({ status: "pending", dispatch_request_id: null });
    expect(await getHuntRunForProject(db, projectAId, runId)).toMatchObject({
      status: "backlog",
      dispatch_request_id: null,
    });

    const hiddenAuthority = await worker.fetch(
      acceptIssueRequest(runId, proposalId, ownerToken, {
        provider: "codex",
        model: null,
        effort: null,
        workerId: null,
        requestId: "client-controlled",
      }),
      env(),
    );
    expect(hiddenAuthority.status).toBe(400);

    const acceptedResponse = await worker.fetch(
      acceptIssueRequest(runId, proposalId, ownerToken, {
        provider: "codex",
        model: providerReportedModel,
        effort: "high",
        workerId: null,
      }),
      env(),
    );
    expect(acceptedResponse.status).toBe(200);
    await expect(acceptedResponse.json()).resolves.toMatchObject({
      outcome: "accepted",
      projectId: projectAId,
      runId,
      proposal: {
        id: proposalId,
        type: "request_issue_execute",
        status: "accepted",
        requestedProvider: "codex",
        requestedModel: providerReportedModel,
        requestedEffort: "high",
        requestedWorkerId: null,
      },
      dispatch: { outcome: "dispatched", dispatchMode: "any" },
    });
    const proposal = await getIssueExecutionProposal(
      db,
      projectAId,
      runId,
      proposalId,
    );
    expect(proposal).toMatchObject({
      status: "accepted",
      accepted_by_user_id: ownerId,
      requested_provider: "codex",
      requested_model: providerReportedModel,
      requested_effort: "high",
    });
    expect(proposal?.dispatch_request_id).toEqual(expect.any(String));
    expect(await getHuntRunForProject(db, projectAId, runId)).toMatchObject({
      status: "queued",
      dispatch_request_id: proposal?.dispatch_request_id,
      requested_by_user_id: ownerId,
    });
    await expect(db.prepare(
      `select count(*) as count from briar_execution_audit_events
       where run_id = ? and request_id = ? and action = 'dispatched'`,
    ).bind(runId, proposal?.dispatch_request_id).first()).resolves.toEqual({
      count: 1,
    });
    await expect(db.prepare(
      `select count(*) as count from briar_issue_execution_approval_audit
       where proposal_id = ? and dispatch_request_id = ?`,
    ).bind(proposalId, proposal?.dispatch_request_id).first()).resolves.toEqual({
      count: 1,
    });
    await expect(db.prepare(
      `delete from briar_issue_execution_approval_audit where proposal_id = ?`,
    ).bind(proposalId).run()).rejects.toThrow(
      "issue execution approval audit is immutable",
    );

    const retry = await worker.fetch(
      acceptIssueRequest(runId, proposalId, ownerToken, {
        provider: "codex",
        model: providerReportedModel,
        effort: "high",
        workerId: null,
      }),
      env(),
    );
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      outcome: "already_accepted",
      dispatch: { outcome: "already_dispatched" },
    });
    expect((await worker.fetch(
      acceptIssueRequest(runId, proposalId, memberToken),
      env(),
    )).status).toBe(409);
    expect((await worker.fetch(
      acceptIssueRequest(runId, proposalId, ownerToken, {
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "medium",
        workerId: null,
      }),
      env(),
    )).status).toBe(409);
  });

  it("atomically persists an Issue Agent execution card from its live lease", async () => {
    const seeded = await seedClaimedIssueReply();
    await completeIssueReply(
      seeded.jobId,
      seeded.runId,
      seeded.claimToken,
    );
    await expect(db.prepare(
      `select status, claim_token_hash, lease_expires_at
       from briar_issue_agent_reply_jobs where id = ?`,
    ).bind(seeded.jobId).first()).resolves.toEqual({
      status: "completed",
      claim_token_hash: null,
      lease_expires_at: null,
    });
    await expect(db.prepare(
      `select count(*) as count from briar_issue_messages where id = ?`,
    ).bind(seeded.replyMessageId).first()).resolves.toEqual({ count: 1 });
    await expect(db.prepare(
      `select count(*) as count from briar_issue_execution_proposals
       where reply_message_id = ? and status = 'pending'`,
    ).bind(seeded.replyMessageId).first()).resolves.toEqual({ count: 1 });
    expect(await getHuntRunForProject(db, projectAId, seeded.runId))
      .toMatchObject({ status: "backlog", dispatch_request_id: null });
  });

  it("rejects expired and superseded Issue Agent leases without stale output", async () => {
    const oldToken = `briar_reply_claim_${"d".repeat(64)}`;
    const seeded = await seedClaimedIssueReply({
      claimToken: oldToken,
      claimedAt: new Date(Date.now() - 120_000).toISOString(),
      leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const oldHash = createHash("sha256").update(oldToken).digest("hex");
    const now = new Date().toISOString();
    await expect(renewIssueAgentReplyLease(
      db,
      projectAId,
      seeded.jobId,
      {
        workerId: "execution-any-worker",
        claimTokenHash: oldHash,
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        updatedAt: now,
      },
    )).resolves.toBeNull();
    await expect(failIssueAgentReply(db, projectAId, seeded.jobId, {
      workerId: "execution-any-worker",
      claimTokenHash: oldHash,
      error: "stale failure",
      updatedAt: now,
    })).resolves.toBeNull();

    const newToken = `briar_reply_claim_${"e".repeat(64)}`;
    await db.prepare(
      `update briar_issue_agent_reply_jobs
       set claim_token_hash = ?, claimed_at = ?, lease_expires_at = ?,
           attempts = attempts + 1, updated_at = ?
       where id = ? and status = 'running'`,
    ).bind(
      createHash("sha256").update(newToken).digest("hex"),
      now,
      new Date(Date.now() + 60_000).toISOString(),
      now,
      seeded.jobId,
    ).run();

    await expect(completeIssueReply(
      seeded.jobId,
      seeded.runId,
      oldToken,
    )).rejects.toMatchObject({ reason: "claim_conflict" });
    await expect(db.prepare(
      `select count(*) as count from briar_issue_messages where id = ?`,
    ).bind(seeded.replyMessageId).first()).resolves.toEqual({ count: 0 });
    await expect(db.prepare(
      `select count(*) as count from briar_issue_execution_proposals
       where reply_message_id = ?`,
    ).bind(seeded.replyMessageId).first()).resolves.toEqual({ count: 0 });

    await completeIssueReply(
      seeded.jobId,
      seeded.runId,
      newToken,
      "새 claim이 만든 승인 카드입니다.",
    );
    await expect(db.prepare(
      `select body from briar_issue_messages where id = ?`,
    ).bind(seeded.replyMessageId).first()).resolves.toEqual({
      body: "새 claim이 만든 승인 카드입니다.",
    });
    await expect(db.prepare(
      `select status from briar_issue_execution_proposals
       where reply_message_id = ?`,
    ).bind(seeded.replyMessageId).first()).resolves.toEqual({
      status: "pending",
    });
  });

  it("fails a repaired partial dispatch closed until approval audit exists", async () => {
    const { runId, proposalId } = await seedIssueProposal();
    const reservation = await reserveIssueExecutionProposalApproval(db, {
      projectId: projectAId,
      conversationRunId: runId,
      proposalId,
      userId: ownerId,
      provider: "codex",
      model: null,
      effort: null,
      workerId: null,
      dispatchRequestId: crypto.randomUUID(),
      reservedAt: new Date().toISOString(),
    });
    expect(reservation?.dispatch_request_id).toEqual(expect.any(String));
    await db.prepare(
      `update briar_hunt_runs
       set status = 'queued', stage = 'queued', workflow_stage = null,
           requested_agent_provider = ?, requested_agent_model = ?,
           requested_agent_effort = ?, requested_worker_id = ?,
           dispatch_mode = 'any', dispatch_request_id = ?, dispatched_at = ?,
           requested_by_user_id = ?, updated_at = ?
       where id = ? and project_id = ?`,
    ).bind(
      reservation!.requested_provider,
      reservation!.requested_model,
      reservation!.requested_effort,
      reservation!.requested_worker_id,
      reservation!.dispatch_request_id,
      reservation!.approval_reserved_at,
      reservation!.approval_reserved_by_user_id,
      reservation!.approval_reserved_at,
      runId,
      projectAId,
    ).run();
    await expect(db.prepare(
      `select count(*) as count from briar_issue_execution_approval_audit
       where dispatch_request_id = ?`,
    ).bind(reservation!.dispatch_request_id).first()).resolves.toEqual({
      count: 0,
    });
    await expect(claimNextQueuedHuntRun(db, projectAId, {
      claimTokenHash: createHash("sha256")
        .update(`partial-claim-${sequence}`).digest("hex"),
      claimedBy: "Execution Worker",
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      runId,
      workerId: "execution-any-worker",
      agentProvider: "codex",
      detachedOnly: true,
    })).rejects.toThrow("conversational execution approval audit is missing");
    await expect(unassignHuntRun(db, organizationId, projectAId, {
      runId,
      requestedByUserId: ownerId,
      requestId: `partial-reset-${sequence}`,
      occurredAt: new Date().toISOString(),
    })).resolves.toMatchObject({ outcome: "unassigned" });
  });

  it("transfers an approved retryable issue only as a clean backlog", async () => {
    const { runId, proposalId } = await seedIssueProposal();
    expect((await worker.fetch(acceptIssueRequest(runId, proposalId), env())).status)
      .toBe(200);
    await expect(transferIssue(db, {
      sourceProjectId: projectAId,
      targetProjectId: projectBId,
      targetProjectName: "Project B",
      runId,
      observedAt: "2026-08-11T00:03:00.000Z",
    })).resolves.toBe("transferred");
    expect(await getHuntRunForProject(db, projectBId, runId)).toMatchObject({
      status: "backlog",
      dispatch_request_id: null,
      requested_by_user_id: null,
      requested_agent_provider: null,
      agent_id: null,
    });
    await expect(db.prepare(
      `select status, generation from briar_issue_execution_proposals
       where id = ?`,
    ).bind(proposalId).first()).resolves.toEqual({
      status: "invalidated",
      generation: 2,
    });
  });

  const seedChannelProposal = async (options: {
    approverId?: string;
    agentId?: string;
    delegatedByAgentId?: string | null;
    delegatedByAgentName?: string | null;
    reserve?: boolean;
  } = {}) => {
    const approverId = options.approverId ?? ownerId;
    const proposedAgentId = options.agentId ?? projectAgentId;
    sequence += 1;
    const suffix = sequence.toString(16).padStart(12, "0");
    const channelId = `c1000000-0000-4000-8000-${suffix}`;
    const triggerMessageId = `c2000000-0000-4000-8000-${suffix}`;
    const replyMessageId = `c3000000-0000-4000-8000-${suffix}`;
    const proposalId = `c4000000-0000-4000-8000-${suffix}`;
    const runId = await recordHuntEvent(
      db,
      projectAId,
      event(`execution-channel-${sequence}`, `Channel execution ${sequence}`),
    );
    await createChannel(db, {
      id: channelId,
      organizationId,
      kind: "channel",
      dmKey: null,
      slug: `execution-${sequence}`,
      name: `Execution ${sequence}`,
      topic: null,
      visibility: "public",
      defaultProjectId: projectAId,
      createdByUserId: ownerId,
      createdAt: initialAt,
    });
    await addChannelAgent(db, {
      channelId,
      agentId: proposedAgentId,
      addedByUserId: ownerId,
      createdAt: initialAt,
    });
    await createChannelMessage(db, {
      id: triggerMessageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "채널에서 실행해 줘.",
      mentionedUserIds: [],
      mentionedAgentIds: [proposedAgentId],
      createdAt: initialAt,
    });
    await createChannelMessage(db, {
      id: replyMessageId,
      channelId,
      parentMessageId: triggerMessageId,
      authorUserId: null,
      authorAgentId: proposedAgentId,
      authorAgentName: "Execution Agent",
      authorAgentProvider: "codex",
      body: "실행 승인이 필요합니다.",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: initialAt,
    });
    await db.prepare(
      `insert into briar_issue_execution_proposals (
         id, organization_id, project_id, source_kind, channel_id,
         conversation_run_id, trigger_message_id, reply_message_id,
         target_run_id, target_title, target_run_updated_at,
         proposed_by_agent_id, delegated_by_agent_id,
         delegated_by_agent_name, created_at, updated_at
       )
       select ?, ?, ?, 'channel', ?, null, ?, ?, run.id, run.title,
              run.updated_at, ?, ?, ?, ?, ?
       from briar_hunt_runs run where run.id = ? and run.project_id = ?`,
    ).bind(
      proposalId,
      organizationId,
      projectAId,
      channelId,
      triggerMessageId,
      replyMessageId,
      proposedAgentId,
      options.delegatedByAgentId ?? null,
      options.delegatedByAgentName ?? null,
      initialAt,
      initialAt,
      runId,
      projectAId,
    ).run();
    const reservation = options.reserve === false
      ? null
      : await reserveChannelExecutionProposalApproval(db, {
          organizationId,
          channelId,
          proposalId,
          userId: approverId,
          provider: "codex",
          model: null,
          effort: null,
          workerId: null,
          dispatchRequestId: crypto.randomUUID(),
          reservedAt: new Date().toISOString(),
        });
    if (options.reserve !== false) expect(reservation).not.toBeNull();
    return { channelId, runId, proposalId, reservation };
  };

  const acceptChannelRequest = (
    channelId: string,
    proposalId: string,
    token = ownerToken,
    body: Record<string, unknown> = {
      provider: "codex",
      model: null,
      effort: null,
      workerId: null,
    },
  ): ChannelProposalApplicationCall => ({
    kind: "execution",
    channelId,
    proposalId,
    token,
    request: body,
  });

  it("accepts channel execution once and binds retries to the same member and settings", async () => {
    const seeded = await seedChannelProposal({ reserve: false });
    expect(await getHuntRunForProject(db, projectAId, seeded.runId))
      .toMatchObject({ status: "backlog", dispatch_request_id: null });
    const accepted = await worker.fetch(
      acceptChannelRequest(seeded.channelId, seeded.proposalId),
      env(),
    );
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      outcome: "accepted",
      projectId: projectAId,
      runId: seeded.runId,
      proposal: { id: seeded.proposalId, status: "accepted" },
      dispatch: { outcome: "dispatched", dispatchMode: "any" },
    });
    const retry = await worker.fetch(
      acceptChannelRequest(seeded.channelId, seeded.proposalId),
      env(),
    );
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      outcome: "already_accepted",
      dispatch: { outcome: "already_dispatched" },
    });
    expect((await worker.fetch(
      acceptChannelRequest(seeded.channelId, seeded.proposalId, memberToken),
      env(),
    )).status).toBe(409);
    expect((await worker.fetch(
      acceptChannelRequest(
        seeded.channelId,
        seeded.proposalId,
        ownerToken,
        {
          provider: "codex",
          model: "gpt-5.6-sol",
          effort: "high",
          workerId: null,
        },
      ),
      env(),
    )).status).toBe(409);
  });

  it("keeps create and execute as two approvals for issue and channel conversations", async () => {
    sequence += 1;
    const issueSuffix = sequence.toString(16).padStart(12, "0");
    const conversationRunId = await recordHuntEvent(
      db,
      projectAId,
      event(`execution-create-issue-${sequence}`, `Create source ${sequence}`),
    );
    const issueTriggerId = `d1000000-0000-4000-8000-${issueSuffix}`;
    const issueReplyId = `d2000000-0000-4000-8000-${issueSuffix}`;
    const issueActionId = `d3000000-0000-4000-8000-${issueSuffix}`;
    const issueExecutionId = `d4000000-0000-4000-8000-${issueSuffix}`;
    await createIssueMessage(db, {
      id: issueTriggerId,
      projectId: projectAId,
      runId: conversationRunId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentProvider: null,
      body: "새 이슈를 만들고 실행해 줘.",
      createdAt: initialAt,
    });
    await createIssueMessage(db, {
      id: issueReplyId,
      projectId: projectAId,
      runId: conversationRunId,
      parentMessageId: issueTriggerId,
      authorUserId: null,
      authorAgentProvider: "codex",
      body: "생성과 실행은 각각 승인이 필요합니다.",
      createdAt: initialAt,
    });
    await createIssueActionProposal(db, {
      id: issueActionId,
      projectId: projectAId,
      conversationRunId,
      triggerMessageId: issueTriggerId,
      replyMessageId: issueReplyId,
      actionType: "request_issue_create",
      payloadJson: JSON.stringify({
        issue: {
          title: "Issue create then execute",
          description: null,
          priority: 2,
        },
      }),
      executeAfterCreate: true,
      executionProposalId: issueExecutionId,
      createdAt: initialAt,
    });
    const issueCreateAccept = (): IssueProposalApplicationCall => ({
      kind: "action",
      runId: conversationRunId,
      proposalId: issueActionId,
      token: ownerToken,
    });
    const issueCreatedResponse = await worker.fetch(issueCreateAccept(), env());
    expect(issueCreatedResponse.status).toBe(200);
    const issueCreated = await issueCreatedResponse.json<{
      resultRunId: string;
      executionProposal: { id: string; status: string };
    }>();
    expect(issueCreated.executionProposal).toEqual(expect.objectContaining({
      id: issueExecutionId,
      status: "pending",
    }));
    expect(await getHuntRunForProject(db, projectAId, issueCreated.resultRunId))
      .toMatchObject({ status: "backlog", dispatch_request_id: null });
    expect((await listIssueExecutionProposals(db, projectAId, conversationRunId))
      .filter((proposal) => proposal.origin_create_proposal_id === issueActionId))
      .toHaveLength(1);
    await expect(db.prepare(
      `select count(*) as count from briar_execution_audit_events
       where run_id = ?`,
    ).bind(issueCreated.resultRunId).first()).resolves.toEqual({ count: 0 });
    await expect(db.prepare(
      `select count(*) as count from briar_issue_execution_approval_audit
       where run_id = ?`,
    ).bind(issueCreated.resultRunId).first()).resolves.toEqual({ count: 0 });
    expect((await worker.fetch(issueCreateAccept(), env())).status).toBe(200);
    expect((await listIssueExecutionProposals(db, projectAId, conversationRunId))
      .filter((proposal) => proposal.origin_create_proposal_id === issueActionId))
      .toHaveLength(1);
    expect((await worker.fetch(
      acceptIssueRequest(conversationRunId, issueExecutionId),
      env(),
    )).status).toBe(200);
    expect(await getHuntRunForProject(db, projectAId, issueCreated.resultRunId))
      .toMatchObject({ status: "queued", dispatch_request_id: expect.any(String) });

    sequence += 1;
    const channelSuffix = sequence.toString(16).padStart(12, "0");
    const channelId = `d5000000-0000-4000-8000-${channelSuffix}`;
    const channelTriggerId = `d6000000-0000-4000-8000-${channelSuffix}`;
    const channelReplyId = `d7000000-0000-4000-8000-${channelSuffix}`;
    const channelActionId = `d8000000-0000-4000-8000-${channelSuffix}`;
    const channelExecutionId = `d9000000-0000-4000-8000-${channelSuffix}`;
    await createChannel(db, {
      id: channelId,
      organizationId,
      kind: "channel",
      dmKey: null,
      slug: `create-execute-${sequence}`,
      name: "Create and execute",
      topic: null,
      visibility: "public",
      defaultProjectId: projectAId,
      createdByUserId: ownerId,
      createdAt: initialAt,
    });
    await addChannelAgent(db, {
      channelId,
      agentId: projectAgentId,
      addedByUserId: ownerId,
      createdAt: initialAt,
    });
    await createChannelMessage(db, {
      id: channelTriggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "채널에서 새 이슈를 만들고 실행해 줘.",
      mentionedUserIds: [],
      mentionedAgentIds: [projectAgentId],
      createdAt: initialAt,
    });
    await createChannelMessage(db, {
      id: channelReplyId,
      channelId,
      parentMessageId: channelTriggerId,
      authorUserId: null,
      authorAgentId: projectAgentId,
      authorAgentName: "Execution Agent",
      authorAgentProvider: "codex",
      body: "먼저 생성 승인이 필요합니다.",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: initialAt,
    });
    await db.prepare(
      `insert into briar_channel_action_proposals (
         id, channel_id, project_id, trigger_message_id, reply_message_id,
         action_type, payload_json, execute_after_create,
         execution_proposal_id, created_at, updated_at
       ) values (?, ?, ?, ?, ?, 'request_issue_create', ?, 1, ?, ?, ?)`,
    ).bind(
      channelActionId,
      channelId,
      projectAId,
      channelTriggerId,
      channelReplyId,
      JSON.stringify({
        issue: {
          title: "Channel create then execute",
          description: null,
          priority: 2,
        },
      }),
      channelExecutionId,
      initialAt,
      initialAt,
    ).run();
    const channelCreateAccept = (): ChannelProposalApplicationCall => ({
      kind: "create",
      channelId,
      proposalId: channelActionId,
      token: ownerToken,
      request: { projectId: projectAId },
    });
    const channelCreatedResponse = await worker.fetch(channelCreateAccept(), env());
    expect(channelCreatedResponse.status).toBe(200);
    const channelCreated = await channelCreatedResponse.json<{
      resultRunId: string;
      executionProposal: { id: string; status: string };
    }>();
    expect(channelCreated.executionProposal).toEqual(expect.objectContaining({
      id: channelExecutionId,
      status: "pending",
    }));
    expect(await getHuntRunForProject(db, projectAId, channelCreated.resultRunId))
      .toMatchObject({ status: "backlog", dispatch_request_id: null });
    await expect(db.prepare(
      `select count(*) as count from briar_issue_execution_proposals
       where source_kind = 'channel' and origin_create_proposal_id = ?`,
    ).bind(channelActionId).first()).resolves.toEqual({ count: 1 });
    await expect(db.prepare(
      `select count(*) as count from briar_execution_audit_events
       where run_id = ?`,
    ).bind(channelCreated.resultRunId).first()).resolves.toEqual({ count: 0 });
    expect((await worker.fetch(channelCreateAccept(), env())).status).toBe(200);
    await expect(db.prepare(
      `select count(*) as count from briar_issue_execution_proposals
       where source_kind = 'channel' and origin_create_proposal_id = ?`,
    ).bind(channelActionId).first()).resolves.toEqual({ count: 1 });
    await db.prepare(
      `update briar_hunt_runs set title = ?, updated_at = ? where id = ?`,
    ).bind(
      "Changed after create approval",
      new Date().toISOString(),
      channelCreated.resultRunId,
    ).run();
    const staleCreateRetry = await worker.fetch(channelCreateAccept(), env());
    expect(staleCreateRetry.status).toBe(200);
    await expect(staleCreateRetry.json()).resolves.toMatchObject({
      outcome: "already_accepted",
      executionProposal: null,
    });
    expect((await worker.fetch(
      acceptChannelRequest(channelId, channelExecutionId),
      env(),
    )).status).toBe(409);
    expect(await getHuntRunForProject(db, projectAId, channelCreated.resultRunId))
      .toMatchObject({ status: "backlog", dispatch_request_id: null });
  });

  it("rolls back create approval when its linked execution identity collides", async () => {
    const collision = await seedIssueProposal();
    sequence += 1;
    const suffix = sequence.toString(16).padStart(12, "0");
    const conversationRunId = await recordHuntEvent(
      db,
      projectAId,
      event(`execution-collision-conversation-${sequence}`, "Collision source"),
    );
    const triggerMessageId = `da000000-0000-4000-8000-${suffix}`;
    const replyMessageId = `db000000-0000-4000-8000-${suffix}`;
    const actionProposalId = `dc000000-0000-4000-8000-${suffix}`;
    await createIssueMessage(db, {
      id: triggerMessageId,
      projectId: projectAId,
      runId: conversationRunId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentProvider: null,
      body: "새 이슈를 만들고 실행해 줘.",
      createdAt: initialAt,
    });
    await enqueueIssueAgentReply(db, {
      id: `dd000000-0000-4000-8000-${suffix}`,
      projectId: projectAId,
      runId: conversationRunId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      replyMessageId,
      createdAt: initialAt,
    });
    await createIssueMessage(db, {
      id: replyMessageId,
      projectId: projectAId,
      runId: conversationRunId,
      parentMessageId: triggerMessageId,
      authorUserId: null,
      authorAgentProvider: "codex",
      body: "생성과 실행은 각각 승인이 필요합니다.",
      createdAt: initialAt,
    });
    await expect(createIssueActionProposal(db, {
      id: actionProposalId,
      projectId: projectAId,
      conversationRunId,
      triggerMessageId,
      replyMessageId,
      actionType: "request_issue_create",
      payloadJson: JSON.stringify({
        issue: {
          title: "Collision result",
          description: null,
          priority: null,
        },
      }),
      executeAfterCreate: true,
      executionProposalId: collision.proposalId,
      createdAt: initialAt,
    })).resolves.not.toBeNull();
    const issueSourceKey = `execution-collision-result-${sequence}`;
    await expect(reserveIssueCreateProposalApproval(db, {
      projectId: projectAId,
      conversationRunId,
      proposalId: actionProposalId,
      userId: ownerId,
      reservedAt: new Date().toISOString(),
      issueSourceKey,
    })).resolves.not.toBeNull();
    const resultRunId = await recordHuntEvent(
      db,
      projectAId,
      event(issueSourceKey, "Collision result"),
    );
    await expect(acceptIssueCreateProposal(db, {
      projectId: projectAId,
      conversationRunId,
      proposalId: actionProposalId,
      userId: ownerId,
      acceptedAt: new Date().toISOString(),
      resultRunId,
    })).rejects.toThrow("issue execution proposal was not materialized");
    await expect(db.prepare(
      `select status, result_run_id from briar_issue_action_proposals
       where id = ?`,
    ).bind(actionProposalId).first()).resolves.toEqual({
      status: "pending",
      result_run_id: null,
    });
    await expect(db.prepare(
      `select count(*) as count from briar_issue_execution_proposals
       where origin_create_proposal_id = ?`,
    ).bind(actionProposalId).first()).resolves.toEqual({ count: 0 });
  });

  it("keeps reserved tombstones when channel scope is revoked", async () => {
    const deleted = await seedChannelProposal();
    const deletedReservation = deleted.reservation!;
    await db.prepare(`delete from briar_channels where id = ?`)
      .bind(deleted.channelId).run();
    await expect(db.prepare(
      `select status, generation, channel_id, dispatch_request_id
       from briar_issue_execution_proposals where id = ?`,
    ).bind(deleted.proposalId).first()).resolves.toEqual({
      status: "invalidated",
      generation: 2,
      channel_id: null,
      dispatch_request_id: deletedReservation.dispatch_request_id,
    });
    await expect(dispatchHuntRun(db, organizationId, projectAId, {
      runId: deleted.runId,
      agentId: projectAgentId,
      provider: "codex",
      model: null,
      effort: null,
      workerId: null,
      requestedByUserId: ownerId,
      requestId: deletedReservation.dispatch_request_id!,
      occurredAt: deletedReservation.approval_reserved_at!,
    })).rejects.toThrow("channel execution proposal source is stale");
    expect(await getHuntRunForProject(db, projectAId, deleted.runId))
      .toMatchObject({ status: "backlog", dispatch_request_id: null });

    const roster = await seedChannelProposal();
    await removeChannelAgent(db, roster.channelId, projectAgentId);
    await expect(db.prepare(
      `select status from briar_issue_execution_proposals where id = ?`,
    ).bind(roster.proposalId).first()).resolves.toEqual({ status: "invalidated" });

    const archived = await seedChannelProposal();
    await db.prepare(
      `update briar_channels set archived_at = ?, updated_at = ? where id = ?`,
    ).bind(
      "2026-08-11T00:04:00.000Z",
      "2026-08-11T00:04:00.000Z",
      archived.channelId,
    ).run();
    await expect(db.prepare(
      `select status from briar_issue_execution_proposals where id = ?`,
    ).bind(archived.proposalId).first()).resolves.toEqual({ status: "invalidated" });

    const madePrivate = await seedChannelProposal({ approverId: memberId });
    await db.prepare(
      `update briar_channels set visibility = 'private', updated_at = ?
       where id = ?`,
    ).bind("2026-08-11T00:04:30.000Z", madePrivate.channelId).run();
    await expect(db.prepare(
      `select status from briar_issue_execution_proposals where id = ?`,
    ).bind(madePrivate.proposalId).first()).resolves.toEqual({
      status: "invalidated",
    });
  });

  it("invalidates a pending card when its fresh backlog snapshot changes", async () => {
    const { runId, proposalId } = await seedIssueProposal();
    await db.prepare(
      `update briar_hunt_runs set title = ?, updated_at = ? where id = ?`,
    ).bind(
      "Changed after proposal",
      "2026-08-11T00:05:00.000Z",
      runId,
    ).run();
    expect(await getIssueExecutionProposal(db, projectAId, runId, proposalId))
      .toMatchObject({ status: "invalidated", generation: 2 });
    expect((await worker.fetch(acceptIssueRequest(runId, proposalId), env())).status)
      .toBe(409);
  });

  it("keeps terminal approval history from becoming fresh execution authority", async () => {
    const { runId, proposalId } = await seedIssueProposal();
    expect((await worker.fetch(acceptIssueRequest(runId, proposalId), env())).status)
      .toBe(200);
    await db.prepare(
      `update briar_hunt_runs
       set status = 'completed', stage = 'completed', completed_at = ?,
           updated_at = ?, last_event_at = ? where id = ?`,
    ).bind(
      "2026-08-11T00:06:00.000Z",
      "2026-08-11T00:06:00.000Z",
      "2026-08-11T00:06:00.000Z",
      runId,
    ).run();
    await expect(db.prepare(
      `update briar_hunt_runs
       set status = 'queued', stage = 'queued', completed_at = null,
           updated_at = ? where id = ?`,
    ).bind("2026-08-11T00:06:10.000Z", runId).run()).rejects.toThrow(
      "conversational execution reactivation requires fresh approval",
    );
    await db.prepare(
      `update briar_hunt_runs
       set dispatch_request_id = null, dispatch_mode = null,
           dispatched_at = null, requested_by_user_id = null,
           requested_agent_provider = null, requested_agent_model = null,
           requested_agent_effort = null, updated_at = ? where id = ?`,
    ).bind("2026-08-11T00:06:20.000Z", runId).run();
    await expect(db.prepare(
      `update briar_hunt_runs set project_id = ?, updated_at = ? where id = ?`,
    ).bind(projectBId, "2026-08-11T00:06:30.000Z", runId).run())
      .rejects.toThrow("terminal issue transfer is not allowed");
  });

  it("uses immutable approval audit when the accepted proposal row is gone", async () => {
    const unassigned = await seedIssueProposal();
    expect((await worker.fetch(
      acceptIssueRequest(unassigned.runId, unassigned.proposalId),
      env(),
    )).status).toBe(200);
    await db.prepare(`delete from briar_issue_execution_proposals where id = ?`)
      .bind(unassigned.proposalId).run();
    await expect(unassignHuntRun(db, organizationId, projectAId, {
      runId: unassigned.runId,
      requestedByUserId: ownerId,
      requestId: `audit-only-unassign-${sequence}`,
      occurredAt: "2026-08-11T00:07:00.000Z",
    })).resolves.toMatchObject({ outcome: "unassigned" });
    expect(await getHuntRunForProject(db, projectAId, unassigned.runId))
      .toMatchObject({ status: "backlog", dispatch_request_id: null });

    const transferred = await seedIssueProposal();
    expect((await worker.fetch(
      acceptIssueRequest(transferred.runId, transferred.proposalId),
      env(),
    )).status).toBe(200);
    await db.prepare(`delete from briar_issue_execution_proposals where id = ?`)
      .bind(transferred.proposalId).run();
    await expect(transferIssue(db, {
      sourceProjectId: projectAId,
      targetProjectId: projectBId,
      targetProjectName: "Project B",
      runId: transferred.runId,
      observedAt: "2026-08-11T00:07:30.000Z",
    })).resolves.toBe("transferred");
    expect(await getHuntRunForProject(db, projectBId, transferred.runId))
      .toMatchObject({ status: "backlog", dispatch_request_id: null });
  });

  it("revokes committed runs when an approved Agent, Worker, or member disappears", async () => {
    const disposableAgent = await createProjectAgent(db, projectAId, {
      name: `Committed Agent ${sequence}`,
      provider: "codex",
      model: null,
      effort: null,
      responsibility: "Own a committed execution approval.",
      calendarColor: "#445566",
    });
    const agentApproval = await seedChannelProposal({
      agentId: disposableAgent.id,
      reserve: false,
    });
    expect((await worker.fetch(
      acceptChannelRequest(agentApproval.channelId, agentApproval.proposalId),
      env(),
    )).status).toBe(200);
    await expect(claimNextQueuedHuntRun(db, projectAId, {
      claimTokenHash: createHash("sha256")
        .update(`committed-agent-${sequence}`).digest("hex"),
      claimedBy: "Execution Worker",
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      runId: agentApproval.runId,
      workerId: "execution-any-worker",
      agentProvider: "codex",
      detachedOnly: true,
    })).resolves.toMatchObject({ id: agentApproval.runId });
    await db.prepare(`delete from briar_project_agents where id = ?`)
      .bind(disposableAgent.id).run();
    expect(await getHuntRunForProject(db, projectAId, agentApproval.runId))
      .toMatchObject({
        status: "backlog",
        agent_id: null,
        worker_id: null,
        claim_token_hash: null,
        dispatch_request_id: null,
      });
    await expect(db.prepare(
      `select status from briar_issue_execution_proposals where id = ?`,
    ).bind(agentApproval.proposalId).first()).resolves.toEqual({
      status: "invalidated",
    });

    const selectedWorkerId = `execution-committed-${++sequence}`;
    await registerExecutionWorker(db, projectAId, {
      id: selectedWorkerId,
      deviceId: `execution-committed-device-${sequence}`,
      organizationId,
      ownerUserId: ownerId,
      label: "Committed Worker",
      deviceIdentityHash: createHash("sha256")
        .update(`committed-device-${sequence}`).digest("hex"),
      credentialTokenHash: createHash("sha256")
        .update(`committed-token-${sequence}`).digest("hex"),
      agentProvider: "codex",
      capabilities: workerCapabilitiesFixture({ providerCapabilities }),
      versions: { briar: "1.0.0" },
      observedAt: new Date().toISOString(),
    });
    const workerApproval = await seedIssueProposal();
    expect((await worker.fetch(acceptIssueRequest(
      workerApproval.runId,
      workerApproval.proposalId,
      ownerToken,
      { provider: "codex", model: null, effort: null, workerId: selectedWorkerId },
    ), env())).status).toBe(200);
    await expect(claimNextQueuedHuntRun(db, projectAId, {
      claimTokenHash: createHash("sha256")
        .update(`committed-worker-${sequence}`).digest("hex"),
      claimedBy: "Committed Worker",
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      runId: workerApproval.runId,
      workerId: selectedWorkerId,
      agentProvider: "codex",
      detachedOnly: true,
    })).resolves.toMatchObject({ id: workerApproval.runId });
    await db.prepare(`delete from briar_execution_workers where id = ?`)
      .bind(selectedWorkerId).run();
    expect(await getHuntRunForProject(db, projectAId, workerApproval.runId))
      .toMatchObject({
        status: "backlog",
        worker_id: null,
        requested_worker_id: null,
        claim_token_hash: null,
        dispatch_request_id: null,
      });
    await expect(db.prepare(
      `select status from briar_issue_execution_proposals where id = ?`,
    ).bind(workerApproval.proposalId).first()).resolves.toEqual({
      status: "invalidated",
    });

    const approverId = `execution-approver-${++sequence}`;
    const approverToken = `execution-approver-token-${sequence}`;
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, 'Disposable Approver', ?, 1, ?, ?)`,
      ).bind(
        approverId,
        `${approverId}@example.com`,
        initialAt,
        initialAt,
      ),
      db.prepare(
        `insert into "session" (
           id, expiresAt, token, createdAt, updatedAt, userId
         ) values (?, '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
      ).bind(
        `session-${approverId}`,
        approverToken,
        initialAt,
        initialAt,
        approverId,
      ),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'developer', ?, ?)`,
      ).bind(organizationId, approverId, initialAt, initialAt),
      db.prepare(
        `insert into briar_project_members (
           project_id, organization_id, user_id, created_at, updated_at
         ) values (?, ?, ?, ?, ?)`,
      ).bind(projectAId, organizationId, approverId, initialAt, initialAt),
    ]);
    const memberApproval = await seedIssueProposal();
    expect((await worker.fetch(acceptIssueRequest(
      memberApproval.runId,
      memberApproval.proposalId,
      approverToken,
    ), env())).status).toBe(200);
    await expect(claimNextQueuedHuntRun(db, projectAId, {
      claimTokenHash: createHash("sha256")
        .update(`committed-approver-${sequence}`).digest("hex"),
      claimedBy: "Execution Worker",
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      runId: memberApproval.runId,
      workerId: "execution-any-worker",
      agentProvider: "codex",
      detachedOnly: true,
    })).resolves.toMatchObject({ id: memberApproval.runId });
    await db.prepare(`delete from "user" where id = ?`).bind(approverId).run();
    expect(await getHuntRunForProject(db, projectAId, memberApproval.runId))
      .toMatchObject({
        status: "backlog",
        worker_id: null,
        claim_token_hash: null,
        dispatch_request_id: null,
        requested_by_user_id: null,
      });
    await expect(db.prepare(
      `select status, approval_reserved_by_user_id, accepted_by_user_id
       from briar_issue_execution_proposals where id = ?`,
    ).bind(memberApproval.proposalId).first()).resolves.toEqual({
      status: "invalidated",
      approval_reserved_by_user_id: null,
      accepted_by_user_id: null,
    });
    await expect(db.prepare(
      `select approved_by_user_id
       from briar_issue_execution_approval_audit where proposal_id = ?`,
    ).bind(memberApproval.proposalId).first()).resolves.toEqual({
      approved_by_user_id: null,
    });
  });

  it("invalidates reservations when proposed/delegated Agents or the selected Worker are deleted", async () => {
    const proposedAgent = await createProjectAgent(db, projectAId, {
      name: `Disposable Agent ${sequence}`,
      provider: "codex",
      model: null,
      effort: null,
      responsibility: "Disposable proposal owner.",
      calendarColor: "#654321",
    });
    const proposed = await seedChannelProposal({ agentId: proposedAgent.id });
    await db.prepare(`delete from briar_project_agents where id = ?`)
      .bind(proposedAgent.id).run();
    await expect(db.prepare(
      `select status, proposed_by_agent_id, dispatch_request_id
       from briar_issue_execution_proposals where id = ?`,
    ).bind(proposed.proposalId).first()).resolves.toEqual({
      status: "invalidated",
      proposed_by_agent_id: null,
      dispatch_request_id: proposed.reservation?.dispatch_request_id,
    });

    const delegatedAgentId = `e1000000-0000-4000-8000-${(++sequence)
      .toString(16).padStart(12, "0")}`;
    await createOrganizationAgent(db, {
      id: delegatedAgentId,
      organizationId,
      name: `Delegator ${sequence}`,
      provider: "codex",
      model: null,
      responsibility: "Delegate project questions.",
      effort: null,
      createdAt: initialAt,
    });
    const delegated = await seedChannelProposal({
      delegatedByAgentId: delegatedAgentId,
      delegatedByAgentName: `Delegator ${sequence}`,
    });
    await db.prepare(`delete from briar_project_agents where id = ?`)
      .bind(delegatedAgentId).run();
    await expect(db.prepare(
      `select status, delegated_by_agent_id from briar_issue_execution_proposals
       where id = ?`,
    ).bind(delegated.proposalId).first()).resolves.toEqual({
      status: "invalidated",
      delegated_by_agent_id: null,
    });

    const selectedWorkerId = `execution-selected-${++sequence}`;
    await registerExecutionWorker(db, projectAId, {
      id: selectedWorkerId,
      deviceId: `execution-selected-device-${sequence}`,
      organizationId,
      ownerUserId: ownerId,
      label: "Selected Worker",
      deviceIdentityHash: createHash("sha256")
        .update(`selected-device-${sequence}`).digest("hex"),
      credentialTokenHash: createHash("sha256")
        .update(`selected-token-${sequence}`).digest("hex"),
      agentProvider: "codex",
      capabilities: workerCapabilitiesFixture({ providerCapabilities }),
      versions: { briar: "1.0.0" },
      observedAt: new Date().toISOString(),
    });
    const selected = await seedIssueProposal();
    const workerReservation = await reserveIssueExecutionProposalApproval(db, {
      projectId: projectAId,
      conversationRunId: selected.runId,
      proposalId: selected.proposalId,
      userId: ownerId,
      provider: "codex",
      model: null,
      effort: null,
      workerId: selectedWorkerId,
      dispatchRequestId: crypto.randomUUID(),
      reservedAt: new Date().toISOString(),
    });
    await expect(db.prepare(
      `update briar_issue_execution_proposals
       set requested_worker_id = null where id = ?`,
    ).bind(selected.proposalId).run()).rejects.toThrow(
      "issue execution approval reservation is immutable",
    );
    await db.prepare(`delete from briar_execution_workers where id = ?`)
      .bind(selectedWorkerId).run();
    await expect(db.prepare(
      `select status, requested_worker_id, dispatch_request_id
       from briar_issue_execution_proposals where id = ?`,
    ).bind(selected.proposalId).first()).resolves.toEqual({
      status: "invalidated",
      requested_worker_id: null,
      dispatch_request_id: workerReservation?.dispatch_request_id,
    });
  });

  it("allows project and organization erasure with reserved approval rows", async () => {
    const seedReservedProject = async (ownOrganization: boolean) => {
      sequence += 1;
      const suffix = sequence.toString(16).padStart(12, "0");
      const cascadeOrganizationId = ownOrganization
        ? `f1000000-0000-4000-8000-${suffix}`
        : organizationId;
      const cascadeProjectId = `f2000000-0000-4000-8000-${suffix}`;
      if (ownOrganization) {
        await db.batch([
          db.prepare(
            `insert into briar_organizations (
               id, name, handle, created_at, updated_at
             ) values (?, ?, ?, ?, ?)`,
          ).bind(
            cascadeOrganizationId,
            `Cascade Org ${sequence}`,
            `cascade-org-${sequence}`,
            initialAt,
            initialAt,
          ),
          db.prepare(
            `insert into briar_organization_members (
               organization_id, user_id, role, created_at, updated_at
             ) values (?, ?, 'owner', ?, ?)`,
          ).bind(cascadeOrganizationId, ownerId, initialAt, initialAt),
        ]);
      }
      await db.batch([
        db.prepare(
          `insert into briar_projects (
             id, owner_user_id, organization_id, name, agent_token_hash,
             created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          cascadeProjectId,
          ownerId,
          cascadeOrganizationId,
          `Cascade Project ${sequence}`,
          createHash("sha256").update(`cascade-${sequence}`).digest("hex"),
          initialAt,
          initialAt,
        ),
        db.prepare(
          `insert into briar_project_settings (
             project_id, workflow_json, mandatory_checkpoints_json,
             created_at, updated_at
           ) values (?, ?, '[]', ?, ?)`,
        ).bind(
          cascadeProjectId,
          JSON.stringify({
            version: 2,
            requirements: [],
            stages: [{ id: "implementing", label: "Implement", required: true }],
            execution: { checkpoints: [] },
            completion: { requiredStages: ["implementing"] },
          }),
          initialAt,
          initialAt,
        ),
      ]);
      const runId = await recordHuntEvent(
        db,
        cascadeProjectId,
        event(`cascade-${sequence}`, `Cascade ${sequence}`),
      );
      const triggerMessageId = `f3000000-0000-4000-8000-${suffix}`;
      const replyMessageId = `f4000000-0000-4000-8000-${suffix}`;
      const proposalId = `f5000000-0000-4000-8000-${suffix}`;
      await createIssueMessage(db, {
        id: triggerMessageId,
        projectId: cascadeProjectId,
        runId,
        parentMessageId: null,
        authorUserId: ownerId,
        authorAgentProvider: null,
        body: "실행해 줘.",
        createdAt: initialAt,
      });
      await enqueueIssueAgentReply(db, {
        id: `f6000000-0000-4000-8000-${suffix}`,
        projectId: cascadeProjectId,
        runId,
        triggerMessageId,
        parentMessageId: triggerMessageId,
        replyMessageId,
        createdAt: initialAt,
      });
      await createIssueMessage(db, {
        id: replyMessageId,
        projectId: cascadeProjectId,
        runId,
        parentMessageId: triggerMessageId,
        authorUserId: null,
        authorAgentProvider: "codex",
        body: "승인이 필요합니다.",
        createdAt: initialAt,
      });
      await expect(createIssueExecutionProposal(db, {
        id: proposalId,
        projectId: cascadeProjectId,
        conversationRunId: runId,
        triggerMessageId,
        replyMessageId,
        createdAt: initialAt,
      })).resolves.not.toBeNull();
      await expect(reserveIssueExecutionProposalApproval(db, {
        projectId: cascadeProjectId,
        conversationRunId: runId,
        proposalId,
        userId: ownerId,
        provider: "codex",
        model: null,
        effort: null,
        workerId: null,
        dispatchRequestId: crypto.randomUUID(),
        reservedAt: new Date().toISOString(),
      })).resolves.not.toBeNull();
      return { cascadeOrganizationId, cascadeProjectId, proposalId };
    };

    const projectCascade = await seedReservedProject(false);
    await expect(db.prepare(
      `delete from briar_issue_execution_proposals where id = ?`,
    ).bind(projectCascade.proposalId).run()).rejects.toThrow(
      "reserved execution proposal cannot be deleted",
    );
    await expect(db.prepare(`delete from briar_projects where id = ?`)
      .bind(projectCascade.cascadeProjectId).run()).resolves.toBeDefined();
    await expect(db.prepare(
      `select count(*) as count from briar_issue_execution_proposals
       where id = ?`,
    ).bind(projectCascade.proposalId).first()).resolves.toEqual({ count: 0 });

    const organizationCascade = await seedReservedProject(true);
    await expect(db.prepare(`delete from briar_organizations where id = ?`)
      .bind(organizationCascade.cascadeOrganizationId).run())
      .resolves.toBeDefined();
    await expect(db.prepare(
      `select count(*) as count from briar_issue_execution_proposals
       where id = ?`,
    ).bind(organizationCascade.proposalId).first()).resolves.toEqual({ count: 0 });
  });

  it("invalidates a reserved issue approval when the approver account is deleted", async () => {
    const { runId, proposalId } = await seedIssueProposal();
    const reservation = await reserveIssueExecutionProposalApproval(db, {
      projectId: projectAId,
      conversationRunId: runId,
      proposalId,
      userId: memberId,
      provider: "codex",
      model: null,
      effort: null,
      workerId: null,
      dispatchRequestId: crypto.randomUUID(),
      reservedAt: new Date().toISOString(),
    });
    expect(reservation).not.toBeNull();
    await db.prepare(`delete from "user" where id = ?`).bind(memberId).run();
    await expect(db.prepare(
      `select status, generation, approval_reserved_by_user_id,
              dispatch_request_id
       from briar_issue_execution_proposals where id = ?`,
    ).bind(proposalId).first()).resolves.toEqual({
      status: "invalidated",
      generation: 2,
      approval_reserved_by_user_id: null,
      dispatch_request_id: reservation?.dispatch_request_id,
    });
  });
});
