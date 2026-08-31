import { createHash } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { channelReplyClaimTokenHeader } from "../../src/lib/channels-contract";
import { claimNextChannelReplyWork } from "./channel-reply-claim-routes";
import {
  addChannelAgent,
  channelReplyJson,
  completeChannelReply,
  createChannel,
  createChannelMessage,
  enqueueChannelAgentReplies,
  getChannelAgentReplyJob,
  getChannelMessage,
  listChannelAgentReplies,
  removeChannelAgent,
  snapshotChannelReplyExecutionTargets,
} from "./channels";
import {
  createProjectAgent,
  recordHuntEvent,
  type HuntEventInput,
} from "./db";
import { HttpError } from "./http-response";
import { createOrganizationAgent } from "./organization-agents";
import { rethrowReplyCompletionHttpError } from "./reply-completion-http-error";
import { workerRuntimeProtoJsonFixture } from "./test-helpers/worker-runtime";
import {
  completeChannelReplyApplication,
} from "./worker-reply-completion-application";
import type {
  ChannelReplyCompletionInput,
} from "./worker-reply-completion-mappers";
import { requireWorkerProjectBinding } from "./worker-route-auth";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const otherProjectId = "20000000-0000-4000-8000-000000000002";
const deviceId = "30000000-0000-4000-8000-000000000001";
const projectWorkerId = "40000000-0000-4000-8000-000000000001";
const otherWorkerId = "40000000-0000-4000-8000-000000000002";
const channelId = "50000000-0000-4000-8000-000000000001";
const organizationAgentId = "60000000-0000-4000-8000-000000000001";
const ownerId = "delegation-owner";
const workerToken = "briar_worker_channel-delegation-test";
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const backlogEvent = (sourceKey: string): HuntEventInput => ({
  source: "issue",
  sourceKey,
  title: `Execute ${sourceKey}`,
  stage: "queued",
  status: "backlog",
  workflowStage: null,
  eventKey: `${sourceKey}:backlog`,
  occurredAt: new Date().toISOString(),
  actor: "channel-delegation-test",
  repository: "Briar",
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
  sourceCreatedAt: new Date().toISOString(),
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
});

