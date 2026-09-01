import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addChannelAgent,
  claimNextChannelAgentReply,
  completeChannelReply,
  createChannel,
  createChannelMessage,
  enqueueChannelAgentReplies,
  getChannelMessage,
  type ChannelReplyJobRow,
} from "./channels";
import {
  acceptAgentSkillExecutionProposal,
  claimNextIssueAgentReply,
  claimNextProjectAgentTask,
  completeIssueAgentReplyOutput,
  completeProjectAgentTask,
  completeProjectAgentTaskWithReceipt,
  createIssueMessage,
  createProjectAgent,
  enqueueIssueAgentReply,
  getProjectAgentSession,
  listChannelConversationNotifications,
  listIssueAgentSkillExecutionProposals,
  listProjectAgentSessionSummaries,
  reapProjectAgentTaskJobs,
  recordHuntEvent,
  type AgentSkillExecutionProposalRow,
  type HuntEventInput,
} from "./db";
import { archiveCompletedLogs, type ArchiveBucket } from "./archive";
import apiWorker from "./index";
import { flushAgentSkillExecutionRealtimeOutbox } from "./realtime-scheduling";
import { createIsolatedTestDatabase } from "./test-helpers/d1";
import {
  bindExecutionWorkerProject,
  countExecutionWorkerDeviceSessions,
  disableExecutionWorker,
  dispatchHuntRun,
  registerExecutionWorker,
  updateProjectExecutionWorkerPolicy,
} from "./workers";