describe("Organization Agent channel delegation", () => {
  const db = cloudflareEnv.DB;
  const archives = cloudflareEnv.ARCHIVES;
  let projectAgent: Awaited<ReturnType<typeof createProjectAgent>>;
  let otherProjectAgent: Awaited<ReturnType<typeof createProjectAgent>>;
  let organizationAgent: NonNullable<
    Awaited<ReturnType<typeof createOrganizationAgent>>
  >;

  beforeAll(async () => {
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Owner', 'delegation@example.com', 1, ?, ?)`,
      ).bind(ownerId, now, now),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Delegation Org', 'delegation-org', ?, ?)`,
      ).bind(organizationId, now, now),
    ]);
    await db.prepare(
      `insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values (?, ?, 'owner', ?, ?)`,
    ).bind(organizationId, ownerId, now, now).run();
    for (const [id, name] of [
      [projectId, "Briar"],
      [otherProjectId, "Other"],
    ]) {
      await db.prepare(
        `insert into briar_teams (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        ownerId,
        organizationId,
        name,
        id === projectId ? "a".repeat(64) : "c".repeat(64),
        now,
        now,
      ).run();
    }
    await db.batch([
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Delegation device', ?, 'online', ?, ?, ?)`,
      ).bind(deviceId, organizationId, ownerId, "b".repeat(64), now, now, now),
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at
         ) values (?, ?, ?)`,
      ).bind(deviceId, sha256(workerToken), now),
    ]);
    for (const [id, boundProjectId] of [
      [projectWorkerId, projectId],
      [otherWorkerId, otherProjectId],
    ]) {
      await db.prepare(
        `insert into briar_execution_workers (
           id, project_id, label, host_fingerprint, runtime_proto_json, state,
           accepting_work, readiness_state,
           last_heartbeat_at, created_at, updated_at, device_id
         ) values (?, ?, 'Delegation worker', ?, ?, 'online', 1, 'ready',
                   ?, ?, ?, ?)`,
      ).bind(
        id,
        boundProjectId,
        id === projectWorkerId ? "d".repeat(64) : "e".repeat(64),
        workerRuntimeProtoJsonFixture({
          agentProvider: "claude",
          providers: ["claude"],
        }),
        now,
        now,
        now,
        deviceId,
      ).run();
    }
    await createChannel(db, {
      id: channelId,
      organizationId,
      kind: "channel",
      dmKey: null,
      slug: "delegation",
      name: "Delegation",
      topic: null,
      visibility: "public",
      defaultProjectId: projectId,
      createdByUserId: ownerId,
      createdAt: now,
    });
    organizationAgent = (await createOrganizationAgent(db, {
      id: organizationAgentId,
      organizationId,
      name: "Organization Lead",
      provider: "claude",
      model: null,
      responsibility: "Coordinate project questions.",
      effort: null,
      createdAt: now,
    }))!;
    projectAgent = await createProjectAgent(db, projectId, {
      name: "Briar Guide",
      provider: "claude",
      model: null,
      effort: null,
      responsibility: "Answer repository questions for Briar.",
      calendarColor: "#6f5a7e",
      skills: [{
        name: "Repository questions",
        description: "Use for read-only repository questions.",
        body: "Inspect the repository and answer read-only questions.",
        provider: "claude",
        model: null,
        effort: null,
        kind: "custom",
        executionMode: "task",
        approvalPolicy: "explicit",
        position: 0,
      }],
    });
    otherProjectAgent = await createProjectAgent(db, otherProjectId, {
      name: "Other Guide",
      provider: "claude",
      model: null,
      effort: null,
      responsibility: "Answer questions for the other project.",
      calendarColor: "#6f5a7e",
    });
    await addChannelAgent(db, {
      channelId,
      agentId: organizationAgent.id,
      addedByUserId: ownerId,
      createdAt: now,
    });
    await addChannelAgent(db, {
      channelId,
      agentId: projectAgent.id,
      addedByUserId: ownerId,
      createdAt: now,
    });
  }, 60_000);

  const env = () => ({
    DB: db,
    ARCHIVES: archives,
    BETTER_AUTH_SECRET: "delegation-test-secret-delegation-test-secret",
    GOOGLE_CLIENT_ID: "google-client-test",
    GOOGLE_CLIENT_SECRET: "google-secret-test",
  }) as unknown as Env;

  type ChannelCompletion = Extract<
    ChannelReplyCompletionInput["outcome"],
    { case: "success" }
  >["completion"];
  type ChannelCompletionDraft = Pick<ChannelCompletion, "body"> &
    Partial<Omit<ChannelCompletion, "body">>;
  type ChannelCompletionCall = {
    readonly kind: "channel_completion";
    readonly jobId: string;
    readonly input: {
      organizationId: string;
      workerId: string;
      claimToken: string;
      conversationId?: string | null;
      result?: ChannelCompletionDraft | null;
      error?: string | null;
    };
  };

  const completionCall = (
    jobId: string,
    input: ChannelCompletionCall["input"],
  ): ChannelCompletionCall => ({ kind: "channel_completion", jobId, input });

  const invokeChannelCompletion = async (
    call: ChannelCompletionCall,
    runtimeEnv: Env,
  ) => {
    const job = await getChannelAgentReplyJob(
      db,
      call.input.organizationId,
      call.jobId,
    );
    const binding = await db.prepare(
      `select w.project_id, w.device_id, d.organization_id
       from briar_execution_workers w
       join briar_execution_worker_devices d on d.id = w.device_id
       where w.id = ?`,
    ).bind(call.input.workerId).first<{
      project_id: string;
      device_id: string;
      organization_id: string;
    }>();
    if (!job || !binding) {
      return Response.json({ message: "Reply claim was not found" }, {
        status: 409,
      });
    }
    const result = call.input.result;
    const outcome: ChannelReplyCompletionInput["outcome"] = call.input.error
      ? { case: "failure", error: call.input.error }
      : result
      ? {
          case: "success",
          completion: {
            body: result.body,
            document: result.document ?? null,
            issueProposal: result.issueProposal ?? null,
            issueBatchProposal: result.issueBatchProposal ?? null,
            executionProposal: result.executionProposal ?? null,
            skillExecutionProposal: result.skillExecutionProposal ?? null,
            delegation: result.delegation ?? null,
          },
        }
      : { case: "failure", error: "Reply result is required" };
    try {
      const result = await completeChannelReplyApplication({
        db,
        env: runtimeEnv,
        worker: {
          principal: {
            organizationId: binding.organization_id,
            deviceId: binding.device_id,
          },
          binding: {
            id: call.input.workerId,
            project_id: binding.project_id,
          },
        },
        request: {
          requestId: crypto.randomUUID(),
          projectId: binding.project_id,
          workerId: call.input.workerId,
          claim: {
            replyKind: "channel",
            organizationId: call.input.organizationId,
            workId: call.jobId,
            runId: job.channel_id,
            claimToken: call.input.claimToken,
          },
          attachmentIds: [],
          conversationId: call.input.conversationId ?? null,
          outcome,
        },
      });
      return Response.json(result);
    } catch (error) {
      try {
        rethrowReplyCompletionHttpError(error);
      } catch (mapped) {
        if (mapped instanceof HttpError) {
          return Response.json({ message: mapped.message }, {
            status: mapped.status,
          });
        }
        throw mapped;
      }
    }
  };

  const completionWorker = {
    execute: (
      input: ChannelCompletionCall,
      runtimeEnv: Env,
    ) => invokeChannelCompletion(input, runtimeEnv),
  };

  const queueOrganizationReply = async (body: string) => {
    const now = new Date().toISOString();
    const messageId = crypto.randomUUID();
    await createChannelMessage(db, {
      id: messageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body,
      mentionedUserIds: [],
      mentionedAgentIds: [organizationAgent.id],
      createdAt: now,
    });
    const jobs = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: messageId,
      parentMessageId: messageId,
      agents: [{
        id: organizationAgent.id,
        projectId: null,
        provider: "claude",
      }],
      createdAt: now,
    });
    return jobs.find((job) => job.agent_id === organizationAgent.id)!;
  };

  const claim = async (workerId: string) => {
    const authenticatedWorker = await requireWorkerProjectBinding(
      db,
      new Request("https://briar.example", {
        headers: { authorization: `Bearer ${workerToken}` },
      }),
      workerId === projectWorkerId ? projectId : otherProjectId,
      workerId,
    );
    const work = await claimNextChannelReplyWork({
      input: { organizationId, workerId },
      db,
      env: env(),
      authenticatedWorker,
    });
    return { work };
  };

  const queueDelegatedChild = async (request: string) => {
    const parent = await queueOrganizationReply(request);
    const parentClaim = await claim(otherWorkerId);
    expect(parentClaim.work).toMatchObject({ workId: parent.id });
    const response = await completionWorker.execute(
      completionCall(parent.id, {
        organizationId,
        workerId: otherWorkerId,
        claimToken: String(parentClaim.work?.claimToken),
        result: {
          body: "Delegating to the Project Agent.",
          document: null,
          issueProposal: null,
          delegation: { projectId, agentId: projectAgent.id, request },
        },
      }),
      env(),
    );
    expect(response.status).toBe(200);
    const jobs = await listChannelAgentReplies(
      db,
      channelId,
      parent.trigger_message_id,
    );
    return jobs.find((job) => job.agent_id === projectAgent.id)!;
  };

  it("atomically hands a repository question to the exact rostered Project Agent", async () => {
    const parent = await queueOrganizationReply(
      "@organization-lead Which module owns authentication in Briar?",
    );
    const parentClaim = await claim(otherWorkerId);
    expect(parentClaim.work).toMatchObject({
      workId: parent.id,
      projectId: null,
      delegation: null,
      delegationTargets: [{
        agentId: projectAgent.id,
        projectId,
        agentName: "Briar Guide",
        projectName: "Briar",
        skills: [{ name: "Repository questions" }],
      }],
    });
    const parentToken = String(parentClaim.work?.claimToken);
    const completed = await completionWorker.execute(
      completionCall(parent.id, {
        organizationId,
        workerId: otherWorkerId,
        claimToken: parentToken,
        result: {
          body: "Briar Guide에게 저장소 확인을 위임했습니다.",
          document: null,
          issueProposal: null,
          delegation: {
            projectId,
            agentId: projectAgent.id,
            request: "Repository questions: Which module owns authentication?",
          },
        },
      }),
      env(),
    );
    expect(completed.status).toBe(200);

    const jobs = await listChannelAgentReplies(
      db,
      channelId,
      parent.trigger_message_id,
    );
    const child = jobs.find((job) => job.agent_id === projectAgent.id)!;
    expect(child).toMatchObject({
      organization_id: organizationId,
      channel_id: channelId,
      project_id: projectId,
      skill_id: null,
      status: "queued",
      agent_provider: "claude",
      delegated_by_reply_job_id: parent.id,
      delegation_request:
        "Repository questions: Which module owns authentication?",
    });
    const memberFacingReply = channelReplyJson(child);
    expect(memberFacingReply).not.toHaveProperty("delegationRequest");
    expect(memberFacingReply).not.toHaveProperty("delegatedByReplyId");
    expect(JSON.stringify(memberFacingReply)).not.toContain(
      "Which module owns authentication",
    );

    await expect(claim(otherWorkerId)).resolves.toEqual({ work: null });
    const childClaim = await claim(projectWorkerId);
    expect(childClaim.work).toMatchObject({
      workId: child.id,
      projectId,
      delegationTargets: [],
      delegation: {
        delegatedByReplyId: parent.id,
        delegatedByAgentId: organizationAgent.id,
        delegatedByAgentName: organizationAgent.name,
        request: "Repository questions: Which module owns authentication?",
      },
    });
    const childToken = String(childClaim.work?.claimToken);

    const recursive = await completionWorker.execute(
      completionCall(child.id, {
        organizationId,
        workerId: projectWorkerId,
        claimToken: childToken,
        result: {
          body: "Trying to delegate again.",
          document: null,
          issueProposal: null,
          delegation: {
            projectId,
            agentId: projectAgent.id,
            request: "Delegate again.",
          },
        },
      }),
      env(),
    );
    expect(recursive.status).toBe(400);

    const childCompleted = await completionWorker.execute(
      completionCall(child.id, {
        organizationId,
        workerId: projectWorkerId,
        claimToken: childToken,
        result: {
          body: "Authentication is owned by src/auth.",
          document: null,
          issueProposal: null,
          delegation: null,
        },
      }),
      env(),
    );
    expect(childCompleted.status).toBe(200);
    await expect(
      getChannelMessage(db, channelId, child.reply_message_id),
    ).resolves.toMatchObject({
      author: { type: "agent", id: projectAgent.id, name: "Briar Guide" },
      body: "Authentication is owned by src/auth.",
    });
  });

  it("lets the delegated Project Agent discover from its full Skill roster", async () => {
    const request = "Repository questions: run the saved repository workflow.";
    const parent = await queueOrganizationReply(request);
    const parentClaim = await claim(otherWorkerId);
    expect(parentClaim.work).toMatchObject({
      workId: parent.id,
      projectId: null,
      skillExecutionTarget: null,
    });
    const parentClaimToken = String(parentClaim.work?.claimToken);

    const organizationAttempt = await completionWorker.execute(
      completionCall(parent.id, {
        organizationId,
        workerId: otherWorkerId,
        claimToken: parentClaimToken,
        result: {
          body: "Trying to run a Project Skill directly.",
          document: null,
          issueProposal: null,
          executionProposal: null,
          skillExecutionProposal: {
            type: "request_agent_skill_execute",
          },
          delegation: null,
        },
      }),
      env(),
    );
    expect(organizationAttempt.status).toBe(400);
    await expect(db.prepare(
      `select count(*) as count
       from briar_agent_skill_execution_proposals
       where source_reply_job_id = ?`,
    ).bind(parent.id).first()).resolves.toEqual({ count: 0 });
    await expect(
      getChannelMessage(db, channelId, parent.reply_message_id),
    ).resolves.toBeNull();

    const delegated = await completionWorker.execute(
      completionCall(parent.id, {
        organizationId,
        workerId: otherWorkerId,
        claimToken: parentClaimToken,
        result: {
          body: "Delegating the saved Skill request to Briar Guide.",
          document: null,
          issueProposal: null,
          executionProposal: null,
          skillExecutionProposal: null,
          delegation: { projectId, agentId: projectAgent.id, request },
        },
      }),
      env(),
    );
    expect(delegated.status).toBe(200);
    const replies = await listChannelAgentReplies(
      db,
      channelId,
      parent.trigger_message_id,
    );
    const child = replies.find((reply) => reply.agent_id === projectAgent.id)!;
    const childClaim = await claim(projectWorkerId);
    expect(childClaim.work).toMatchObject({
      workId: child.id,
      projectId,
      activeSkill: null,
      skillExecutionTarget: null,
      agent: {
        skills: [{
          id: projectAgent.skills[0].id,
          name: projectAgent.skills[0].name,
        }],
      },
      delegation: {
        delegatedByReplyId: parent.id,
        delegatedByAgentId: organizationAgent.id,
        delegatedByAgentName: organizationAgent.name,
        request,
      },
    });

    const childCompleted = await completionWorker.execute(
      completionCall(child.id, {
        organizationId,
        workerId: projectWorkerId,
        claimToken: String(childClaim.work?.claimToken),
        result: {
          body: "I discovered and followed the relevant saved Skill.",
          document: null,
          issueProposal: null,
          executionProposal: null,
          skillExecutionProposal: null,
          delegation: null,
        },
      }),
      env(),
    );
    expect(childCompleted.status).toBe(200);
    await expect(db.prepare(
      `select status, delegated_by_reply_job_id, delegated_by_agent_id,
              delegated_by_agent_name, requested_worker_id, result_session_id
       from briar_agent_skill_execution_proposals
       where source_reply_job_id = ?`,
    ).bind(child.id).first()).resolves.toBeNull();
  });

  it("requires Organization delegation and preserves it on a Project Agent execution card", async () => {
    const workflow = JSON.stringify({
      version: 2,
      requirements: [],
      stages: [{ id: "implementing", label: "Implement", required: true }],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing"] },
    });
    await db.prepare(
      `insert into briar_project_settings (
         project_id, workflow_json, mandatory_checkpoints_json,
         created_at, updated_at
       ) values (?, ?, '[]', ?, ?)
       on conflict (project_id) do update set workflow_json = excluded.workflow_json`,
    ).bind(projectId, workflow, new Date().toISOString(), new Date().toISOString())
      .run();
    const targetRunId = await recordHuntEvent(
      db,
      projectId,
      backlogEvent(`delegated-execution-${crypto.randomUUID()}`),
    );

    const direct = await queueOrganizationReply("Execute the Briar issue.");
    const directClaim = await claim(otherWorkerId);
    expect(directClaim.work).toMatchObject({ workId: direct.id, projectId: null });
    const rejected = await completionWorker.execute(
      completionCall(direct.id, {
        organizationId,
        workerId: otherWorkerId,
        claimToken: String(directClaim.work?.claimToken),
        result: {
          body: "Trying to execute directly.",
          document: null,
          issueProposal: null,
          executionProposal: { projectId, runId: targetRunId },
          delegation: null,
        },
      }),
      env(),
    );
    expect(rejected.status).toBe(400);
    const directFinished = await completionWorker.execute(
      completionCall(direct.id, {
        organizationId,
        workerId: otherWorkerId,
        claimToken: String(directClaim.work?.claimToken),
        result: {
          body: "Delegation is required.",
          document: null,
          issueProposal: null,
          executionProposal: null,
          delegation: null,
        },
      }),
      env(),
    );
    expect(directFinished.status).toBe(200);

    const child = await queueDelegatedChild(
      "Repository questions: execute the listed Briar issue.",
    );
    const childClaim = await claim(projectWorkerId);
    expect(childClaim.work).toMatchObject({
      workId: child.id,
      projectId,
      snapshot: {
        executionTargets: [expect.objectContaining({
          projectId,
          runId: targetRunId,
        })],
      },
    });
    const afterClaimAt = new Date(Date.now() + 5_000).toISOString();
    const lateTarget = backlogEvent(
      `late-delegated-execution-${crypto.randomUUID()}`,
    );
    const lateTargetRunId = await recordHuntEvent(db, projectId, {
      ...lateTarget,
      occurredAt: afterClaimAt,
      sourceCreatedAt: afterClaimAt,
    });
    const lateCompletion = await completionWorker.execute(
      completionCall(child.id, {
        organizationId,
        workerId: projectWorkerId,
        claimToken: String(childClaim.work?.claimToken),
        result: {
          body: "This target was not in the claim snapshot.",
          document: null,
          issueProposal: null,
          executionProposal: { projectId, runId: lateTargetRunId },
          delegation: null,
        },
      }),
      env(),
    );
    expect(lateCompletion.status).toBe(409);
    await expect(
      getChannelMessage(db, channelId, child.reply_message_id),
    ).resolves.toBeNull();
    const completed = await completionWorker.execute(
      completionCall(child.id, {
        organizationId,
        workerId: projectWorkerId,
        claimToken: String(childClaim.work?.claimToken),
        result: {
          body: "실행 전에 설정 승인이 필요합니다.",
          document: null,
          issueProposal: null,
          executionProposal: { projectId, runId: targetRunId },
          delegation: null,
        },
      }),
      env(),
    );
    expect(completed.status).toBe(200);
    await expect(db.prepare(
      `select proposed_by_agent_id, delegated_by_agent_id,
              delegated_by_agent_name, status, dispatch_request_id
       from briar_issue_execution_proposals where reply_message_id = ?`,
    ).bind(child.reply_message_id).first()).resolves.toEqual({
      proposed_by_agent_id: projectAgent.id,
      delegated_by_agent_id: organizationAgent.id,
      delegated_by_agent_name: organizationAgent.name,
      status: "pending",
      dispatch_request_id: null,
    });
  });

  it("does not expand a Project Agent execution allowlist when rank 101 later enters the top 100", async () => {
    const outsideTargetRunId = await recordHuntEvent(
      db,
      projectId,
      backlogEvent(`outside-snapshot-${crypto.randomUUID()}`),
    );
    const newerRunIds: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      newerRunIds.push(await recordHuntEvent(
        db,
        projectId,
        backlogEvent(`snapshot-decoy-${index}-${crypto.randomUUID()}`),
      ));
    }

    const child = await queueDelegatedChild(
      "Repository questions: execute the issue just outside the snapshot.",
    );
    const childClaim = await claim(projectWorkerId);
    expect(childClaim.work).toMatchObject({ workId: child.id, projectId });
    const executionTargets = (
      childClaim.work?.snapshot as {
        executionTargets: Array<{ runId: string }>;
      }
    ).executionTargets;
    expect(executionTargets).toHaveLength(100);
    expect(executionTargets.map((target) => target.runId))
      .not.toContain(outsideTargetRunId);

    // Removing one snapshotted run makes the old rank-101 run currently rank
    // 100, but it must remain unauthorized because it was never disclosed.
    await db.prepare(`delete from briar_hunt_runs where id = ?`)
      .bind(newerRunIds[0]).run();
    const currentRank = await db.prepare(
      `select 1 as present
       from briar_hunt_runs candidate
       where candidate.id = ? and candidate.project_id = ?
         and candidate.status = 'backlog' and candidate.stage = 'queued'
         and (
           select count(*) from briar_hunt_runs newer
           where newer.project_id = candidate.project_id
             and newer.run_number > candidate.run_number
             and newer.status = 'backlog' and newer.stage = 'queued'
             and newer.workflow_stage is null
             and newer.worker_id is null and newer.requested_worker_id is null
             and newer.claim_token_hash is null and newer.claimed_by is null
             and newer.claimed_at is null and newer.lease_expires_at is null
             and newer.last_execution_id is null
             and newer.dispatch_mode is null
             and newer.dispatch_request_id is null
             and newer.dispatched_at is null
             and newer.requested_by_user_id is null
             and newer.completed_at is null and newer.paused_at is null
             and newer.resume_requested_at is null
         ) < 100`,
    ).bind(outsideTargetRunId, projectId).first();
    expect(currentRank).toEqual({ present: 1 });

    const rejected = await completionWorker.execute(
      completionCall(child.id, {
        organizationId,
        workerId: projectWorkerId,
        claimToken: String(childClaim.work?.claimToken),
        result: {
          body: "The target is currently in the top 100.",
          document: null,
          issueProposal: null,
          executionProposal: { projectId, runId: outsideTargetRunId },
          delegation: null,
        },
      }),
      env(),
    );
    expect(rejected.status).toBe(409);
    await expect(db.prepare(
      `select count(*) as count from briar_issue_execution_proposals
       where reply_message_id = ?`,
    ).bind(child.reply_message_id).first()).resolves.toEqual({ count: 0 });

    const completed = await completionWorker.execute(
      completionCall(child.id, {
        organizationId,
        workerId: projectWorkerId,
        claimToken: String(childClaim.work?.claimToken),
        result: {
          body: "The requested issue was outside my execution snapshot.",
          document: null,
          issueProposal: null,
          executionProposal: null,
          delegation: null,
        },
      }),
      env(),
    );
    expect(completed.status).toBe(200);
  });

  it("snapshots and projects the exact execution allowlist in one D1 batch", async () => {
    await recordHuntEvent(
      db,
      projectId,
      backlogEvent(`atomic-snapshot-${crypto.randomUUID()}`),
    );
    const child = await queueDelegatedChild(
      "Repository questions: inspect the atomic execution snapshot.",
    );
    const childClaim = await claim(projectWorkerId);
    expect(childClaim.work).toMatchObject({ workId: child.id, projectId });

    const actualStatements = new WeakMap<object, D1PreparedStatement>();
    let batchCalls = 0;
    let standaloneExecutions = 0;
    const atomicOnlyDb = {
      prepare(query: string) {
        let actual = db.prepare(query);
        const rejectStandalone = () => {
          standaloneExecutions += 1;
          throw new Error("snapshot projection escaped its atomic D1 batch");
        };
        const wrapped = {
          bind(...values: Parameters<D1PreparedStatement["bind"]>) {
            actual = actual.bind(...values);
            actualStatements.set(wrapped, actual);
            return wrapped;
          },
          first: rejectStandalone,
          all: rejectStandalone,
          run: rejectStandalone,
          raw: rejectStandalone,
        };
        actualStatements.set(wrapped, actual);
        return wrapped;
      },
      batch(statements: object[]) {
        batchCalls += 1;
        return db.batch(statements.map((statement) => {
          const actual = actualStatements.get(statement);
          if (!actual) throw new Error("unknown wrapped D1 statement");
          return actual;
        }));
      },
    } as unknown as D1Database;

    const targets = await snapshotChannelReplyExecutionTargets(atomicOnlyDb, {
      jobId: child.id,
      deviceId,
      workerId: projectWorkerId,
      claimTokenHash: sha256(String(childClaim.work?.claimToken)),
      claimedAt: String(childClaim.work?.claimedAt),
    });
    expect(batchCalls).toBe(1);
    expect(standaloneExecutions).toBe(0);
    expect(targets?.length).toBeGreaterThan(0);
    const stored = await db.prepare(
      `select execution_target_ids_json
       from briar_channel_agent_reply_jobs where id = ?`,
    ).bind(child.id).first<{ execution_target_ids_json: string }>();
    expect(JSON.parse(stored!.execution_target_ids_json))
      .toEqual(targets!.map((target) => target.id));

    const completed = await completionWorker.execute(
      completionCall(child.id, {
        organizationId,
        workerId: projectWorkerId,
        claimToken: String(childClaim.work?.claimToken),
        result: {
          body: "The execution snapshot was captured atomically.",
          document: null,
          issueProposal: null,
          executionProposal: null,
          delegation: null,
        },
      }),
      env(),
    );
    expect(completed.status).toBe(200);
  });

  it("revalidates the roster atomically and never creates a child after revocation", async () => {
    const parent = await queueOrganizationReply("Inspect the Briar repository.");
    const parentClaim = await claim(otherWorkerId);
    expect(parentClaim.work).toMatchObject({ workId: parent.id });
    const parentToken = String(parentClaim.work?.claimToken);
    await removeChannelAgent(db, channelId, projectAgent.id);

    const claimed = await getChannelAgentReplyJob(db, organizationId, parent.id);
    const completed = await completeChannelReply(db, claimed!, {
      jobId: parent.id,
      deviceId,
      workerId: otherWorkerId,
      claimTokenHash: sha256(parentToken),
      body: "Delegating.",
      document: null,
      issueProposal: null,
      executionProposal: null,
      delegation: {
        projectId,
        agentId: projectAgent.id,
        skillId: projectAgent.skills[0].id,
        provider: "claude",
        request: "Inspect the repository.",
      },
      agentName: organizationAgent.name,
      agentProvider: "claude",
      completedAt: new Date().toISOString(),
    });
    expect(completed).toBeNull();
    expect(
      (await listChannelAgentReplies(db, channelId, parent.trigger_message_id))
        .filter((job) => job.agent_id === projectAgent.id),
    ).toHaveLength(0);
    await expect(
      getChannelMessage(db, channelId, parent.reply_message_id),
    ).resolves.toBeNull();

    await addChannelAgent(db, {
      channelId,
      agentId: projectAgent.id,
      addedByUserId: ownerId,
      createdAt: new Date().toISOString(),
    });
    await expect(
      completeChannelReply(db, claimed!, {
        jobId: parent.id,
        deviceId,
        workerId: otherWorkerId,
        claimTokenHash: sha256(parentToken),
        body: "The target was removed, so I did not delegate.",
        document: null,
        issueProposal: null,
        executionProposal: null,
        delegation: null,
        agentName: organizationAgent.name,
        agentProvider: "claude",
        completedAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("does not pin a delegated discovery turn to a Skill deleted before claim", async () => {
    const skill = await db.prepare(
      `select * from briar_agent_skills where id = ?`,
    ).bind(projectAgent.skills[0].id).first<{
      id: string;
      agent_id: string;
      name: string;
      description: string;
      body: string;
      provider: string;
      model: string | null;
      effort: string | null;
      kind: string;
      is_default: number;
      position: number;
      created_at: string;
      updated_at: string;
    }>();
    const child = await queueDelegatedChild(
      "Repository questions: inspect the authentication module.",
    );
    expect(child).toMatchObject({
      skill_id: null,
      selected_skill_id_snapshot: null,
      agent_provider: "claude",
    });

    await db.prepare(`delete from briar_agent_skills where id = ?`)
      .bind(skill!.id).run();
    const childClaim = await claim(projectWorkerId);
    expect(childClaim.work).toMatchObject({
      workId: child.id,
      provider: "claude",
      activeSkill: null,
      agent: { skills: [] },
    });
    const completed = await completionWorker.execute(
      completionCall(child.id, {
        organizationId,
        workerId: projectWorkerId,
        claimToken: String(childClaim.work?.claimToken),
        result: {
          body: "The saved Skill was removed before this turn.",
          document: null,
          issueProposal: null,
          executionProposal: null,
          skillExecutionProposal: null,
          delegation: null,
        },
      }),
      env(),
    );
    expect(completed.status).toBe(200);

    await db.prepare(
      `insert into briar_agent_skills (
         id, agent_id, name, description, body, provider, model, effort, kind,
         is_default, position, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      skill!.id,
      skill!.agent_id,
      skill!.name,
      skill!.description,
      skill!.body,
      skill!.provider,
      skill!.model,
      skill!.effort,
      skill!.kind,
      skill!.is_default,
      skill!.position,
      skill!.created_at,
      skill!.updated_at,
    ).run();
  });

  it("uses the Agent runtime when a discoverable Skill provider changes", async () => {
    const child = await queueDelegatedChild(
      "Repository questions: inspect the authorization module.",
    );
    expect(child).toMatchObject({
      skill_id: null,
      selected_skill_id_snapshot: null,
      agent_provider: "claude",
    });

    await db.prepare(
      `update briar_agent_skills set provider = 'codex', updated_at = ?
       where id = ?`,
    ).bind(new Date().toISOString(), projectAgent.skills[0].id).run();
    const childClaim = await claim(projectWorkerId);
    expect(childClaim.work).toMatchObject({
      workId: child.id,
      provider: "claude",
      activeSkill: null,
      agent: {
        skills: [{ id: projectAgent.skills[0].id, provider: "codex" }],
      },
    });
    const completed = await completionWorker.execute(
      completionCall(child.id, {
        organizationId,
        workerId: projectWorkerId,
        claimToken: String(childClaim.work?.claimToken),
        result: {
          body: "I discovered the Skill while using the Agent runtime.",
          document: null,
          issueProposal: null,
          executionProposal: null,
          skillExecutionProposal: null,
          delegation: null,
        },
      }),
      env(),
    );
    expect(completed.status).toBe(200);
    await db.prepare(
      `update briar_agent_skills set provider = 'claude', updated_at = ?
       where id = ?`,
    ).bind(new Date().toISOString(), projectAgent.skills[0].id).run();
  });

  it("rejects non-roster and project-mismatched targets before completion", async () => {
    const parent = await queueOrganizationReply("Inspect the other project.");
    const parentClaim = await claim(otherWorkerId);
    const parentToken = String(parentClaim.work?.claimToken);
    for (const delegation of [
      {
        projectId: otherProjectId,
        agentId: otherProjectAgent.id,
        request: "Inspect the other project.",
      },
      {
        projectId: otherProjectId,
        agentId: projectAgent.id,
        request: "Cross the project boundary.",
      },
    ]) {
      const response = await completionWorker.execute(
        completionCall(parent.id, {
          organizationId,
          workerId: otherWorkerId,
          claimToken: parentToken,
          result: {
            body: "Delegating.",
            document: null,
            issueProposal: null,
            delegation,
          },
        }),
        env(),
      );
      expect(response.status).toBe(400);
    }
    const ordinary = await completionWorker.execute(
      completionCall(parent.id, {
        organizationId,
        workerId: otherWorkerId,
        claimToken: parentToken,
        result: {
          body: "No eligible Project Agent is in the channel.",
          document: null,
          issueProposal: null,
          delegation: null,
        },
      }),
      env(),
    );
    expect(ordinary.status).toBe(200);
  });

  it("revokes a claimed Organization Agent before it can create a delegated child", async () => {
    const parent = await queueOrganizationReply("Inspect Briar after removal.");
    const parentClaim = await claim(otherWorkerId);
    const parentToken = String(parentClaim.work?.claimToken);

    await removeChannelAgent(db, channelId, organizationAgent.id);
    const completion = await completionWorker.execute(
      completionCall(parent.id, {
        organizationId,
        workerId: otherWorkerId,
        claimToken: parentToken,
        result: {
          body: "Delegating after removal.",
          document: null,
          issueProposal: null,
          delegation: {
            projectId,
            agentId: projectAgent.id,
            request: "Inspect Briar after removal.",
          },
        },
      }),
      env(),
    );
    expect(completion.status).toBe(409);
    await expect(
      getChannelAgentReplyJob(db, organizationId, parent.id),
    ).resolves.toMatchObject({
      status: "failed",
      claimed_device_id: null,
      claimed_worker_id: null,
      claim_token_hash: null,
      error: "Agent was removed from the channel.",
    });
    expect(
      (await listChannelAgentReplies(db, channelId, parent.trigger_message_id))
        .filter((job) => job.agent_id === projectAgent.id),
    ).toHaveLength(0);

    await addChannelAgent(db, {
      channelId,
      agentId: organizationAgent.id,
      addedByUserId: ownerId,
      createdAt: new Date().toISOString(),
    });
  });

  it("fails a delegated child when its roster authorization is removed", async () => {
    const parent = await queueOrganizationReply("Inspect Briar again.");
    const parentClaim = await claim(otherWorkerId);
    const parentToken = String(parentClaim.work?.claimToken);
    const completed = await completionWorker.execute(
      completionCall(parent.id, {
        organizationId,
        workerId: otherWorkerId,
        claimToken: parentToken,
        result: {
          body: "Delegating.",
          document: null,
          issueProposal: null,
          delegation: {
            projectId,
            agentId: projectAgent.id,
            request: "Inspect Briar again.",
          },
        },
      }),
      env(),
    );
    expect(completed.status).toBe(200);
    const jobs = await listChannelAgentReplies(
      db,
      channelId,
      parent.trigger_message_id,
    );
    const child = jobs.find((job) => job.agent_id === projectAgent.id)!;
    expect(child.status).toBe("queued");

    await removeChannelAgent(db, channelId, projectAgent.id);
    await expect(
      getChannelAgentReplyJob(db, organizationId, child.id),
    ).resolves.toMatchObject({
      status: "failed",
      claimed_device_id: null,
      claimed_worker_id: null,
      claim_token_hash: null,
      error: "Agent was removed from the channel.",
    });
    await expect(claim(projectWorkerId)).resolves.toEqual({ work: null });
    await addChannelAgent(db, {
      channelId,
      agentId: projectAgent.id,
      addedByUserId: ownerId,
      createdAt: new Date().toISOString(),
    });
  });

  it("does not enqueue a stale reply after the Agent leaves the channel", async () => {
    await removeChannelAgent(db, channelId, projectAgent.id);
    const createdAt = new Date().toISOString();
    const messageId = crypto.randomUUID();
    await createChannelMessage(db, {
      id: messageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@briar-guide inspect after removal",
      mentionedUserIds: [],
      mentionedAgentIds: [projectAgent.id],
      createdAt,
    });
    await expect(
      enqueueChannelAgentReplies(db, {
        organizationId,
        channelId,
        triggerMessageId: messageId,
        parentMessageId: messageId,
        agents: [{
          id: projectAgent.id,
          projectId,
          provider: "claude",
        }],
        createdAt,
      }),
    ).resolves.toEqual([]);

    await addChannelAgent(db, {
      channelId,
      agentId: projectAgent.id,
      addedByUserId: ownerId,
      createdAt: new Date().toISOString(),
    });
    await expect(
      listChannelAgentReplies(db, channelId, messageId),
    ).resolves.toEqual([]);
    await expect(claim(projectWorkerId)).resolves.toEqual({ work: null });
  });

  it("requires the claim token header for delegated attachment reads", async () => {
    // Keep the public protocol constant covered so future attachment tests do
    // not accidentally send the Worker bearer token as the claim authority.
    expect(channelReplyClaimTokenHeader).toBe("X-Briar-Channel-Claim-Token");
  });
});