const organizationId = "91000000-0000-4000-8000-000000000001";
const projectId = "92000000-0000-4000-8000-000000000001";
const channelId = "93000000-0000-4000-8000-000000000001";
const ownerId = "skill-approval-owner";
const memberId = "skill-approval-member";
const ownerToken = "skill-approval-owner-token";
const memberToken = "skill-approval-member-token";
const workerId = "94000000-0000-4000-8000-000000000001";
const workerDeviceId = "95000000-0000-4000-8000-000000000001";
const otherWorkerId = "94000000-0000-4000-8000-000000000002";
const otherWorkerDeviceId = "95000000-0000-4000-8000-000000000002";
const nonMemberOwnerId = "skill-approval-non-member";
const nonMemberWorkerId = "94000000-0000-4000-8000-000000000003";
const nonMemberWorkerDeviceId = "95000000-0000-4000-8000-000000000003";
const staleBootstrapProjectId = "92000000-0000-4000-8000-000000000002";
const staleBootstrapWorkerId = "94000000-0000-4000-8000-000000000004";
const staleDeviceWorkerId = "94000000-0000-4000-8000-000000000005";
const staleWorkerDeviceId = "95000000-0000-4000-8000-000000000004";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const providerCapabilities = {
  codex: {
    models: [{
      id: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      efforts: [{ id: "high", label: "High" }],
    }],
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

const backlogEvent = (
  sourceKey: string,
  title: string,
  occurredAt: string,
): HuntEventInput => ({
  source: "issue",
  sourceKey,
  title,
  stage: "queued",
  status: "backlog",
  workflowStage: null,
  eventKey: `${sourceKey}:backlog`,
  occurredAt,
  actor: "agent-skill-execution-approval-test",
  repository: "Skill approval project",
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

describe("conversational Agent Skill execution approval", () => {
  let miniflare: Miniflare;
  let db: D1Database;
  let archives: ArchiveBucket;
  let sequence = 0;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "agent-skill-execution-approval",
      miniflareOptions: {
        modules: true,
        script: "export default { fetch() { return new Response('ok') } }",
        r2Buckets: ["ARCHIVES"],
      },
    });
    miniflare = database.miniflare;
    db = database.db;
    const miniflareBucket = await miniflare.getR2Bucket("ARCHIVES");
    archives = {
      async head(key) {
        const object = await miniflareBucket.head(key);
        if (!object) return null;
        return {
          size: object.size,
          checksums: {
            sha256: object.checksums.sha256
              ? new Uint8Array(object.checksums.sha256).slice().buffer
              : undefined,
          },
          customMetadata: object.customMetadata,
        };
      },
      async get(key) {
        const object = await miniflareBucket.get(key);
        if (!object) return null;
        const bytes = await object.arrayBuffer();
        return {
          size: object.size,
          checksums: {
            sha256: object.checksums.sha256
              ? new Uint8Array(object.checksums.sha256).slice().buffer
              : undefined,
          },
          customMetadata: object.customMetadata,
          body: new Blob([bytes]).stream(),
        };
      },
      async put(key, value, options) {
        return miniflareBucket.put(key, value, options);
      },
      async delete(keys) {
        await miniflareBucket.delete(keys);
      },
    };
    const observedAt = new Date().toISOString();
    for (const [id, name, token] of [
      [ownerId, "Owner", ownerToken],
      [memberId, "Member", memberToken],
      [nonMemberOwnerId, "Non-member", "skill-approval-non-member-token"],
    ]) {
      await db.batch([
        db.prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
        ).bind(id, name, `${id}@example.com`, observedAt, observedAt),
        db.prepare(
          `insert into "session" (
             id, expiresAt, token, createdAt, updatedAt, userId
           ) values (?, '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
        ).bind(`session-${id}`, token, observedAt, observedAt, id),
      ]);
    }
    await db.batch([
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Skill approval org', 'skill-approval-org', ?, ?)`,
      ).bind(organizationId, observedAt, observedAt),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, observedAt, observedAt),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'developer', ?, ?)`,
      ).bind(organizationId, memberId, observedAt, observedAt),
      db.prepare(
        `insert into briar_teams (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Skill approval project', ?, ?, ?)`,
      ).bind(
        projectId,
        ownerId,
        organizationId,
        "a".repeat(64),
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_project_members (
           project_id, organization_id, user_id, created_at, updated_at
         ) values (?, ?, ?, ?, ?)`,
      ).bind(
        projectId,
        organizationId,
        memberId,
        observedAt,
        observedAt,
      ),
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
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_teams (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Stale device bootstrap', ?, ?, ?)`,
      ).bind(
        staleBootstrapProjectId,
        ownerId,
        organizationId,
        "b".repeat(64),
        observedAt,
        observedAt,
      ),
    ]);
    for (const [id, deviceId, suffix, workerOwnerId] of [
      [workerId, workerDeviceId, "one", ownerId],
      [otherWorkerId, otherWorkerDeviceId, "two", ownerId],
      [
        nonMemberWorkerId,
        nonMemberWorkerDeviceId,
        "non-member",
        nonMemberOwnerId,
      ],
    ]) {
      await registerExecutionWorker(db, projectId, {
        id,
        deviceId,
        organizationId,
        ownerUserId: workerOwnerId,
        label: `Skill Worker ${suffix}`,
        deviceIdentityHash: sha256(`skill-device-${suffix}`),
        credentialTokenHash: sha256(`briar_worker_skill_credential_${suffix}`),
        agentProvider: "codex",
        providers: ["codex"],
        providerHealth: {
          codex: { installed: true, authenticated: true, healthy: true },
        },
        providerCapabilities,
        versions: { briar: "1.0.0" },
        maxConcurrentSessions: 4,
        observedAt,
      });
    }
    const staleObservedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    await registerExecutionWorker(db, staleBootstrapProjectId, {
      id: staleBootstrapWorkerId,
      deviceId: staleWorkerDeviceId,
      organizationId,
      ownerUserId: ownerId,
      label: "Stale device Worker",
      deviceIdentityHash: sha256("skill-device-stale"),
      credentialTokenHash: sha256("skill-credential-stale"),
      agentProvider: "codex",
      providers: ["codex"],
      providerHealth: {
        codex: { installed: true, authenticated: true, healthy: true },
      },
      versions: { briar: "1.0.0" },
      maxConcurrentSessions: 4,
      observedAt: staleObservedAt,
    });
    await bindExecutionWorkerProject(db, projectId, {
      id: staleDeviceWorkerId,
      organizationId,
      ownerUserId: ownerId,
      deviceIdentityHash: sha256("skill-device-stale"),
      agentProvider: "codex",
      providers: ["codex"],
      providerHealth: {
        codex: { installed: true, authenticated: true, healthy: true },
      },
      versions: { briar: "1.0.0" },
      observedAt,
    });
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "skill-approval",
      name: "Skill approval",
      topic: null,
      visibility: "public",
      defaultProjectId: projectId,
      createdByUserId: ownerId,
      createdAt: observedAt,
    });
  }, 60_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  const env = () => ({
    DB: db,
    ARCHIVES: archives,
    BETTER_AUTH_SECRET: "skill-approval-secret".repeat(2),
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
  }) as unknown as Env;

  const nextId = (prefix: number) => {
    sequence += 1;
    return `${prefix.toString(16).padStart(8, "0")}-0000-4000-8000-${sequence
      .toString(16).padStart(12, "0")}`;
  };

  const createAgent = async (
    kind: "issue_processing" | "custom" = "custom",
    executionMode: "conversation" | "task" = "task",
    approvalPolicy: "invoke_is_consent" | "explicit" = "explicit",
    skillRuntime: {
      provider: "codex" | "claude";
      model: string;
      effort: "high" | "medium";
    } = {
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    },
  ) => createProjectAgent(db, projectId, {
    name: `Release Agent ${sequence + 1}`,
    provider: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
    responsibility: "Run the selected release Skill.",
    calendarColor: "#6f5a7e",
    skills: [{
      name: kind === "custom" ? "iOS deployment" : "Issue processing",
      description: "Use for the approved release workflow.",
      body: "Execute the exact approved release workflow.",
      provider: skillRuntime.provider,
      model: skillRuntime.model,
      effort: skillRuntime.effort,
      kind,
      executionMode,
      approvalPolicy,
      position: 0,
    }],
  });

  const seedIssueProposal = async (
    kind: "issue_processing" | "custom" = "custom",
    approvalPolicy: "invoke_is_consent" | "explicit" = "explicit",
  ) => {
    const agent = await createAgent(kind, "task", approvalPolicy);
    const observedAt = new Date().toISOString();
    const request = `Run ${agent.skills[0].name} for request ${sequence + 1}.`;
    const runId = await recordHuntEvent(
      db,
      projectId,
      backlogEvent(`skill-${sequence + 1}`, request, observedAt),
    );
    await db.prepare(
      `update briar_hunt_runs set agent_id = ?, updated_at = ? where id = ?`,
    ).bind(agent.id, observedAt, runId).run();
    const triggerMessageId = nextId(0xa1000000);
    const replyMessageId = nextId(0xa2000000);
    const jobId = nextId(0xa3000000);
    await createIssueMessage(db, {
      id: triggerMessageId,
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentProvider: null,
      body: request,
      createdAt: observedAt,
    });
    await enqueueIssueAgentReply(db, {
      id: jobId,
      projectId,
      runId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      replyMessageId,
      skillId: agent.skills[0].id,
      createdAt: observedAt,
    });
    const claimHash = sha256(`issue-reply-${jobId}`);
    const claimedAt = new Date().toISOString();
    const claimed = await claimNextIssueAgentReply(db, projectId, {
      workerId,
      agentProvider: "codex",
      agentProviders: ["codex"],
      claimTokenHash: claimHash,
      claimedAt,
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      staleBefore: new Date(Date.now() - 300_000).toISOString(),
    });
    expect(claimed?.id).toBe(jobId);
    const completedAt = new Date().toISOString();
    expect(await completeIssueAgentReplyOutput(db, projectId, jobId, {
      workerId,
      claimTokenHash: claimHash,
      completedAt,
      output: {
        body: "The saved Skill requires explicit approval.",
        proposedAction: null,
        executionProposal: false,
        skillExecutionProposal: true,
      },
    })).not.toBeNull();
    const proposals = await listIssueAgentSkillExecutionProposals(
      db,
      projectId,
      runId,
    );
    expect(proposals).toHaveLength(1);
    return { agent, runId, proposal: proposals[0], request };
  };

  const acceptIssue = (
    runId: string,
    proposalId: string,
    token = ownerToken,
    selectedWorkerId = workerId,
  ) => apiWorker.fetch(new Request(
    `https://briar.example/projects/${projectId}/runs/${runId}` +
      `/skill-execution-proposals/${proposalId}/accept`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workerId: selectedWorkerId }),
    },
  ), env());

  const seedChannelProposal = async () => {
    const agent = await createAgent();
    await addChannelAgent(db, {
      channelId,
      agentId: agent.id,
      addedByUserId: ownerId,
      createdAt: new Date().toISOString(),
    });
    const request = `Run the channel Skill for request ${sequence + 1}.`;
    const triggerMessageId = nextId(0xb3000000);
    await createChannelMessage(db, {
      id: triggerMessageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: request,
      mentionedUserIds: [],
      mentionedAgentIds: [agent.id],
      createdAt: new Date().toISOString(),
    });
    const [queued] = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      agents: [{
        id: agent.id,
        projectId,
        skillId: agent.skills[0].id,
        provider: "codex",
      }],
      createdAt: new Date().toISOString(),
    });
    const claimHash = sha256(`channel-reply-${queued.id}`);
    const claimed = await claimNextChannelAgentReply(db, organizationId, {
      deviceId: workerDeviceId,
      workerId,
      providers: ["codex"],
      supportsOrganizationAgentContext: true,
      claimTokenHash: claimHash,
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    expect(claimed?.id).toBe(queued.id);
    expect(await completeChannelReply(db, claimed!, {
      jobId: claimed!.id,
      deviceId: workerDeviceId,
      workerId,
      claimTokenHash: claimHash,
      body: "The saved Skill requires explicit approval.",
      document: null,
      issueProposal: null,
      executionProposal: null,
      skillExecutionProposal: true,
      delegation: null,
      agentName: agent.name,
      agentProvider: "codex",
      completedAt: new Date().toISOString(),
    })).not.toBeNull();
    const proposal = await db.prepare(
      `select * from briar_agent_skill_execution_proposals
       where source_kind = 'channel' and source_reply_job_id = ?`,
    ).bind(queued.id).first<AgentSkillExecutionProposalRow>();
    expect(proposal?.status).toBe("pending");
    return { agent, proposal: proposal!, triggerMessageId };
  };

  const acceptChannel = (proposalId: string) => apiWorker.fetch(new Request(
    `https://briar.example/organizations/${organizationId}/channels/${channelId}` +
      `/skill-execution-proposals/${proposalId}/accept`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workerId }),
    },
  ), env());

  const completeTask = (
    taskId: string,
    claimToken: string,
    payload: { summary: string; conversationId?: string | null } |
      { error: string },
    selectedWorkerId = workerId,
    credential = "briar_worker_skill_credential_one",
  ) => apiWorker.fetch(new Request(
    `https://briar.example/agent-task-claims/${taskId}/complete`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        workerId: selectedWorkerId,
        claimToken,
        ...payload,
      }),
    },
  ), env());

  const claimTask = () => apiWorker.fetch(new Request(
    "https://briar.example/agent-task-claims",
    {
      method: "POST",
      headers: {
        authorization: "Bearer briar_worker_skill_credential_one",
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId, workerId }),
    },
  ), env());

  const tableCount = async (table: string) => {
    const row = await db.prepare(`select count(*) as count from ${table}`)
      .first<{ count: number }>();
    return row?.count ?? 0;
  };

  it("materializes one exact issue task/session/audit only after approval", async () => {
    const seeded = await seedIssueProposal("issue_processing");
    const before = {
      tasks: await tableCount("briar_project_agent_task_jobs"),
      sessions: await tableCount("briar_project_agent_sessions"),
      audits: await tableCount("briar_agent_skill_execution_approval_audit"),
    };
    expect(before).toEqual({ tasks: 0, sessions: 0, audits: 0 });

    const unauthorizedWorker = await acceptIssue(
      seeded.runId,
      seeded.proposal.id,
      ownerToken,
      nonMemberWorkerId,
    );
    expect(unauthorizedWorker.status).toBe(409);
    expect(await unauthorizedWorker.json()).toMatchObject({
      code: "ISSUE_SKILL_EXECUTION_PROPOSAL_CONFLICT",
      message: "Worker owner is not a member of this organization",
    });
    expect({
      tasks: await tableCount("briar_project_agent_task_jobs"),
      sessions: await tableCount("briar_project_agent_sessions"),
      audits: await tableCount("briar_agent_skill_execution_approval_audit"),
    }).toEqual(before);
    await expect(acceptAgentSkillExecutionProposal(db, {
      proposalId: seeded.proposal.id,
      sourceKind: "issue",
      organizationId,
      projectId,
      channelId: null,
      conversationRunId: seeded.runId,
      userId: ownerId,
      workerId: nonMemberWorkerId,
      workerLabel: "Skill Worker non-member",
      resultSessionId: crypto.randomUUID(),
      acceptedAt: new Date().toISOString(),
    })).rejects.toThrow(/proposal is stale/u);

    const staleDeviceWorker = await acceptIssue(
      seeded.runId,
      seeded.proposal.id,
      ownerToken,
      staleDeviceWorkerId,
    );
    expect(staleDeviceWorker.status).toBe(409);
    expect(await staleDeviceWorker.json()).toMatchObject({
      code: "ISSUE_SKILL_EXECUTION_PROPOSAL_CONFLICT",
      message: "Worker device is not online",
    });
    await expect(acceptAgentSkillExecutionProposal(db, {
      proposalId: seeded.proposal.id,
      sourceKind: "issue",
      organizationId,
      projectId,
      channelId: null,
      conversationRunId: seeded.runId,
      userId: ownerId,
      workerId: staleDeviceWorkerId,
      workerLabel: "Stale device Worker",
      resultSessionId: crypto.randomUUID(),
      acceptedAt: new Date().toISOString(),
    })).rejects.toThrow(/proposal is stale/u);
    expect({
      tasks: await tableCount("briar_project_agent_task_jobs"),
      sessions: await tableCount("briar_project_agent_sessions"),
      audits: await tableCount("briar_agent_skill_execution_approval_audit"),
    }).toEqual(before);

    const whitespace = await acceptIssue(
      seeded.runId,
      seeded.proposal.id,
      ownerToken,
      ` ${workerId}`,
    );
    expect(whitespace.status).toBe(400);
    expect(await tableCount("briar_project_agent_task_jobs")).toBe(0);

    const accepted = await acceptIssue(seeded.runId, seeded.proposal.id);
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json() as {
      outcome: string;
      proposal: { resultSessionId: string; requestedWorkerId: string };
      session: Record<string, unknown>;
    };
    expect(acceptedBody).toMatchObject({
      outcome: "accepted",
      proposal: { requestedWorkerId: workerId },
      session: {
        id: acceptedBody.proposal.resultSessionId,
        projectId,
        agentId: seeded.agent.id,
        agentName: seeded.agent.name,
        skillId: seeded.agent.skills[0].id,
        request: seeded.request,
        sessionType: "task",
        trigger: "manual",
        requestedWorkerId: workerId,
        workerId,
        requestedByUserId: ownerId,
      },
    });
    expect(await tableCount("briar_project_agent_task_jobs")).toBe(1);
    expect(await tableCount("briar_project_agent_sessions")).toBe(1);
    expect(await tableCount("briar_agent_skill_execution_approval_audit")).toBe(1);

    const retry = await acceptIssue(seeded.runId, seeded.proposal.id);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ outcome: "already_accepted" });
    expect((await acceptIssue(
      seeded.runId,
      seeded.proposal.id,
      memberToken,
    )).status).toBe(409);
    expect((await acceptIssue(
      seeded.runId,
      seeded.proposal.id,
      ownerToken,
      otherWorkerId,
    )).status).toBe(409);

    const wrongWorkerClaim = await claimNextProjectAgentTask(db, projectId, {
      workerId: otherWorkerId,
      agentProviders: ["codex"],
      claimTokenHash: sha256("wrong-worker-claim"),
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    expect(wrongWorkerClaim).toBeNull();
    await expect(db.prepare(
      `update briar_project_agent_task_jobs
       set status = 'running', claimed_worker_id = ?, claim_token_hash = ?,
           claimed_at = ?, lease_expires_at = ?, attempts = attempts + 1
       where id = ?`,
    ).bind(
      otherWorkerId,
      sha256("forged-worker-claim"),
      new Date().toISOString(),
      new Date(Date.now() + 300_000).toISOString(),
      acceptedBody.proposal.resultSessionId,
    ).run()).rejects.toThrow(/approval audit is missing or stale/u);

    const claimToken = "briar_agent_task_claim_approved_task";
    const claimHash = sha256(claimToken);
    const claimed = await claimNextProjectAgentTask(db, projectId, {
      workerId,
      agentProviders: ["codex"],
      claimTokenHash: claimHash,
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    expect(claimed).toMatchObject({
      id: acceptedBody.proposal.resultSessionId,
      agent_name: seeded.agent.name,
      selected_skill_id: seeded.agent.skills[0].id,
      selected_skill_name: seeded.agent.skills[0].name,
      agent_skills: [{ kind: "issue_processing" }],
    });
    const completionPayload = {
      summary: "Release workflow completed.",
      conversationId: "conversation-approved-task",
    };
    const completedResponse = await completeTask(
      claimed!.id,
      claimToken,
      completionPayload,
    );
    expect(completedResponse.status).toBe(200);
    const completedBody = await completedResponse.json();
    const session = await getProjectAgentSession(db, projectId, claimed!.id);
    expect(session).toMatchObject({
      status: "completed",
      requested_by_user_id: ownerId,
    });
    expect(JSON.parse(session!.payload_json)).toMatchObject({
      status: "completed",
      summary: "Release workflow completed.",
      conversationId: "conversation-approved-task",
      workerId,
      requestedByUserId: ownerId,
    });
    expect(completedBody).toMatchObject({
      session: {
        id: claimed!.id,
        status: "completed",
        summary: completionPayload.summary,
        conversationId: completionPayload.conversationId,
        workerId,
        requestedByUserId: ownerId,
      },
    });
    const publishedIssueResult = await db.prepare(
      `select proposal.result_message_id, message.body
       from briar_agent_skill_execution_proposals proposal
       join briar_issue_messages message
         on message.id = proposal.result_message_id
        and message.run_id = proposal.conversation_run_id
       where proposal.id = ?`,
    ).bind(seeded.proposal.id).first<{
      result_message_id: string;
      body: string;
    }>();
    expect(publishedIssueResult?.body).toContain(completionPayload.summary);
    expect(publishedIssueResult?.body).toContain("briar-companion://sessions/");
    const hotReplay = await completeTask(
      claimed!.id,
      claimToken,
      completionPayload,
    );
    expect(hotReplay.status).toBe(200);
    expect(await hotReplay.json()).toEqual(completedBody);
    expect((await completeTask(claimed!.id, claimToken, {
      ...completionPayload,
      summary: "Different terminal payload.",
    })).status).toBe(409);
    expect((await completeTask(
      claimed!.id,
      "briar_agent_task_claim_wrong_token",
      completionPayload,
    )).status).toBe(409);
    expect((await completeTask(
      claimed!.id,
      claimToken,
      completionPayload,
      otherWorkerId,
      "briar_worker_skill_credential_two",
    )).status).toBe(409);
    expect(await db.prepare(
      `select count(*) as count
       from briar_project_agent_task_completion_receipts
       where project_id = ? and task_id = ?`,
    ).bind(projectId, claimed!.id).first()).toEqual({ count: 1 });

    const put = await apiWorker.fetch(new Request(
      `https://briar.example/projects/${projectId}/agent-sessions/${claimed!.id}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    ), env());
    expect(put.status).toBe(409);

    const archive = await archiveCompletedLogs(
      db,
      archives,
      new Date(Date.now() + 31 * 86_400_000).toISOString(),
      { maxObjects: 24 },
    );
    expect(archive.failures).toEqual([]);
    expect(archive.completedObjects).toBeGreaterThan(0);
    expect(await getProjectAgentSession(db, projectId, claimed!.id)).toBeNull();
    const archivedCompletionReplay = await completeTask(
      claimed!.id,
      claimToken,
      completionPayload,
    );
    expect(archivedCompletionReplay.status).toBe(200);
    expect(await archivedCompletionReplay.json()).toEqual(completedBody);
    const archivedRetry = await acceptIssue(seeded.runId, seeded.proposal.id);
    expect(archivedRetry.status).toBe(200);
    expect(await archivedRetry.json()).toMatchObject({
      outcome: "already_accepted",
      session: {
        id: claimed!.id,
        status: "completed",
        workerId,
        requestedByUserId: ownerId,
      },
    });
  }, 60_000);

  it("creates and approves the same canonical card from a channel", async () => {
    const agent = await createAgent();
    await addChannelAgent(db, {
      channelId,
      agentId: agent.id,
      addedByUserId: ownerId,
      createdAt: new Date().toISOString(),
    });
    const request = "Run the iOS deployment Skill from this channel.";
    const triggerMessageId = nextId(0xb1000000);
    await createChannelMessage(db, {
      id: triggerMessageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: request,
      mentionedUserIds: [],
      mentionedAgentIds: [agent.id],
      createdAt: new Date().toISOString(),
    });
    const [queued] = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      agents: [{
        id: agent.id,
        projectId,
        skillId: agent.skills[0].id,
        provider: "codex",
      }],
      createdAt: new Date().toISOString(),
    });
    const claimHash = sha256(`channel-reply-${queued.id}`);
    const claimed = await claimNextChannelAgentReply(db, organizationId, {
      deviceId: workerDeviceId,
      workerId,
      providers: ["codex"],
      supportsOrganizationAgentContext: true,
      claimTokenHash: claimHash,
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    expect(claimed?.id).toBe(queued.id);
    expect(await completeChannelReply(db, claimed!, {
      jobId: claimed!.id,
      deviceId: workerDeviceId,
      workerId,
      claimTokenHash: claimHash,
      body: "The saved Skill requires explicit approval.",
      document: null,
      issueProposal: null,
      executionProposal: null,
      skillExecutionProposal: true,
      delegation: null,
      agentName: agent.name,
      agentProvider: "codex",
      completedAt: new Date().toISOString(),
    })).not.toBeNull();
    const proposal = await db.prepare(
      `select * from briar_agent_skill_execution_proposals
       where source_kind = 'channel' and source_reply_job_id = ?`,
    ).bind(queued.id).first<AgentSkillExecutionProposalRow>();
    expect(proposal).toMatchObject({
      status: "pending",
      project_id: projectId,
      agent_id: agent.id,
      skill_id: agent.skills[0].id,
      request,
    });
    const message = await getChannelMessage(db, channelId, queued.reply_message_id);
    expect(message?.skillExecutionProposal).toMatchObject({
      id: proposal!.id,
      type: "request_agent_skill_execute",
      status: "pending",
      request,
    });

    const response = await apiWorker.fetch(new Request(
      `https://briar.example/organizations/${organizationId}/channels/${channelId}` +
        `/skill-execution-proposals/${proposal!.id}/accept`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ workerId }),
      },
    ), env());
    expect(response.status).toBe(200);
    const responseBody = await response.json() as {
      proposal: { resultSessionId: string };
    };
    expect(responseBody).toMatchObject({
      outcome: "accepted",
      proposal: { id: proposal!.id, requestedWorkerId: workerId },
      session: {
        projectId,
        agentId: agent.id,
        skillId: agent.skills[0].id,
        request,
        workerId,
      },
    });
    const taskClaimToken = "briar_agent_task_claim_channel_approved_task";
    const taskClaimHash = sha256(taskClaimToken);
    const task = await claimNextProjectAgentTask(db, projectId, {
      workerId,
      agentProviders: ["codex"],
      claimTokenHash: taskClaimHash,
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    expect(task?.id).toBe(responseBody.proposal.resultSessionId);
    expect((await completeTask(task!.id, taskClaimToken, {
      summary: "Channel Skill completed.",
      conversationId: null,
    })).status).toBe(200);
    const publishedChannelResult = await db.prepare(
      `select proposal.result_message_id, message.body
       from briar_agent_skill_execution_proposals proposal
       join briar_channel_messages message
         on message.id = proposal.result_message_id
        and message.channel_id = proposal.channel_id
       where proposal.id = ?`,
    ).bind(proposal!.id).first<{
      result_message_id: string;
      body: string;
    }>();
    expect(publishedChannelResult?.body).toContain("Channel Skill completed.");
  }, 60_000);

  it("treats a task invocation as consent without waiting for another click", async () => {
    const taskCountBefore = await tableCount("briar_project_agent_task_jobs");
    const seeded = await seedIssueProposal("custom", "invoke_is_consent");
    expect(seeded.proposal).toMatchObject({
      status: "accepted",
      execution_mode: "task",
      approval_policy: "invoke_is_consent",
      requested_worker_id: workerId,
      accepted_by_user_id: ownerId,
    });
    expect(seeded.proposal.result_session_id).not.toBeNull();
    expect(await tableCount("briar_project_agent_task_jobs"))
      .toBe(taskCountBefore + 1);
    const claimToken = "briar_agent_task_claim_invoke_is_consent";
    expect(await claimNextProjectAgentTask(db, projectId, {
      workerId,
      agentProviders: ["codex"],
      claimTokenHash: sha256(claimToken),
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    })).toMatchObject({ id: seeded.proposal.result_session_id });
    expect((await completeTask(
      seeded.proposal.result_session_id!,
      claimToken,
      { summary: "Invocation-consent task completed.", conversationId: null },
    )).status).toBe(200);
  }, 60_000);

  it("continues explicit approval in the original channel session", async () => {
    const agent = await createAgent("custom", "conversation", "explicit", {
      provider: "claude",
      model: "claude-sonnet",
      effort: "medium",
    });
    await addChannelAgent(db, {
      channelId,
      agentId: agent.id,
      addedByUserId: ownerId,
      createdAt: new Date().toISOString(),
    });
    const request = "Explain this release flow in the current thread.";
    const triggerMessageId = nextId(0xc1000000);
    await createChannelMessage(db, {
      id: triggerMessageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: request,
      mentionedUserIds: [],
      mentionedAgentIds: [agent.id],
      createdAt: new Date().toISOString(),
    });
    const [source] = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      agents: [{
        id: agent.id,
        projectId,
        skillId: agent.skills[0].id,
        provider: agent.skills[0].provider,
      }],
      createdAt: new Date().toISOString(),
    });
    const sourceClaimHash = sha256(`conversation-source-${source.id}`);
    const sourceClaim = await claimNextChannelAgentReply(db, organizationId, {
      deviceId: workerDeviceId,
      workerId,
      providers: ["codex"],
      supportsOrganizationAgentContext: true,
      claimTokenHash: sourceClaimHash,
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    expect(sourceClaim?.id).toBe(source.id);
    expect(await completeChannelReply(db, sourceClaim!, {
      jobId: source.id,
      deviceId: workerDeviceId,
      workerId,
      claimTokenHash: sourceClaimHash,
      body: "Approve this Skill to continue in the conversation.",
      document: null,
      issueProposal: null,
      executionProposal: null,
      skillExecutionProposal: true,
      delegation: null,
      agentName: agent.name,
      agentProvider: "codex",
      completedAt: new Date().toISOString(),
      conversationId: "retained-conversation-id",
    })).not.toBeNull();
    const proposal = await db.prepare(
      `select * from briar_agent_skill_execution_proposals
       where source_reply_job_id = ?`,
    ).bind(source.id).first<AgentSkillExecutionProposalRow>();
    expect(proposal).toMatchObject({
      status: "pending",
      execution_mode: "conversation",
      approval_policy: "explicit",
      channel_id: channelId,
      thread_root_message_id: triggerMessageId,
      trigger_message_id: triggerMessageId,
    });
    await db.prepare(
      `update briar_channel_reply_sessions
       set owner_device_id = null, owner_worker_id = null,
           conversation_id = null,
           last_activity_at = '2026-01-01T00:00:00.000Z',
           retained_until = '2026-01-01T00:00:00.000Z',
           updated_at = '2026-01-01T00:00:00.000Z'
       where id = ?`,
    ).bind(source.session_id).run();
    const taskCountBefore = await tableCount("briar_project_agent_task_jobs");
    const response = await apiWorker.fetch(new Request(
      `https://briar.example/organizations/${organizationId}/channels/${channelId}` +
        `/skill-execution-proposals/${proposal!.id}/accept`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    ), env());
    expect(response.status).toBe(200);
    const accepted = await response.json() as {
      proposal: {
        resultSessionId: string;
        resultMessageId: string;
        requestedWorkerId: string;
        executionStatus: string;
      };
      session: unknown;
    };
    expect(accepted).toMatchObject({
      proposal: {
        resultSessionId: source.session_id,
        requestedWorkerId: workerId,
        executionStatus: "running",
      },
      session: null,
    });
    expect(await tableCount("briar_project_agent_task_jobs"))
      .toBe(taskCountBefore);
    const continuedJob = await db.prepare(
      `select * from briar_channel_agent_reply_jobs where id = (
         select result_reply_job_id
         from briar_agent_skill_execution_proposals where id = ?
       )`,
    ).bind(proposal!.id).first<ChannelReplyJobRow>();
    expect(continuedJob).toMatchObject({
      status: "queued",
      session_id: source.session_id,
      parent_message_id: triggerMessageId,
      trigger_message_id: source.reply_message_id,
      reply_message_id: accepted.proposal.resultMessageId,
      approved_skill_execution_proposal_id: proposal!.id,
    });
    await db.prepare(
      `update briar_agent_skills
       set name = 'Renamed conversation Skill',
           description = 'Renamed while approved work remains queued.',
           position = 4,
           updated_at = ?
       where id = ?`,
    ).bind(new Date().toISOString(), agent.skills[0].id).run();
    const continuedClaimResponse = await apiWorker.fetch(new Request(
      "https://briar.example/channel-reply-claims",
      {
        method: "POST",
        headers: {
          authorization: "Bearer briar_worker_skill_credential_one",
          "content-type": "application/json",
        },
        body: JSON.stringify({ organizationId, workerId }),
      },
    ), env());
    expect(continuedClaimResponse.status).toBe(200);
    const continuedClaim = await continuedClaimResponse.json() as {
      work: {
        workId: string;
        claimToken: string;
        triggerMessageId: string;
        parentMessageId: string;
        session: {
          id: string;
          conversationId: string | null;
          claimReason: string;
        };
        provider: string;
        model: string | null;
        effort: string | null;
        skillExecutionTarget: {
          request: string;
          executionMode: string;
          approvalPolicy: string;
          approved: boolean;
        };
        snapshot: { messages: Array<{ id: string; body: string }> };
      };
    };
    expect(continuedClaim.work).toMatchObject({
      workId: continuedJob!.id,
      triggerMessageId: source.reply_message_id,
      parentMessageId: triggerMessageId,
      session: {
        id: source.session_id,
        conversationId: null,
        claimReason: "ttl_expired_reactivated",
      },
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      skillExecutionTarget: {
        request,
        executionMode: "conversation",
        approvalPolicy: "explicit",
        approved: true,
      },
    });
    expect(continuedClaim.work.snapshot.messages.map((message) => message.id))
      .toEqual([triggerMessageId, source.reply_message_id]);
    const continuedClaimHash = sha256(continuedClaim.work.claimToken);
    expect(await completeChannelReply(db, continuedJob!, {
      jobId: continuedJob!.id,
      deviceId: workerDeviceId,
      workerId,
      claimTokenHash: continuedClaimHash,
      body: "Conversation Skill result with an HTML artifact.",
      document: {
        title: "ELI5 result",
        markdown: "<div><strong>A tiny visual explanation.</strong></div>",
        projectId,
      },
      issueProposal: null,
      executionProposal: null,
      skillExecutionProposal: false,
      delegation: null,
      agentName: agent.name,
      agentProvider: "codex",
      completedAt: new Date().toISOString(),
      conversationId: "retained-conversation-id",
    })).not.toBeNull();
    expect(await getChannelMessage(
      db,
      channelId,
      accepted.proposal.resultMessageId,
    )).toMatchObject({
      body: "Conversation Skill result with an HTML artifact.",
      document: {
        title: "ELI5 result",
        projectId,
      },
    });
    expect(await db.prepare(
      `select title, markdown, project_id
       from briar_channel_message_documents where message_id = ?`,
    ).bind(accepted.proposal.resultMessageId).first()).toEqual({
      title: "ELI5 result",
      markdown: "<div><strong>A tiny visual explanation.</strong></div>",
      project_id: projectId,
    });
    expect((await getChannelMessage(
      db,
      channelId,
      source.reply_message_id,
    ))?.skillExecutionProposal).toMatchObject({
      executionStatus: "completed",
      resultMessageId: accepted.proposal.resultMessageId,
    });
  }, 60_000);

  it("receipts a retryable failure without consuming the claim twice", async () => {
    const seeded = await seedIssueProposal();
    const accepted = await acceptIssue(seeded.runId, seeded.proposal.id);
    const body = await accepted.json() as {
      proposal: { resultSessionId: string };
    };
    const taskId = body.proposal.resultSessionId;
    const claimToken = "briar_agent_task_claim_retryable_receipt";
    expect(await claimNextProjectAgentTask(db, projectId, {
      workerId,
      agentProviders: ["codex"],
      claimTokenHash: sha256(claimToken),
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    })).toMatchObject({ id: taskId, attempts: 1 });

    const payload = { error: "Provider failed before completing its Skill." };
    const first = await completeTask(taskId, claimToken, payload);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      session: { id: taskId, status: "running", error: null },
    });
    const replay = await completeTask(taskId, claimToken, payload);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    expect((await completeTask(taskId, claimToken, {
      error: "A different failure payload.",
    })).status).toBe(409);
    expect(await db.prepare(
      `select status, attempts from briar_project_agent_task_jobs where id = ?`,
    ).bind(taskId).first()).toEqual({ status: "queued", attempts: 1 });
    expect(await db.prepare(
      `select outcome_status, error
       from briar_project_agent_task_completion_receipts
       where project_id = ? and task_id = ?`,
    ).bind(projectId, taskId).first()).toEqual({
      outcome_status: "queued",
      error: payload.error,
    });

    const successToken = "briar_agent_task_claim_retryable_receipt_success";
    expect(await claimNextProjectAgentTask(db, projectId, {
      workerId,
      agentProviders: ["codex"],
      claimTokenHash: sha256(successToken),
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    })).toMatchObject({ id: taskId, attempts: 2 });
    expect((await completeTask(taskId, successToken, {
      summary: "Retry completed safely.",
      conversationId: null,
    })).status).toBe(200);
  }, 60_000);

  it("replays and repairs a direct task after its completion response is lost", async () => {
    const agent = await createAgent();
    const created = await apiWorker.fetch(new Request(
      `https://briar.example/projects/${projectId}/agent-tasks`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          agentId: agent.id,
          skillId: agent.skills[0].id,
          request: "Run this direct task exactly once.",
          workerId,
          requestId: crypto.randomUUID(),
        }),
      },
    ), env());
    expect(created.status).toBe(200);
    const taskId = ((await created.json()) as { session: { id: string } })
      .session.id;
    const claim = await claimTask();
    expect(claim.status).toBe(200);
    const work = ((await claim.json()) as {
      work: {
        workId: string;
        claimToken: string;
        claimAttempts: number;
      } | null;
    }).work!;
    expect(work.workId).toBe(taskId);
    expect(work.claimAttempts).toBe(1);
    const transcript = await apiWorker.fetch(new Request(
      "https://briar.example/transcripts",
      {
        method: "POST",
        headers: {
          authorization: "Bearer briar_worker_skill_credential_one",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          sessionId: taskId,
          // Worker v1.2.139 sent the direct-task UUID in runId even though
          // direct Project Agent tasks are not Hunt runs. Keep this legacy
          // field in the regression payload to verify server compatibility.
          runId: taskId,
          workType: "projectAgentTask",
          workId: taskId,
          claimToken: work.claimToken,
          workerId,
          agentProvider: "codex",
          events: [{
            sequence: 1,
            direction: "server",
            payload: {
              type: "event",
              event: {
                type: "messageCompleted",
                id: "task-progress-1",
                phase: "commentary",
                text: "Direct task progress was persisted.",
              },
            },
          }],
        }),
      },
    ), env());
    expect(transcript.status).toBe(202);
    const storedTranscript = await apiWorker.fetch(new Request(
      `https://briar.example/projects/${projectId}/sessions/${taskId}/transcript`,
      { headers: { authorization: `Bearer ${ownerToken}` } },
    ), env());
    expect(storedTranscript.status).toBe(200);
    await expect(storedTranscript.json()).resolves.toMatchObject({
      session: { sessionId: taskId, runId: null },
      events: [{
        message: {
          event: {
            type: "messageCompleted",
            text: "Direct task progress was persisted.",
          },
        },
      }],
    });
    const payload = {
      summary: "Direct task provider turn completed.",
      conversationId: "direct-conversation",
    };

    const committed = await completeProjectAgentTaskWithReceipt(
      db,
      projectId,
      taskId,
      {
        workerId,
        claimTokenHash: sha256(work.claimToken),
        summary: payload.summary,
        conversationId: payload.conversationId,
        updatedAt: new Date().toISOString(),
      },
    );
    expect(committed).toMatchObject({
      replayed: false,
      job: { id: taskId, status: "completed" },
      receipt: { outcome_status: "completed", summary: payload.summary },
    });
    expect((await getProjectAgentSession(db, projectId, taskId))?.status)
      .toBe("running");

    const reconciled = await completeTask(taskId, work.claimToken, payload);
    expect(reconciled.status).toBe(200);
    expect(await reconciled.json()).toMatchObject({
      session: {
        id: taskId,
        status: "completed",
        summary: payload.summary,
        conversationId: payload.conversationId,
      },
    });
    expect((await getProjectAgentSession(db, projectId, taskId))?.status)
      .toBe("completed");
    expect((await completeTask(taskId, work.claimToken, {
      ...payload,
      conversationId: "different-conversation",
    })).status).toBe(409);
  }, 60_000);

  it("enforces device capacity in both claim directions without a 500", async () => {
    await db.prepare(
      `update briar_execution_worker_devices
       set max_concurrent_sessions = 1, updated_at = ? where id = ?`,
    ).bind(new Date().toISOString(), workerDeviceId).run();
    try {
      const firstSeed = await seedIssueProposal();
      const firstAccepted = await acceptIssue(
        firstSeed.runId,
        firstSeed.proposal.id,
      );
      const firstTaskId = ((await firstAccepted.json()) as {
        proposal: { resultSessionId: string };
      }).proposal.resultSessionId;
      const secondSeed = await seedIssueProposal();
      const secondAccepted = await acceptIssue(
        secondSeed.runId,
        secondSeed.proposal.id,
      );
      const secondTaskId = ((await secondAccepted.json()) as {
        proposal: { resultSessionId: string };
      }).proposal.resultSessionId;

      const simultaneous = await Promise.all([claimTask(), claimTask()]);
      expect(simultaneous.map((response) => response.status)).toEqual([200, 200]);
      const claimBodies = await Promise.all(simultaneous.map((response) =>
        response.json() as Promise<{
          work: { workId: string; claimToken: string } | null;
        }>
      ));
      expect(claimBodies.filter((body) => body.work !== null)).toHaveLength(1);
      expect(claimBodies.filter((body) => body.work === null)).toHaveLength(1);
      const activeTask = claimBodies.find((body) => body.work)!.work!;
      const queuedTaskId = activeTask.workId === firstTaskId
        ? secondTaskId
        : firstTaskId;
      await expect(countExecutionWorkerDeviceSessions(
        db,
        workerDeviceId,
        new Date().toISOString(),
      )).resolves.toBe(1);
      expect(await db.prepare(
        `select status, attempts from briar_project_agent_task_jobs where id = ?`,
      ).bind(queuedTaskId).first()).toEqual({ status: "queued", attempts: 0 });

      const capacityRunId = await recordHuntEvent(
        db,
        projectId,
        backlogEvent(
          `capacity-${crypto.randomUUID()}`,
          "Capacity direction test",
          new Date().toISOString(),
        ),
      );
      expect(await dispatchHuntRun(db, organizationId, projectId, {
        runId: capacityRunId,
        provider: "codex",
        workerId,
        requestedByUserId: ownerId,
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
      })).toMatchObject({ runId: capacityRunId, requestedWorkerId: workerId });
      const claimHunt = () => apiWorker.fetch(new Request(
        "https://briar.example/queue/claims",
        {
          method: "POST",
          headers: {
            authorization: "Bearer briar_worker_skill_credential_one",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            projectId,
            workerId,
            runId: capacityRunId,
            claimedBy: "capacity-test",
          }),
        },
      ), env());
      const taskBlocksHunt = await claimHunt();
      expect(taskBlocksHunt.status).toBe(200);
      expect(await taskBlocksHunt.json()).toEqual({ work: null });

      expect((await completeTask(activeTask.workId, activeTask.claimToken, {
        summary: "Capacity holder completed.",
        conversationId: null,
      })).status).toBe(200);
      const huntClaim = await claimHunt();
      expect(huntClaim.status).toBe(200);
      expect(await huntClaim.json()).toMatchObject({
        work: { runId: capacityRunId },
      });
      await expect(countExecutionWorkerDeviceSessions(
        db,
        workerDeviceId,
        new Date().toISOString(),
      )).resolves.toBe(1);
      const huntBlocksTask = await claimTask();
      expect(huntBlocksTask.status).toBe(200);
      expect(await huntBlocksTask.json()).toEqual({ work: null });

      await db.prepare(`delete from briar_hunt_runs where id = ?`)
        .bind(capacityRunId).run();
      const finalTaskClaim = await claimTask();
      expect(finalTaskClaim.status).toBe(200);
      const finalTask = (await finalTaskClaim.json()) as {
        work: { workId: string; claimToken: string } | null;
      };
      expect(finalTask.work?.workId).toBe(queuedTaskId);
      expect((await completeTask(
        finalTask.work!.workId,
        finalTask.work!.claimToken,
        { summary: "Queued capacity task completed.", conversationId: null },
      )).status).toBe(200);
    } finally {
      await db.prepare(
        `update briar_execution_worker_devices
         set max_concurrent_sessions = 4, updated_at = ? where id = ?`,
      ).bind(new Date().toISOString(), workerDeviceId).run();
    }
  }, 60_000);

  it("keeps retryable errors queued and atomically projects terminal failure", async () => {
    const seeded = await seedIssueProposal();
    const accepted = await acceptIssue(seeded.runId, seeded.proposal.id);
    const body = await accepted.json() as {
      proposal: { resultSessionId: string };
    };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimToken = `briar_agent_task_claim_retry_claim_${attempt}`;
      const claimHash = sha256(claimToken);
      const claimed = await claimNextProjectAgentTask(db, projectId, {
        workerId,
        agentProviders: ["codex"],
        claimTokenHash: claimHash,
        claimedAt: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
      expect(claimed?.id).toBe(body.proposal.resultSessionId);
      const completed = await completeProjectAgentTask(
        db,
        projectId,
        claimed!.id,
        {
          workerId,
          claimTokenHash: claimHash,
          error: `retryable failure ${attempt}`,
          updatedAt: new Date(Date.now() + attempt).toISOString(),
        },
      );
      expect(completed?.status).toBe(attempt < 3 ? "queued" : "failed");
      const session = await getProjectAgentSession(db, projectId, claimed!.id);
      expect(session?.status).toBe(attempt < 3 ? "running" : "failed");
    }
    const terminalFailureReplay = await completeTask(
      body.proposal.resultSessionId,
      "briar_agent_task_claim_retry_claim_3",
      { error: "retryable failure 3" },
    );
    expect(terminalFailureReplay.status).toBe(200);
    expect(await terminalFailureReplay.json()).toMatchObject({
      session: {
        id: body.proposal.resultSessionId,
        status: "failed",
        error: "retryable failure 3",
      },
    });
    expect(await db.prepare(
      `select message.body
       from briar_agent_skill_execution_proposals proposal
       join briar_issue_messages message
         on message.id = proposal.result_message_id
       where proposal.id = ?`,
    ).bind(seeded.proposal.id).first<{ body: string }>()).toMatchObject({
      body: expect.stringContaining("retryable failure 3"),
    });
    expect((await completeTask(
      body.proposal.resultSessionId,
      "briar_agent_task_claim_retry_claim_3",
      { error: "different terminal failure" },
    )).status).toBe(409);

    const reapedSeed = await seedIssueProposal();
    const reapedAccepted = await acceptIssue(
      reapedSeed.runId,
      reapedSeed.proposal.id,
    );
    const reapedBody = await reapedAccepted.json() as {
      proposal: { resultSessionId: string };
    };
    const reapHash = sha256("reap-claim");
    expect(await claimNextProjectAgentTask(db, projectId, {
      workerId,
      agentProviders: ["codex"],
      claimTokenHash: reapHash,
      claimedAt: new Date(Date.now() - 120_000).toISOString(),
      leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    })).not.toBeNull();
    await db.prepare(
      `update briar_project_agent_task_jobs set attempts = 3
       where id = ?`,
    ).bind(reapedBody.proposal.resultSessionId).run();
    const reaped = await reapProjectAgentTaskJobs(db, projectId, {
      observedAt: new Date().toISOString(),
      error: "Worker lease expired after repeated attempts.",
    });
    expect(reaped.map((job) => job.id)).toContain(
      reapedBody.proposal.resultSessionId,
    );
    expect((await getProjectAgentSession(
      db,
      projectId,
      reapedBody.proposal.resultSessionId,
    ))?.status).toBe("failed");
    expect(await db.prepare(
      `select message.body
       from briar_agent_skill_execution_proposals proposal
       join briar_issue_messages message
         on message.id = proposal.result_message_id
       where proposal.id = ?`,
    ).bind(reapedSeed.proposal.id).first<{ body: string }>()).toMatchObject({
      body: expect.stringContaining(
        "Worker lease expired after repeated attempts.",
      ),
    });
  }, 60_000);

  it("keeps approved work alive across metadata saves and rejects runtime edits", async () => {
    const seeded = await seedIssueProposal();
    const accepted = await acceptIssue(seeded.runId, seeded.proposal.id);
    const taskId = ((await accepted.json()) as {
      proposal: { resultSessionId: string };
    }).proposal.resultSessionId;
    const originalSkill = seeded.agent.skills[0];
    const harmlessSkill = {
      id: originalSkill.id,
      name: "Renamed release Skill",
      description: "Use this renamed Skill for approved releases.",
      body: originalSkill.body,
      provider: originalSkill.provider,
      model: originalSkill.model,
      effort: originalSkill.effort,
      kind: originalSkill.kind,
      executionMode: originalSkill.execution_mode,
      approvalPolicy: originalSkill.approval_policy,
      position: 4,
    };
    const agentInput = (skill: typeof harmlessSkill) => ({
      name: seeded.agent.name,
      description: seeded.agent.description,
      provider: seeded.agent.provider,
      model: seeded.agent.model,
      effort: seeded.agent.effort,
      responsibility: seeded.agent.responsibility,
      skills: [skill],
      calendarColor: seeded.agent.calendar_color,
    });
    const saveAgent = (skill: typeof harmlessSkill) => apiWorker.fetch(
      new Request(
        `https://briar.example/projects/${projectId}/agents/${seeded.agent.id}`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${ownerToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(agentInput(skill)),
        },
      ),
      env(),
    );

    expect((await saveAgent(harmlessSkill)).status).toBe(200);
    await expect(db.prepare(
      `select status, error from briar_project_agent_task_jobs where id = ?`,
    ).bind(taskId).first()).resolves.toEqual({ status: "queued", error: null });

    for (const runtimeChange of [
      { body: "Changed while queued." },
      { provider: "claude" as const },
      { model: "changed-model" },
    ]) {
      const response = await saveAgent({ ...harmlessSkill, ...runtimeChange });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        message: expect.stringContaining(
          "cannot change body or execution settings",
        ),
      });
    }
    await expect(db.prepare(
      `select status, error from briar_project_agent_task_jobs where id = ?`,
    ).bind(taskId).first()).resolves.toEqual({ status: "queued", error: null });

    const claimToken = "briar_agent_task_claim_runtime_guard";
    expect(await claimNextProjectAgentTask(db, projectId, {
      workerId,
      agentProviders: ["codex"],
      claimTokenHash: sha256(claimToken),
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    })).toMatchObject({ id: taskId });
    for (const runtimeChange of [
      { effort: "medium" as const },
      { executionMode: "conversation" as const },
      { approvalPolicy: "invoke_is_consent" as const },
    ]) {
      expect((await saveAgent({ ...harmlessSkill, ...runtimeChange })).status)
        .toBe(409);
    }
    await expect(db.prepare(
      `select status, error from briar_project_agent_task_jobs where id = ?`,
    ).bind(taskId).first()).resolves.toEqual({ status: "running", error: null });
    expect((await completeTask(taskId, claimToken, {
      summary: "Runtime guard regression completed.",
      conversationId: null,
    })).status).toBe(200);
  }, 60_000);

  it("atomically reconciles trigger failures and drains both realtime topics", async () => {
    await db.prepare(
      `delete from briar_agent_skill_execution_realtime_outbox`,
    ).run();
    const seeded = await seedChannelProposal();
    const accepted = await acceptChannel(seeded.proposal.id);
    expect(accepted.status).toBe(200);
    const taskId = ((await accepted.json()) as {
      proposal: { resultSessionId: string };
    }).proposal.resultSessionId;
    const started = await getProjectAgentSession(db, projectId, taskId);
    expect(started?.status).toBe("running");

    await db.prepare(
      `update briar_agent_skills
       set body = 'Revoked runtime body.',
           updated_at = '2000-01-01T00:00:00.000Z'
       where id = ?`,
    ).bind(seeded.agent.skills[0].id).run();

    const task = await db.prepare(
      `select status, error, completed_at, updated_at
       from briar_project_agent_task_jobs where id = ?`,
    ).bind(taskId).first<{
      status: string;
      error: string;
      completed_at: string;
      updated_at: string;
    }>();
    const session = await getProjectAgentSession(db, projectId, taskId);
    const [summary] = await listProjectAgentSessionSummaries(
      db,
      projectId,
      [taskId],
    );
    const summaryJson = JSON.parse(summary!.summary_json) as {
      status: string;
      completedAt: string;
    };
    expect(task).toMatchObject({
      status: "failed",
      error: "Approved Skill runtime changed before execution.",
    });
    expect(task!.completed_at).toBe(task!.updated_at);
    expect(Date.parse(task!.completed_at)).toBeGreaterThanOrEqual(
      Date.parse(started!.started_at),
    );
    expect(task!.completed_at).not.toBe("2000-01-01T00:00:00.000Z");
    expect(session).toMatchObject({
      status: "failed",
      completed_at: task!.completed_at,
      updated_at: task!.updated_at,
    });
    expect(summaryJson).toEqual({
      ...summaryJson,
      status: "failed",
      completedAt: task!.completed_at,
    });

    const result = await db.prepare(
      `select proposal.result_message_id, message.body, message.created_at
       from briar_agent_skill_execution_proposals proposal
       join briar_channel_messages message
         on message.id = proposal.result_message_id
       where proposal.id = ?`,
    ).bind(seeded.proposal.id).first<{
      result_message_id: string;
      body: string;
      created_at: string;
    }>();
    const root = await getChannelMessage(db, channelId, seeded.triggerMessageId);
    expect(result?.body).toContain("Approved Skill runtime changed");
    expect(result?.created_at).toBe(task!.completed_at);
    expect(Date.parse(result!.created_at)).toBeGreaterThanOrEqual(
      Date.parse(root!.createdAt),
    );
    expect((await getChannelMessage(
      db,
      channelId,
      seeded.proposal.reply_message_id,
    ))?.skillExecutionProposal).toMatchObject({
      executionStatus: "failed",
      resultMessageId: result!.result_message_id,
    });
    expect(await listChannelConversationNotifications(
      db,
      organizationId,
      ownerId,
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: result!.result_message_id }),
    ]));

    await db.batch([
      db.prepare(
        `update briar_project_agent_task_jobs
         set completed_at = '2000-01-01T00:00:00.000Z',
             updated_at = '2000-01-01T00:00:00.000Z'
         where id = ?`,
      ).bind(taskId),
      db.prepare(
        `update briar_project_agent_sessions
         set completed_at = '2000-01-01T00:00:00.000Z',
             updated_at = '2000-01-01T00:00:00.000Z',
             payload_json = json_set(
               payload_json,
               '$.completedAt', '2000-01-01T00:00:00.000Z',
               '$.updatedAt', '2000-01-01T00:00:00.000Z'
             )
         where project_id = ? and id = ?`,
      ).bind(projectId, taskId),
      db.prepare(
        `update briar_project_agent_session_summaries
         set summary_json = json_set(
               summary_json, '$.status', 'running', '$.completedAt', null
             ),
             updated_at = '2000-01-01T00:00:00.000Z'
         where project_id = ? and session_id = ?`,
      ).bind(projectId, taskId),
      db.prepare(
        `update briar_channel_messages
         set created_at = '2000-01-01T00:00:00.000Z',
             updated_at = '2000-01-01T00:00:00.000Z'
         where id = ?`,
      ).bind(result!.result_message_id),
      db.prepare(
        `delete from briar_channel_notification_inbox
         where message_id = ?`,
      ).bind(result!.result_message_id),
      db.prepare(
        `delete from briar_agent_skill_execution_realtime_outbox
         where task_id = ?`,
      ).bind(taskId),
    ]);
    await db.prepare(
      `update briar_project_agent_task_jobs set status = status where id = ?`,
    ).bind(taskId).run();
    const repairedTask = await db.prepare(
      `select completed_at from briar_project_agent_task_jobs where id = ?`,
    ).bind(taskId).first<{ completed_at: string }>();
    const [repairedSummary] = await listProjectAgentSessionSummaries(
      db,
      projectId,
      [taskId],
    );
    const repairedMessage = await db.prepare(
      `select created_at from briar_channel_messages where id = ?`,
    ).bind(result!.result_message_id).first<{ created_at: string }>();
    expect(Date.parse(repairedTask!.completed_at)).toBeGreaterThanOrEqual(
      Date.parse(started!.started_at),
    );
    expect(JSON.parse(repairedSummary!.summary_json)).toMatchObject({
      status: "failed",
      completedAt: repairedTask!.completed_at,
    });
    expect(repairedMessage?.created_at).toBe(repairedTask!.completed_at);
    expect(await listChannelConversationNotifications(
      db,
      organizationId,
      ownerId,
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: result!.result_message_id }),
    ]));

    const outbox = await db.prepare(
      `select source_kind, channel_cursor, session_version
       from briar_agent_skill_execution_realtime_outbox where task_id = ?`,
    ).bind(taskId).first<{
      source_kind: string;
      channel_cursor: number;
      session_version: number;
    }>();
    expect(outbox).toMatchObject({
      source_kind: "channel",
      channel_cursor: expect.any(Number),
      session_version: expect.any(Number),
    });

    const published: unknown[] = [];
    const realtimeEnv = {
      CHANNEL_REALTIME: {
        getByName: () => ({
          fetch: async (_url: string, init: RequestInit) => {
            published.push(JSON.parse(String(init.body)));
            return new Response(null, { status: 204 });
          },
        }),
      },
    } as unknown as Env;
    await flushAgentSkillExecutionRealtimeOutbox(realtimeEnv, db);
    expect(published).toEqual([
      { topic: "channels", cursor: outbox!.channel_cursor },
      {
        topic: "project-session",
        projectId,
        version: outbox!.session_version,
      },
    ]);
    await expect(db.prepare(
      `select 1 from briar_agent_skill_execution_realtime_outbox
       where task_id = ?`,
    ).bind(taskId).first()).resolves.toBeNull();
  }, 60_000);

  it("reconciles permanent Agent, Skill, Worker, and policy revocation", async () => {
    const agentSeed = await seedIssueProposal();
    const agentAccepted = await acceptIssue(
      agentSeed.runId,
      agentSeed.proposal.id,
    );
    const agentSessionId = ((await agentAccepted.json()) as {
      proposal: { resultSessionId: string };
    }).proposal.resultSessionId;
    await db.prepare(
      `update briar_project_agents
       set responsibility = 'Revoked responsibility', updated_at = ?
       where id = ?`,
    ).bind(new Date().toISOString(), agentSeed.agent.id).run();
    expect((await getProjectAgentSession(db, projectId, agentSessionId))?.status)
      .toBe("failed");

    const skillSeed = await seedIssueProposal();
    const skillAccepted = await acceptIssue(
      skillSeed.runId,
      skillSeed.proposal.id,
    );
    const skillSessionId = ((await skillAccepted.json()) as {
      proposal: { resultSessionId: string };
    }).proposal.resultSessionId;
    await db.prepare(`delete from briar_agent_skills where id = ?`)
      .bind(skillSeed.agent.skills[0].id).run();
    expect(await db.prepare(
      `select 1 from briar_project_agent_task_jobs where id = ?`,
    ).bind(skillSessionId).first()).toBeNull();
    expect((await getProjectAgentSession(db, projectId, skillSessionId))?.status)
      .toBe("failed");

    const policySeed = await seedIssueProposal();
    const policyAccepted = await acceptIssue(
      policySeed.runId,
      policySeed.proposal.id,
    );
    const policySessionId = ((await policyAccepted.json()) as {
      proposal: { resultSessionId: string };
    }).proposal.resultSessionId;
    await updateProjectExecutionWorkerPolicy(db, projectId, {
      selectionMode: "allowlist",
      defaultWorkerId: otherWorkerId,
      allowedWorkerIds: [otherWorkerId],
      updatedByUserId: ownerId,
      observedAt: new Date().toISOString(),
    });
    expect((await getProjectAgentSession(db, projectId, policySessionId))?.status)
      .toBe("failed");

    await updateProjectExecutionWorkerPolicy(db, projectId, {
      selectionMode: "any",
      defaultWorkerId: null,
      allowedWorkerIds: [],
      updatedByUserId: ownerId,
      observedAt: new Date().toISOString(),
    });
    const workerSeed = await seedIssueProposal();
    const workerAccepted = await acceptIssue(
      workerSeed.runId,
      workerSeed.proposal.id,
    );
    const workerSessionId = ((await workerAccepted.json()) as {
      proposal: { resultSessionId: string };
    }).proposal.resultSessionId;
    await disableExecutionWorker(db, workerDeviceId, new Date().toISOString());
    expect((await getProjectAgentSession(db, projectId, workerSessionId))?.status)
      .toBe("failed");

    // Migration 0074's existing channel-delete sync trigger reinserts a row
    // with the old organization during an organization FK cascade. Remove the
    // test channel explicitly so this assertion isolates the 0092 cascade.
    await db.prepare(`delete from briar_channels where id = ?`)
      .bind(channelId).run();
    await expect(db.prepare(`delete from briar_organizations where id = ?`)
      .bind(organizationId).run()).resolves.toBeDefined();
    expect(await db.prepare(
      `select 1 from briar_organizations where id = ?`,
    ).bind(organizationId).first()).toBeNull();
  }, 60_000);
});
