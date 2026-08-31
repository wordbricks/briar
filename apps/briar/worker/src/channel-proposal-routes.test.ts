import { createHash } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addChannelAgent,
  createChannel,
  createChannelMessage,
  getChannelSyncCursor,
  loadChannelDelta,
  reserveChannelActionProposalApproval,
} from "./channels";
import apiWorker from "./index";
import {
  acceptOrganizationChannelProposal,
  declineOrganizationChannelProposal,
} from "./channel-proposal-routes";
import { listOrganizationChannelMessages } from "./channel-message-routes";
import { HttpError } from "./http-response";
import {
  moveProjectIssueRun,
  recoverProjectIssueRun,
} from "./issue-control-routes";
import { acceptProjectIssueActionProposal } from "./issue-proposal-routes";
import { createOrganizationAgent } from "./organization-agents";
import {
  claimNextQueuedHuntRun,
  createProjectAgent,
  createIssueActionProposal,
  createIssueAttachments,
  moveHuntRun,
  reworkHuntRun,
  reserveIssueCreateProposalApproval,
  recordHuntEvent,
  transferIssue,
} from "./db";
import { workerCapabilitiesFixture } from "./test-helpers/worker-runtime";
import { RequestDecodeError } from "./request-schema";
import {
  dispatchHuntRun,
  leaseExpiryFrom,
  registerExecutionWorker,
  unassignHuntRun,
  WorkerConflictError,
} from "./workers";

const organizationId = "10000000-0000-4000-8000-000000000001";
const otherOrganizationId = "10000000-0000-4000-8000-000000000002";
const projectAId = "20000000-0000-4000-8000-000000000001";
const projectBId = "20000000-0000-4000-8000-000000000002";
const otherProjectId = "20000000-0000-4000-8000-000000000003";
const channelId = "30000000-0000-4000-8000-000000000001";
const agentId = "40000000-0000-4000-8000-000000000001";
let projectAgentId = "";
const ownerId = "proposal-owner";
const memberId = "proposal-member";
const outsiderId = "proposal-outsider";
const ownerToken = "channel-proposal-owner-token";
const memberToken = "channel-proposal-member-token";
const outsiderToken = "channel-proposal-outsider-token";
const projectAgentToken = "briar_agent_channel_proposal_test";
const projectBAgentToken = "briar_agent_channel_proposal_target_test";
const now = "2026-08-10T00:00:00.000Z";

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

describe("channel issue proposal approval route", () => {
  const db = cloudflareEnv.DB;
  const attachments = cloudflareEnv.ATTACHMENTS;

  beforeAll(async () => {
    for (const [id, name, token] of [
      [ownerId, "Owner", ownerToken],
      [memberId, "Member", memberToken],
      [outsiderId, "Outsider", outsiderToken],
    ]) {
      await db.batch([
        db.prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
        ).bind(id, name, `${id}@example.com`, now, now),
        db.prepare(
          `insert into "session" (
             id, expiresAt, token, createdAt, updatedAt, userId
           ) values (?, '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
        ).bind(`session-${id}`, token, now, now, id),
      ]);
    }
    await db.batch([
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Proposal Org', 'proposal-org', ?, ?)`,
      ).bind(organizationId, now, now),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Other Org', 'other-proposal-org', ?, ?)`,
      ).bind(otherOrganizationId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'developer', ?, ?)`,
      ).bind(organizationId, memberId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(otherOrganizationId, ownerId, now, now),
    ]);
    for (const [id, organization, name, tokenCharacter] of [
      [projectAId, organizationId, "Project A", "a"],
      [projectBId, organizationId, "Project B", "b"],
      [otherProjectId, otherOrganizationId, "Other Project", "c"],
    ]) {
      await db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        ownerId,
        organization,
        name,
        id === projectAId
          ? createHash("sha256").update(projectAgentToken).digest("hex")
          : id === projectBId
            ? createHash("sha256").update(projectBAgentToken).digest("hex")
            : tokenCharacter.repeat(64),
        now,
        now,
      ).run();
      await db.prepare(
        `insert into briar_project_settings (
           project_id, workflow_json, mandatory_checkpoints_json,
           created_at, updated_at
         ) values (?, ?, '[]', ?, ?)`,
      ).bind(
        id,
        JSON.stringify({
          version: 2,
          requirements: [],
          stages: [
            { id: "analyzing", label: "Analyze", required: true },
            { id: "implementing", label: "Implement", required: true },
          ],
          execution: { checkpoints: [] },
          completion: { requiredStages: ["analyzing", "implementing"] },
        }),
        now,
        now,
      ).run();
    }
    await db.batch(
      [projectAId, projectBId].map((projectId) =>
        db.prepare(
          `insert into briar_project_members (
             project_id, organization_id, user_id, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
        ).bind(projectId, organizationId, memberId, now, now)
      ),
    );
    await createChannel(db, {
      id: channelId,
      organizationId,
      kind: "channel",
      dmKey: null,
      slug: "proposals",
      name: "Proposals",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: now,
    });
    await createOrganizationAgent(db, {
      id: agentId,
      organizationId,
      name: "Bumble",
      provider: "codex",
      model: null,
      responsibility: "Coordinate organization work.",
      effort: null,
      createdAt: now,
    });
    const projectAgent = await createProjectAgent(db, projectAId, {
      name: "Builder",
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      responsibility: "Implement approved project changes.",
      calendarColor: "#7c3aed",
    });
    projectAgentId = projectAgent.id;
    await addChannelAgent(db, {
      channelId,
      agentId: projectAgent.id,
      addedByUserId: ownerId,
      createdAt: now,
    });
  }, 60_000);

  const env = (
    authSecret = "channel-proposal-test-secret-at-least-32-characters",
  ) => ({
    DB: db,
    ATTACHMENTS: attachments,
    BETTER_AUTH_SECRET: authSecret,
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
  }) as unknown as Env;

  const registerWorker = (
    projectId: string,
    suffix: string,
    observedAt: string,
  ) => registerExecutionWorker(db, projectId, {
    id: `channel-${suffix}-worker`,
    deviceId: `channel-${suffix}-device`,
    organizationId,
    ownerUserId: ownerId,
    label: `Channel ${suffix} Worker`,
    deviceIdentityHash: createHash("sha256")
      .update(`channel-${suffix}-device`)
      .digest("hex"),
    credentialTokenHash: createHash("sha256")
      .update(`channel-${suffix}-credential`)
      .digest("hex"),
    agentProvider: "codex",
    capabilities: workerCapabilitiesFixture({ providerCapabilities }),
    versions: { briar: "1.0.0" },
    observedAt,
  });

  type ChannelProposalApplicationCall =
    | {
      kind: "accept";
      proposalId: string;
      projectId: string | null;
      token: string | null;
      execution: {
        provider: "codex";
        model: string | null;
        effort: "high" | "medium" | null;
        workerId: string | null;
      } | null;
    }
    | {
      kind: "decline";
      proposalId: string;
      token: string | null;
    };

  const proposalUserId = (token: string) =>
    token === ownerToken
      ? ownerId
      : token === memberToken
      ? memberId
      : token === outsiderToken
      ? outsiderId
      : null;

  const invokeChannelProposal = async (
    call: ChannelProposalApplicationCall,
    runtimeEnv: Env,
  ) => {
    if (!call.token) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    const userId = proposalUserId(call.token);
    if (!userId) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    try {
      const result = call.kind === "decline"
        ? await declineOrganizationChannelProposal({
          db,
          env: runtimeEnv,
          organizationId,
          channelId,
          proposalId: call.proposalId,
          userId,
        })
        : await acceptOrganizationChannelProposal({
          db,
          env: runtimeEnv,
          organizationId,
          channelId,
          proposalId: call.proposalId,
          userId,
          request: {
            projectId: call.projectId,
            execution: call.execution,
          },
        });
      return Response.json(result);
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ message: error.message }, { status: error.status });
      }
      if (error instanceof WorkerConflictError) {
        return Response.json({ message: error.message }, { status: 409 });
      }
      if (error instanceof RequestDecodeError) {
        return Response.json({ message: "Invalid request" }, { status: 400 });
      }
      return Response.json({ message: "Internal server error" }, { status: 500 });
    }
  };

  const invokeIssueApplication = async (
    token: string,
    invoke: (userId: string) => Promise<unknown>,
  ) => {
    const session = await db.prepare(
      `select "userId" as user_id from "session" where token = ?`,
    ).bind(token).first<{ user_id: string }>();
    if (!session) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    try {
      return Response.json(await invoke(session.user_id));
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ message: error.message }, { status: error.status });
      }
      if (error instanceof RequestDecodeError) {
        return Response.json({ message: "Invalid request" }, { status: 400 });
      }
      if (error instanceof WorkerConflictError) {
        return Response.json({ message: error.message }, { status: 409 });
      }
      return Response.json({ message: "Internal server error" }, { status: 500 });
    }
  };

  const worker = {
    fetch: (input: Request | ChannelProposalApplicationCall, runtimeEnv: Env) =>
      input instanceof Request
        ? apiWorker.fetch(input, runtimeEnv)
        : invokeChannelProposal(input, runtimeEnv),
  };

  const request = (
    proposalId: string,
    projectId: string | null,
    token: string | null = ownerToken,
    execution: {
      provider: "codex";
      model: string | null;
      effort: "high" | "medium" | null;
      workerId: string | null;
    } | null = null,
  ): ChannelProposalApplicationCall => ({
    kind: "accept",
    proposalId,
    projectId,
    token,
    execution,
  });

  const declineRequest = (
    proposalId: string,
    token: string | null = ownerToken,
  ): ChannelProposalApplicationCall => ({
    kind: "decline",
    proposalId,
    token,
  });

  const seedProposal = async (
    sequence: number,
    options: {
      projectId?: string | null;
      executeAfterCreate?: boolean;
      payload?: unknown;
    } = {},
  ) => {
    const suffix = sequence.toString(16).padStart(12, "0");
    const triggerId = `50000000-0000-4000-8000-${suffix}`;
    const replyId = `60000000-0000-4000-8000-${suffix}`;
    const proposalId = `70000000-0000-4000-8000-${suffix}`;
    const proposalAgentId = options.executeAfterCreate ? projectAgentId : agentId;
    await createChannelMessage(db, {
      id: triggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: `Please create issue ${sequence}`,
      mentionedUserIds: [],
      mentionedAgentIds: [agentId],
      createdAt: now,
    });
    await createChannelMessage(db, {
      id: replyId,
      channelId,
      parentMessageId: triggerId,
      authorUserId: null,
      authorAgentId: proposalAgentId,
      authorAgentName: options.executeAfterCreate ? "Builder" : "Bumble",
      authorAgentProvider: "codex",
      body: `Issue proposal ${sequence}`,
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: now,
    });
    await db.prepare(
      `insert into briar_channel_action_proposals (
         id, channel_id, project_id, trigger_message_id, reply_message_id,
         action_type, payload_json, execute_after_create,
         execution_proposal_id, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      proposalId,
      channelId,
      options.executeAfterCreate ? projectAId : options.projectId ?? null,
      triggerId,
      replyId,
      "request_issue_create",
      JSON.stringify(options.payload ?? {
        issue: {
          title: `Approved issue ${sequence}`,
          description: "Create it, but do not execute it.",
          priority: 2,
        },
      }),
      options.executeAfterCreate ? 1 : 0,
      options.executeAfterCreate
        ? `74000000-0000-4000-8000-${suffix}`
        : null,
      now,
      now,
    ).run();
    return proposalId;
  };

  const proposalRunWhere =
    `source = 'issue'
     and json_extract(context_json, '$.origin') = 'briar-channel'
     and json_extract(context_json, '$.proposalId') = ?`;

  it("persists a decline and prevents later issue creation", async () => {
    const proposalId = await seedProposal(200, { executeAfterCreate: true });
    const beforeDecline = await getChannelSyncCursor(db, organizationId);

    const declined = await worker.fetch(declineRequest(proposalId), env());
    expect(declined.status).toBe(200);
    await expect(declined.json()).resolves.toEqual({ outcome: "declined" });

    const retried = await worker.fetch(declineRequest(proposalId), env());
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toEqual({
      outcome: "already_declined",
    });

    await expect(db.prepare(
      `select status, declined_by_user_id, declined_at, result_run_id
       from briar_channel_action_proposals where id = ?`,
    ).bind(proposalId).first()).resolves.toMatchObject({
      status: "pending",
      declined_by_user_id: ownerId,
      declined_at: expect.any(String),
      result_run_id: null,
    });

    const delta = await loadChannelDelta(
      db,
      organizationId,
      ownerId,
      beforeDecline,
    );
    expect(
      delta.messages.find((message) => message.proposal?.id === proposalId)
        ?.proposal?.status,
    ).toBe("declined");

    const acceptDeclined = await worker.fetch(
      request(proposalId, projectAId),
      env(),
    );
    expect(acceptDeclined.status).toBe(409);
    await expect(db.prepare(
      `select count(*) as count from briar_hunt_runs where ${proposalRunWhere}`,
    ).bind(proposalId).first()).resolves.toEqual({ count: 0 });
  });

  const seedConversationProposal = async (sequence: number) => {
    const suffix = sequence.toString(16).padStart(12, "0");
    const conversationSourceKey = `conversation-approval-${sequence}`;
    const conversationRunId = await recordHuntEvent(db, projectAId, {
      source: "issue",
      sourceKey: conversationSourceKey,
      title: `Conversation ${sequence}`,
      stage: "queued",
      status: "backlog",
      workflowStage: null,
      eventKey: `${conversationSourceKey}:backlog`,
      occurredAt: now,
      actor: "test",
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
      sourceCreatedAt: now,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: null,
    });
    const proposalId = `71000000-0000-4000-8000-${suffix}`;
    const proposal = await createIssueActionProposal(db, {
      id: proposalId,
      projectId: projectAId,
      conversationRunId,
      triggerMessageId: `72000000-0000-4000-8000-${suffix}`,
      replyMessageId: `73000000-0000-4000-8000-${suffix}`,
      actionType: "request_issue_create",
      payloadJson: JSON.stringify({
        issue: {
          title: `Conversation-approved issue ${sequence}`,
          description: "Create only; execution needs a separate approval.",
          priority: 2,
        },
      }),
      createdAt: now,
    });
    expect(proposal).not.toBeNull();
    return { conversationRunId, proposalId };
  };

  it("requires an authenticated organization member", async () => {
    const proposalId = await seedProposal(1);
    const unauthenticated = await worker.fetch(
      request(proposalId, projectAId, null),
      env(),
    );
    const outsider = await worker.fetch(
      request(proposalId, projectAId, outsiderToken),
      env(),
    );

    expect(unauthenticated.status).toBe(401);
    expect(outsider.status).toBe(404);
    await expect(
      db.prepare(
        `select count(*) as count from briar_hunt_runs
         where ${proposalRunWhere}`,
      ).bind(proposalId).first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 0 });
  });

  it("keeps the issue description unchanged and exposes its source message as structured data", async () => {
    const proposalId = await seedProposal(2);
    const accepted = await worker.fetch(request(proposalId, projectAId), env());
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json<{ resultRunId: string }>();
    const created = await db.prepare(
      `select issue_description, context_json
       from briar_hunt_runs where id = ?`,
    ).bind(acceptedBody.resultRunId).first<{
      issue_description: string | null;
      context_json: string | null;
    }>();

    expect(created?.issue_description).toBe("Create it, but do not execute it.");
    expect(created?.issue_description).not.toContain("채널 메시지로 돌아가기");
    expect(JSON.parse(created?.context_json ?? "null")).toMatchObject({
      origin: "briar-channel",
      relatedMessage: {
        organizationId,
        channelId,
        messageId: "60000000-0000-4000-8000-000000000002",
        rootMessageId: "50000000-0000-4000-8000-000000000002",
      },
    });

    const dashboard = await worker.fetch(
      new Request(
        "https://briar.example/briar.app.v1.DashboardService/GetDashboard",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${ownerToken}`,
            "connect-protocol-version": "1",
            "content-type": "application/json",
          },
          body: JSON.stringify({ projectId: projectAId }),
        },
      ),
      env(),
    );
    expect(dashboard.status).toBe(200);
    const dashboardBody = await dashboard.json<{
      runs: Array<{
        id: string;
        issueDescription: string | null;
        relatedMessage: Record<string, string> | null;
      }>;
    }>();
    expect(dashboardBody.runs.find((run) => run.id === acceptedBody.resultRunId))
      .toMatchObject({
        issueDescription: "Create it, but do not execute it.",
        relatedMessage: {
          organizationId,
          channelId,
          messageId: "60000000-0000-4000-8000-000000000002",
          rootMessageId: "50000000-0000-4000-8000-000000000002",
        },
      });
  });

  it("atomically creates a mapped issue batch and its dependency DAG", async () => {
    const payload = {
      batch: {
        items: [
          {
            key: "api",
            issue: {
              title: "Batch API",
              description: "Build the API boundary.",
              priority: 1,
            },
          },
          {
            key: "web",
            issue: {
              title: "Batch web",
              description: "Build the web client.",
              priority: 2,
            },
          },
          {
            key: "qa",
            issue: {
              title: "Batch QA",
              description: "Verify the integrated result.",
              priority: 3,
            },
          },
        ],
        dependencies: [
          { prerequisiteKey: "api", dependentKey: "web" },
          { prerequisiteKey: "web", dependentKey: "qa" },
        ],
      },
    };
    const proposalId = await seedProposal(31, { payload });
    const accepted = await worker.fetch(request(proposalId, projectAId), env());
    expect(accepted.status).toBe(200);
    const result = await accepted.json<{
      outcome: string;
      projectId: string;
      resultRunId: string;
      resultItems: Array<{ localKey: string; runId: string }>;
    }>();
    expect(result).toMatchObject({
      outcome: "accepted",
      projectId: projectAId,
      resultRunId: result.resultItems[0]?.runId,
      resultItems: [
        { localKey: "api" },
        { localKey: "web" },
        { localKey: "qa" },
      ],
    });

    const runs = await db.prepare(
      `select id, source_key, title, status, project_id
       from briar_hunt_runs
       where json_extract(context_json, '$.proposalId') = ?
       order by json_extract(context_json, '$.batchKey')`,
    ).bind(proposalId).all<{
      id: string;
      source_key: string;
      title: string;
      status: string;
      project_id: string;
    }>();
    expect(runs.results).toHaveLength(3);
    expect(new Set(runs.results.map((run) => run.source_key)).size).toBe(3);
    expect(runs.results.every(
      (run) => run.status === "backlog" && run.project_id === projectAId,
    )).toBe(true);

    const runDetails = await db.prepare(
      `select title, issue_description, context_json
       from briar_hunt_runs
       where json_extract(context_json, '$.proposalId') = ?`,
    ).bind(proposalId).all<{
      title: string;
      issue_description: string | null;
      context_json: string | null;
    }>();
    const descriptionsByTitle = new Map(
      runDetails.results.map((run) => [run.title, run.issue_description]),
    );
    expect(descriptionsByTitle).toEqual(new Map([
      ["Batch API", "Build the API boundary."],
      ["Batch QA", "Verify the integrated result."],
      ["Batch web", "Build the web client."],
    ]));
    expect(runDetails.results.every((run) => {
      const relatedMessage = JSON.parse(
        run.context_json ?? "null",
      ).relatedMessage;
      return relatedMessage?.organizationId === organizationId &&
        relatedMessage.channelId === channelId &&
        relatedMessage.messageId === "60000000-0000-4000-8000-00000000001f" &&
        relatedMessage.rootMessageId === "50000000-0000-4000-8000-00000000001f";
    })).toBe(true);

    const mappings = await db.prepare(
      `select local_key, run_id from briar_channel_issue_batch_items
       where proposal_id = ? order by position`,
    ).bind(proposalId).all<{ local_key: string; run_id: string }>();
    expect(mappings.results).toEqual(result.resultItems.map((item) => ({
      local_key: item.localKey,
      run_id: item.runId,
    })));
    const runByKey = new Map(
      result.resultItems.map((item) => [item.localKey, item.runId]),
    );
    const dependencies = await db.prepare(
      `select prerequisite_run_id, dependent_run_id
       from briar_issue_dependencies
       where project_id = ? and prerequisite_run_id in (?, ?)
       order by created_at, prerequisite_run_id`,
    ).bind(
      projectAId,
      runByKey.get("api"),
      runByKey.get("web"),
    ).all<{ prerequisite_run_id: string; dependent_run_id: string }>();
    expect(new Set(dependencies.results.map((edge) =>
      `${edge.prerequisite_run_id}:${edge.dependent_run_id}`
    ))).toEqual(new Set([
      `${runByKey.get("api")}:${runByKey.get("web")}`,
      `${runByKey.get("web")}:${runByKey.get("qa")}`,
    ]));

    const retried = await worker.fetch(request(proposalId, projectAId), env());
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({
      outcome: "already_accepted",
      resultItems: result.resultItems,
    });
    await expect(db.prepare(
      `select count(*) as count from briar_hunt_runs
       where json_extract(context_json, '$.proposalId') = ?`,
    ).bind(proposalId).first<{ count: number }>()).resolves.toEqual({ count: 3 });

    const channelBody = await listOrganizationChannelMessages({
      db,
      organizationId,
      channelId,
      userId: ownerId,
      parentMessageId: "50000000-0000-4000-8000-00000000001f",
      cursor: null,
      limit: null,
    });
    expect(
      channelBody.messages.find((message) => message.proposal?.id === proposalId)
        ?.proposal?.resultItems,
    ).toEqual(result.resultItems);
  });

  it("rolls back every batch issue and mapping when one dependency fails", async () => {
    const payload = {
      batch: {
        items: [
          {
            key: "first",
            issue: {
              title: "Rollback first",
              description: null,
              priority: 2,
            },
          },
          {
            key: "second",
            issue: {
              title: "Rollback second",
              description: null,
              priority: 2,
            },
          },
        ],
        dependencies: [
          { prerequisiteKey: "first", dependentKey: "second" },
        ],
      },
    };
    const proposalId = await seedProposal(32, { payload });
    await db.prepare(
      `create trigger test_reject_batch_dependency
       before insert on briar_issue_dependencies
       when new.created_at is not null
       begin select raise(abort, 'forced batch dependency failure'); end`,
    ).run();
    const failed = await worker.fetch(request(proposalId, projectAId), env());
    expect(failed.status).toBe(500);
    await expect(db.prepare(
      `select count(*) as count from briar_hunt_runs
       where json_extract(context_json, '$.proposalId') = ?`,
    ).bind(proposalId).first<{ count: number }>()).resolves.toEqual({ count: 0 });
    await expect(db.prepare(
      `select count(*) as count from briar_channel_issue_batch_items
       where proposal_id = ?`,
    ).bind(proposalId).first<{ count: number }>()).resolves.toEqual({ count: 0 });
    await expect(db.prepare(
      `select status, project_id from briar_channel_action_proposals
       where id = ?`,
    ).bind(proposalId).first()).resolves.toEqual({
      status: "pending",
      project_id: projectAId,
    });

    await db.prepare("drop trigger test_reject_batch_dependency").run();
    const retried = await worker.fetch(request(proposalId, projectAId), env());
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({
      outcome: "accepted",
      resultItems: [{ localKey: "first" }, { localKey: "second" }],
    });
  });

  it("rejects an invalid persisted batch before creating any issue", async () => {
    const proposalId = await seedProposal(33, {
      payload: {
        issue: {
          title: "Must not fall back to one issue",
          description: null,
          priority: 2,
        },
        batch: {
          items: [{
            key: "only",
            issue: {
              title: "Invalid batch",
              description: null,
              priority: null,
            },
          }],
          dependencies: [
            { prerequisiteKey: "missing", dependentKey: "only" },
          ],
        },
      },
    });
    const response = await worker.fetch(request(proposalId, projectAId), env());
    expect(response.status).toBe(500);
    await expect(db.prepare(
      `select count(*) as count from briar_hunt_runs
       where json_extract(context_json, '$.proposalId') = ?`,
    ).bind(proposalId).first<{ count: number }>()).resolves.toEqual({ count: 0 });
  });

  it("binds conversation approval to an opaque payload and keeps execution in backlog", async () => {
    const { conversationRunId, proposalId } =
      await seedConversationProposal(101);
    const response = await invokeIssueApplication(ownerToken, (userId) =>
      acceptProjectIssueActionProposal({
        db,
        archivesBucket: attachments,
        projectId: projectAId,
        conversationRunId,
        proposalId,
        userId,
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      outcome: string;
      resultRunId: string;
    };
    expect(body.outcome).toBe("accepted");
    const created = await db.prepare(
      `select * from briar_hunt_runs where id = ?`,
    ).bind(body.resultRunId).first<{
      source_key: string;
      status: string;
      title: string;
      issue_description: string | null;
    }>();
    expect(created).toMatchObject({
      status: "backlog",
      title: "Conversation-approved issue 101",
      issue_description: "Create only; execution needs a separate approval.",
    });
    expect(created?.source_key).toMatch(/^briar-conversation-approved:/u);
    await expect(db.prepare(
      `select result_verification, run_id
       from briar_channel_issue_approval_audit
       where proposal_id = ? and channel_id = ?`,
    ).bind(
      proposalId,
      `conversation:${conversationRunId}`,
    ).first()).resolves.toMatchObject({
      result_verification: "atomic",
      run_id: body.resultRunId,
    });
    await expect(claimNextQueuedHuntRun(db, projectAId, {
      claimTokenHash: "d".repeat(64),
      claimedBy: "unapproved-claim",
      claimedAt: "2026-08-10T00:01:00.000Z",
      leaseExpiresAt: "2026-08-10T00:11:00.000Z",
      runId: body.resultRunId,
    })).resolves.toBeNull();
    await expect(recordHuntEvent(db, projectAId, {
      source: "issue",
      sourceKey: created!.source_key,
      title: created!.title,
      stage: "queued",
      status: "queued",
      workflowStage: null,
      eventKey: `${created!.source_key}:unapproved-queue`,
      occurredAt: "2026-08-10T00:01:00.000Z",
      actor: "project-agent",
      repository: "Project A",
      detail: null,
      priority: 2,
      branch: null,
      commitSha: null,
      tracker: null,
      issueDescription: created!.issue_description,
      resultSummary: null,
      structuredResult: null,
      pullRequestUrls: [],
      targetSha: null,
      sourceCreatedAt: now,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: null,
    })).rejects.toThrow("explicit dispatch");

    const executionWorker = await registerWorker(
      projectAId,
      "conversation-terminal-reactivation",
      "2026-08-10T00:01:10.000Z",
    );
    await dispatchHuntRun(db, organizationId, projectAId, {
      runId: body.resultRunId,
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      workerId: executionWorker.worker.id,
      requestedByUserId: ownerId,
      requestId: "conversation-terminal-dispatch",
      occurredAt: "2026-08-10T00:01:20.000Z",
    });
    await db.prepare(
      `update briar_hunt_runs
       set status = 'completed', stage = 'completed',
           workflow_stage = 'implementing', completed_at = ?,
           last_event_at = ?, updated_at = ? where id = ?`,
    ).bind(
      "2026-08-10T00:01:30.000Z",
      "2026-08-10T00:01:30.000Z",
      "2026-08-10T00:01:30.000Z",
      body.resultRunId,
    ).run();

    const moveResponse = await invokeIssueApplication(ownerToken, (userId) =>
      moveProjectIssueRun({
        db,
        projectId: projectAId,
        runId: body.resultRunId,
        userId,
        request: {
          requestId: "81000000-0000-4000-8000-000000000101",
          status: "queued",
          workflowStage: null,
        },
      })
    );
    expect(moveResponse.status).toBe(409);
    await expect(reworkHuntRun(db, projectAId, {
      runId: body.resultRunId,
      workflowStage: "implementing",
      requestId: "conversation-terminal-rework",
      actor: `briar-app:${ownerId}`,
      reason: "Retry without selecting a fresh runtime.",
      occurredAt: "2026-08-10T00:01:40.000Z",
      completed: { expectedAttempt: 1, expectedRevision: 1 },
    })).rejects.toThrow(
      "Approved issue execution requires fresh approval before rework",
    );
    await expect(db.prepare(
      `select status, dispatch_request_id, requested_agent_provider,
              requested_agent_model, requested_agent_effort
       from briar_hunt_runs where id = ?`,
    ).bind(body.resultRunId).first()).resolves.toEqual({
      status: "completed",
      dispatch_request_id: "conversation-terminal-dispatch",
      requested_agent_provider: "codex",
      requested_agent_model: "gpt-5.6-sol",
      requested_agent_effort: "high",
    });
  });

  it("resets conversation-approved execution on unassign and transfer", async () => {
    const { conversationRunId, proposalId } =
      await seedConversationProposal(103);
    const accepted = await invokeIssueApplication(ownerToken, (userId) =>
      acceptProjectIssueActionProposal({
        db,
        archivesBucket: attachments,
        projectId: projectAId,
        conversationRunId,
        proposalId,
        userId,
      })
    );
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json() as { resultRunId: string };
    const sourceWorker = await registerWorker(
      projectAId,
      "conversation-reset-source",
      "2026-08-10T00:02:00.000Z",
    );
    await dispatchHuntRun(db, organizationId, projectAId, {
      runId: acceptedBody.resultRunId,
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      workerId: sourceWorker.worker.id,
      requestedByUserId: ownerId,
      requestId: "conversation-unassign-dispatch",
      occurredAt: "2026-08-10T00:02:10.000Z",
    });
    await db.prepare(
      `insert into briar_execution_audit_events (
         id, organization_id, project_id, run_id, action, request_id,
         detail_json, occurred_at
       ) values (?, ?, ?, ?, 'requeued', ?, '{}', ?)`,
    ).bind(
      "conversation-conflicting-unassign-audit",
      organizationId,
      projectAId,
      acceptedBody.resultRunId,
      "conversation-conflicting-unassign-request",
      "2026-08-10T00:02:15.000Z",
    ).run();
    await expect(unassignHuntRun(db, organizationId, projectAId, {
      runId: acceptedBody.resultRunId,
      requestedByUserId: ownerId,
      requestId: "conversation-conflicting-unassign-request",
      occurredAt: "2026-08-10T00:02:16.000Z",
    })).rejects.toThrow(
      "Worker assignment changed before it could be cancelled",
    );
    await expect(db.prepare(
      `select status, dispatch_request_id from briar_hunt_runs where id = ?`,
    ).bind(acceptedBody.resultRunId).first()).resolves.toEqual({
      status: "queued",
      dispatch_request_id: "conversation-unassign-dispatch",
    });
    await expect(unassignHuntRun(db, organizationId, projectAId, {
      runId: acceptedBody.resultRunId,
      requestedByUserId: ownerId,
      requestId: "conversation-unassign-request",
      occurredAt: "2026-08-10T00:02:20.000Z",
    })).resolves.toMatchObject({ outcome: "unassigned" });
    await expect(db.prepare(
      `select action, json_extract(detail_json, '$.reason') as reason,
              json_extract(detail_json, '$.executionApprovalReset') as reset
       from briar_execution_audit_events
       where project_id = ? and request_id = ?`,
    ).bind(
      projectAId,
      "conversation-unassign-request",
    ).first()).resolves.toEqual({
      action: "requeued",
      reason: "user_unassigned",
      reset: 1,
    });
    await expect(db.prepare(
      `select status, dispatch_request_id, requested_agent_provider,
              requested_agent_model, requested_agent_effort
       from briar_hunt_runs where id = ? and project_id = ?`,
    ).bind(acceptedBody.resultRunId, projectAId).first()).resolves.toEqual({
      status: "backlog",
      dispatch_request_id: null,
      requested_agent_provider: null,
      requested_agent_model: null,
      requested_agent_effort: null,
    });
    await expect(claimNextQueuedHuntRun(db, projectAId, {
      claimTokenHash: createHash("sha256")
        .update("conversation-unassigned-claim")
        .digest("hex"),
      claimedBy: sourceWorker.worker.label,
      claimedAt: "2026-08-10T00:02:30.000Z",
      leaseExpiresAt: leaseExpiryFrom("2026-08-10T00:02:30.000Z"),
      runId: acceptedBody.resultRunId,
      workerId: sourceWorker.worker.id,
      agentProvider: "codex",
    })).resolves.toBeNull();

    await dispatchHuntRun(db, organizationId, projectAId, {
      runId: acceptedBody.resultRunId,
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      workerId: sourceWorker.worker.id,
      requestedByUserId: ownerId,
      requestId: "conversation-transfer-dispatch",
      occurredAt: "2026-08-10T00:02:40.000Z",
    });
    await expect(transferIssue(db, {
      sourceProjectId: projectAId,
      targetProjectId: projectBId,
      targetProjectName: "Project B",
      runId: acceptedBody.resultRunId,
      observedAt: "2026-08-10T00:02:50.000Z",
    })).resolves.toBe("transferred");
    await expect(transferIssue(db, {
      sourceProjectId: projectAId,
      targetProjectId: projectBId,
      targetProjectName: "Project B",
      runId: acceptedBody.resultRunId,
      observedAt: "2026-08-10T00:02:51.000Z",
    })).resolves.toBe("transferred");
    await expect(db.prepare(
      `select status, dispatch_request_id, requested_by_user_id,
              requested_agent_provider, requested_agent_model,
              requested_agent_effort
       from briar_hunt_runs where id = ? and project_id = ?`,
    ).bind(acceptedBody.resultRunId, projectBId).first()).resolves.toEqual({
      status: "backlog",
      dispatch_request_id: null,
      requested_by_user_id: null,
      requested_agent_provider: null,
      requested_agent_model: null,
      requested_agent_effort: null,
    });
    await expect(claimNextQueuedHuntRun(db, projectBId, {
      claimTokenHash: createHash("sha256")
        .update("conversation-transferred-claim")
        .digest("hex"),
      claimedBy: "target-worker",
      claimedAt: "2026-08-10T00:03:00.000Z",
      leaseExpiresAt: leaseExpiryFrom("2026-08-10T00:03:00.000Z"),
      runId: acceptedBody.resultRunId,
      agentProvider: "codex",
    })).resolves.toBeNull();
  });

  it("rejects substituted content for a reserved conversation approval", async () => {
    const { conversationRunId, proposalId } =
      await seedConversationProposal(102);
    const issueSourceKey = `briar-conversation-approved:${"c".repeat(64)}`;
    await reserveIssueCreateProposalApproval(db, {
      projectId: projectAId,
      conversationRunId,
      proposalId,
      userId: ownerId,
      reservedAt: now,
      issueSourceKey,
    });
    await expect(recordHuntEvent(db, projectAId, {
      source: "issue",
      sourceKey: issueSourceKey,
      title: "Substituted title",
      stage: "queued",
      status: "backlog",
      workflowStage: null,
      eventKey: `${issueSourceKey}:backlog`,
      occurredAt: now,
      actor: "attacker",
      repository: "Project A",
      detail: null,
      priority: 2,
      branch: null,
      commitSha: null,
      tracker: null,
      issueDescription: "Substituted body",
      resultSummary: null,
      structuredResult: null,
      pullRequestUrls: [],
      targetSha: null,
      sourceCreatedAt: now,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: {
        origin: "briar-conversation",
        proposalId,
        conversationRunId,
        issueId: proposalId,
        attachmentCount: 0,
        fullAuto: false,
      },
      issueCheckpoints: [],
      fullAuto: false,
    })).rejects.toThrow("conversation proposal no longer belongs to project");
  });

  it("creates and dispatches exactly one issue with one authenticated approval", async () => {
    const proposalId = await seedProposal(201, { executeAfterCreate: true });
    const selected = await registerWorker(
      projectAId,
      "combined-approval",
      new Date().toISOString(),
    );
    const selection = {
      provider: "codex" as const,
      model: "gpt-5.6-sol",
      effort: "high" as const,
      workerId: selected.worker.id,
    };

    const accepted = await worker.fetch(
      request(proposalId, projectAId, ownerToken, selection),
      env(),
    );
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json<{
      outcome: string;
      projectId: string;
      resultRunId: string;
      executionProposal: { id: string; status: string };
      dispatch: { runId: string; outcome: string };
    }>();
    expect(acceptedBody).toMatchObject({
      outcome: "accepted",
      projectId: projectAId,
      executionProposal: { status: "accepted" },
      dispatch: {
        runId: acceptedBody.resultRunId,
        outcome: "dispatched",
      },
    });

    const retried = await worker.fetch(
      request(proposalId, projectAId, ownerToken, selection),
      env(),
    );
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({
      outcome: "already_accepted",
      projectId: projectAId,
      resultRunId: acceptedBody.resultRunId,
      executionProposal: {
        id: acceptedBody.executionProposal.id,
        status: "accepted",
      },
      dispatch: {
        runId: acceptedBody.resultRunId,
        outcome: "already_dispatched",
      },
    });

    await expect(db.prepare(
      `select count(*) as count from briar_hunt_runs where ${proposalRunWhere}`,
    ).bind(proposalId).first()).resolves.toEqual({ count: 1 });
    await expect(db.prepare(
      `select status, requested_agent_provider, requested_agent_model,
              requested_agent_effort, requested_worker_id
       from briar_hunt_runs where id = ?`,
    ).bind(acceptedBody.resultRunId).first()).resolves.toEqual({
      status: "queued",
      requested_agent_provider: selection.provider,
      requested_agent_model: selection.model,
      requested_agent_effort: selection.effort,
      requested_worker_id: selection.workerId,
    });
    await expect(db.prepare(
      `select count(*) as count
       from briar_issue_execution_proposals
       where origin_create_proposal_id = ?`,
    ).bind(proposalId).first()).resolves.toEqual({ count: 1 });
    await expect(db.prepare(
      `select count(*) as count
       from briar_issue_execution_approval_audit
       where proposal_id = ?`,
    ).bind(acceptedBody.executionProposal.id).first()).resolves.toEqual({
      count: 1,
    });
  });

  it("preserves the created issue and safely resumes a failed execution dispatch", async () => {
    const proposalId = await seedProposal(203, { executeAfterCreate: true });
    const selected = await registerWorker(
      projectAId,
      "combined-recovery",
      new Date().toISOString(),
    );
    const selection = {
      provider: "codex" as const,
      model: "gpt-5.6-sol",
      effort: "high" as const,
      workerId: selected.worker.id,
    };
    const escapedProposalId = proposalId.replaceAll("'", "''");
    await db.prepare(
      `create trigger test_combined_dispatch_failure
       before update of dispatch_request_id on briar_hunt_runs
       when json_extract(new.context_json, '$.proposalId') = '${escapedProposalId}'
         and new.dispatch_request_id is not null
       begin
         select raise(abort, 'simulated combined dispatch failure');
       end`,
    ).run();
    try {
      const failed = await worker.fetch(
        request(proposalId, projectAId, ownerToken, selection),
        env(),
      );
      expect(failed.status).toBe(500);
      const created = await db.prepare(
        `select id, status, dispatch_request_id
         from briar_hunt_runs where ${proposalRunWhere}`,
      ).bind(proposalId).all<{
        id: string;
        status: string;
        dispatch_request_id: string | null;
      }>();
      expect(created.results).toEqual([{
        id: expect.any(String),
        status: "backlog",
        dispatch_request_id: null,
      }]);
      await expect(db.prepare(
        `select status, dispatch_request_id
         from briar_issue_execution_proposals
         where origin_create_proposal_id = ?`,
      ).bind(proposalId).first()).resolves.toEqual({
        status: "pending",
        dispatch_request_id: expect.any(String),
      });
    } finally {
      await db.prepare("drop trigger test_combined_dispatch_failure").run();
    }

    const recovered = await worker.fetch(
      request(proposalId, projectAId, ownerToken, selection),
      env(),
    );
    expect(recovered.status).toBe(200);
    const recoveredBody = await recovered.json<{
      outcome: string;
      resultRunId: string;
      executionProposal: { status: string };
      dispatch: { outcome: string };
    }>();
    expect(recoveredBody).toMatchObject({
      outcome: "already_accepted",
      executionProposal: { status: "accepted" },
      dispatch: { outcome: "dispatched" },
    });
    await expect(db.prepare(
      `select count(*) as count from briar_hunt_runs where ${proposalRunWhere}`,
    ).bind(proposalId).first()).resolves.toEqual({ count: 1 });
  });

  it("requires fresh execution approval after a queued approved issue transfers", async () => {
    const proposalId = await seedProposal(17);
    const accepted = await worker.fetch(request(proposalId, projectAId), env());
    const acceptedBody = await accepted.json<{
      resultRunId: string;
    }>();
    const sourceWorker = await registerWorker(
      projectAId,
      "transfer-source",
      "2026-08-10T00:07:00.000Z",
    );
    const targetWorker = await registerWorker(
      projectBId,
      "transfer-target",
      "2026-08-10T00:07:00.000Z",
    );
    await dispatchHuntRun(db, organizationId, projectAId, {
      runId: acceptedBody.resultRunId,
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      workerId: sourceWorker.worker.id,
      requestedByUserId: ownerId,
      requestId: "channel-transfer-source-dispatch",
      occurredAt: "2026-08-10T00:07:30.000Z",
    });

    await expect(transferIssue(db, {
      sourceProjectId: projectAId,
      targetProjectId: projectBId,
      targetProjectName: "Project B",
      runId: acceptedBody.resultRunId,
      observedAt: "2026-08-10T00:08:00.000Z",
    })).resolves.toBe("transferred");
    await expect(db.prepare(
      `select status, stage, workflow_stage, requested_by_user_id,
              requested_agent_provider, requested_agent_model,
              requested_agent_effort, dispatch_request_id
       from briar_hunt_runs where id = ? and project_id = ?`,
    ).bind(acceptedBody.resultRunId, projectBId).first()).resolves.toEqual({
      status: "backlog",
      stage: "queued",
      workflow_stage: null,
      requested_by_user_id: null,
      requested_agent_provider: null,
      requested_agent_model: null,
      requested_agent_effort: null,
      dispatch_request_id: null,
    });
    await expect(claimNextQueuedHuntRun(db, projectBId, {
      claimTokenHash: createHash("sha256")
        .update("channel-transfer-unapproved-claim")
        .digest("hex"),
      claimedBy: targetWorker.worker.label,
      claimedAt: "2026-08-10T00:08:30.000Z",
      leaseExpiresAt: leaseExpiryFrom("2026-08-10T00:08:30.000Z"),
      runId: acceptedBody.resultRunId,
      workerId: targetWorker.worker.id,
      agentProvider: "codex",
      detachedOnly: false,
    })).resolves.toBeNull();

    await expect(dispatchHuntRun(db, organizationId, projectBId, {
      runId: acceptedBody.resultRunId,
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      workerId: targetWorker.worker.id,
      requestedByUserId: memberId,
      requestId: "channel-transfer-target-dispatch",
      occurredAt: "2026-08-10T00:09:00.000Z",
    })).resolves.toMatchObject({ outcome: "dispatched" });
    await expect(claimNextQueuedHuntRun(db, projectBId, {
      claimTokenHash: createHash("sha256")
        .update("channel-transfer-approved-claim")
        .digest("hex"),
      claimedBy: targetWorker.worker.label,
      claimedAt: "2026-08-10T00:09:30.000Z",
      leaseExpiresAt: leaseExpiryFrom("2026-08-10T00:09:30.000Z"),
      runId: acceptedBody.resultRunId,
      workerId: targetWorker.worker.id,
      agentProvider: "codex",
      detachedOnly: true,
    })).resolves.toMatchObject({ id: acceptedBody.resultRunId });
  });

  it.each(["blocked", "failed"] as const)(
    "requires fresh execution approval after a %s approved issue transfers",
    async (terminalStatus) => {
      const sequence = terminalStatus === "blocked" ? 18 : 19;
      const suffix = sequence.toString(16).padStart(12, "0");
      const proposalId = await seedProposal(sequence);
      const accepted = await worker.fetch(request(proposalId, projectAId), env());
      const acceptedBody = await accepted.json<{ resultRunId: string }>();
      const sourceWorker = await registerWorker(
        projectAId,
        `${terminalStatus}-transfer-source`,
        "2026-08-10T00:10:00.000Z",
      );
      const targetWorker = await registerWorker(
        projectBId,
        `${terminalStatus}-transfer-target`,
        "2026-08-10T00:10:00.000Z",
      );
      await dispatchHuntRun(db, organizationId, projectAId, {
        runId: acceptedBody.resultRunId,
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
        workerId: sourceWorker.worker.id,
        requestedByUserId: ownerId,
        requestId: `channel-${terminalStatus}-transfer-source-dispatch`,
        occurredAt: "2026-08-10T00:10:30.000Z",
      });
      const claimed = await claimNextQueuedHuntRun(db, projectAId, {
        claimTokenHash: createHash("sha256")
          .update(`channel-${terminalStatus}-transfer-source-claim`)
          .digest("hex"),
        claimedBy: sourceWorker.worker.label,
        claimedAt: "2026-08-10T00:11:00.000Z",
        leaseExpiresAt: leaseExpiryFrom("2026-08-10T00:11:00.000Z"),
        runId: acceptedBody.resultRunId,
        workerId: sourceWorker.worker.id,
        agentProvider: "codex",
        detachedOnly: true,
      });
      expect(claimed).not.toBeNull();
      await recordHuntEvent(db, projectAId, {
        source: "issue",
        sourceKey: claimed!.source_key,
        title: claimed!.title,
        stage: terminalStatus,
        status: terminalStatus,
        workflowStage: null,
        eventKey: `channel-${terminalStatus}-transfer:terminal`,
        occurredAt: "2026-08-10T00:11:30.000Z",
        actor: sourceWorker.worker.label,
        repository: claimed!.repository,
        detail: `Source execution ${terminalStatus}.`,
        priority: claimed!.priority,
        branch: null,
        commitSha: null,
        tracker: null,
        issueDescription: claimed!.issue_description,
        resultSummary: null,
        structuredResult: null,
        pullRequestUrls: [],
        targetSha: null,
        sourceCreatedAt: claimed!.source_created_at,
        qaStatus: null,
        stagingQaDetail: null,
        productionQaDetail: null,
        context: JSON.parse(claimed!.context_json ?? "{}") as Record<string, unknown>,
      });

      await expect(transferIssue(db, {
        sourceProjectId: projectAId,
        targetProjectId: projectBId,
        targetProjectName: "Project B",
        runId: acceptedBody.resultRunId,
        observedAt: "2026-08-10T00:12:00.000Z",
      })).resolves.toBe("transferred");
      await expect(db.prepare(
        `select project_id, repository, status, stage, workflow_stage,
                requested_by_user_id, requested_agent_provider,
                requested_agent_model, requested_agent_effort,
                dispatch_request_id, dispatched_at, worker_id,
                claim_token_hash, claimed_by, claimed_at, lease_expires_at
         from briar_hunt_runs where id = ?`,
      ).bind(acceptedBody.resultRunId).first()).resolves.toEqual({
        project_id: projectBId,
        repository: "Project B",
        status: "backlog",
        stage: "queued",
        workflow_stage: null,
        requested_by_user_id: null,
        requested_agent_provider: null,
        requested_agent_model: null,
        requested_agent_effort: null,
        dispatch_request_id: null,
        dispatched_at: null,
        worker_id: null,
        claim_token_hash: null,
        claimed_by: null,
        claimed_at: null,
        lease_expires_at: null,
      });

      const agentRetry = await worker.fetch(new Request(
        "https://briar.example/briar.worker.v1.WorkerExecutionService/RetryRun",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${projectBAgentToken}`,
            "connect-protocol-version": "1",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            projectId: projectBId,
            runId: acceptedBody.resultRunId,
            requestId: `81000000-0000-4000-8000-${suffix}`,
            reason: "Retry after transfer",
          }),
        },
      ), env());
      expect(agentRetry.status).toBe(400);
      await expect(agentRetry.json()).resolves.toMatchObject({
        code: "failed_precondition",
      });

      const userRetry = await invokeIssueApplication(memberToken, (userId) =>
        recoverProjectIssueRun({
          db,
          projectId: projectBId,
          runId: acceptedBody.resultRunId,
          action: "retry",
          userId,
          request: {
            requestId: `82000000-0000-4000-8000-${suffix}`,
            reason: "Retry after transfer",
          },
        })
      );
      expect(userRetry.status).toBe(409);
      await expect(claimNextQueuedHuntRun(db, projectBId, {
        claimTokenHash: createHash("sha256")
          .update(`channel-${terminalStatus}-transfer-unapproved-claim`)
          .digest("hex"),
        claimedBy: targetWorker.worker.label,
        claimedAt: "2026-08-10T00:12:30.000Z",
        leaseExpiresAt: leaseExpiryFrom("2026-08-10T00:12:30.000Z"),
        runId: acceptedBody.resultRunId,
        workerId: targetWorker.worker.id,
        agentProvider: "codex",
        detachedOnly: false,
      })).resolves.toBeNull();

      await expect(dispatchHuntRun(db, organizationId, projectBId, {
        runId: acceptedBody.resultRunId,
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
        workerId: targetWorker.worker.id,
        requestedByUserId: memberId,
        requestId: `channel-${terminalStatus}-transfer-target-dispatch`,
        occurredAt: "2026-08-10T00:13:00.000Z",
      })).resolves.toMatchObject({ outcome: "dispatched" });
      await expect(claimNextQueuedHuntRun(db, projectBId, {
        claimTokenHash: createHash("sha256")
          .update(`channel-${terminalStatus}-transfer-approved-claim`)
          .digest("hex"),
        claimedBy: targetWorker.worker.label,
        claimedAt: "2026-08-10T00:13:30.000Z",
        leaseExpiresAt: leaseExpiryFrom("2026-08-10T00:13:30.000Z"),
        runId: acceptedBody.resultRunId,
        workerId: targetWorker.worker.id,
        agentProvider: "codex",
        detachedOnly: true,
      })).resolves.toMatchObject({ id: acceptedBody.resultRunId });
    },
  );

  it("does not transfer a terminal channel-approved issue across execution boundaries", async () => {
    const proposalId = await seedProposal(20);
    const accepted = await worker.fetch(request(proposalId, projectAId), env());
    const acceptedBody = await accepted.json<{ resultRunId: string }>();
    const sourceWorker = await registerWorker(
      projectAId,
      "terminal-transfer-source",
      "2026-08-10T00:14:00.000Z",
    );
    await dispatchHuntRun(db, organizationId, projectAId, {
      runId: acceptedBody.resultRunId,
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      workerId: sourceWorker.worker.id,
      requestedByUserId: ownerId,
      requestId: "channel-terminal-transfer-source-dispatch",
      occurredAt: "2026-08-10T00:14:30.000Z",
    });
    await db.prepare(
      `update briar_hunt_runs
       set status = 'completed', stage = 'completed',
           workflow_stage = 'implementing', completed_at = ?,
           last_event_at = ?, updated_at = ? where id = ?`,
    ).bind(
      "2026-08-10T00:15:00.000Z",
      "2026-08-10T00:15:00.000Z",
      "2026-08-10T00:15:00.000Z",
      acceptedBody.resultRunId,
    ).run();

    await expect(transferIssue(db, {
      sourceProjectId: projectAId,
      targetProjectId: projectBId,
      targetProjectName: "Project B",
      runId: acceptedBody.resultRunId,
      observedAt: "2026-08-10T00:15:30.000Z",
    })).resolves.toBe("execution_approval_boundary");
    await expect(db.prepare(
      `update briar_hunt_runs set project_id = ? where id = ?`,
    ).bind(projectBId, acceptedBody.resultRunId).run()).rejects.toThrow(
      "channel-approved terminal issue transfer is not allowed",
    );
    await expect(moveHuntRun(db, projectAId, {
      runId: acceptedBody.resultRunId,
      status: "queued",
      workflowStage: null,
      requestId: "channel-terminal-reactivation",
      actor: `briar-app:${ownerId}`,
      occurredAt: "2026-08-10T00:15:40.000Z",
    })).rejects.toThrow(
      "Approved issue execution requires fresh approval before reactivation",
    );
    await expect(reworkHuntRun(db, projectAId, {
      runId: acceptedBody.resultRunId,
      workflowStage: "implementing",
      requestId: "channel-terminal-rework",
      actor: `briar-app:${ownerId}`,
      reason: "Retry without selecting a fresh runtime.",
      occurredAt: "2026-08-10T00:15:50.000Z",
      completed: { expectedAttempt: 1, expectedRevision: 1 },
    })).rejects.toThrow(
      "Approved issue execution requires fresh approval before rework",
    );
    await expect(db.prepare(
      `update briar_hunt_runs
       set status = 'queued', stage = 'queued', workflow_stage = null,
           completed_at = null where id = ?`,
    ).bind(acceptedBody.resultRunId).run()).rejects.toThrow(
      "approved issue terminal reactivation requires fresh execution approval",
    );
    await expect(db.prepare(
      `select project_id, status from briar_hunt_runs where id = ?`,
    ).bind(acceptedBody.resultRunId).first()).resolves.toEqual({
      project_id: projectAId,
      status: "completed",
    });
  });

  it("atomically reserves one project when approvals race and resumes after interruption", async () => {
    const proposalId = await seedProposal(3);
    const [first, second] = await Promise.all([
      reserveChannelActionProposalApproval(db, {
        organizationId,
        channelId,
        proposalId,
        projectId: projectAId,
        userId: ownerId,
        approvedAt: now,
        issueSourceKey: `briar-channel-approved:${"a".repeat(64)}`,
      }),
      reserveChannelActionProposalApproval(db, {
        organizationId,
        channelId,
        proposalId,
        projectId: projectBId,
        userId: memberId,
        approvedAt: now,
        issueSourceKey: `briar-channel-approved:${"b".repeat(64)}`,
      }),
    ]);
    const reservations = [first, second].filter(
      (result): result is NonNullable<typeof result> => result !== null,
    );

    expect(reservations).toHaveLength(1);
    const stored = await db.prepare(
      `select project_id, accepted_by_user_id, issue_source_key
       from briar_channel_action_proposals where id = ?`,
    ).bind(proposalId).first<{
      project_id: string;
      accepted_by_user_id: string;
      issue_source_key: string;
    }>();
    expect(stored).toEqual({
      project_id: reservations[0].project_id,
      accepted_by_user_id: reservations[0].accepted_by_user_id,
      issue_source_key: reservations[0].issue_source_key,
    });
    if (!stored) throw new Error("approval reservation was not stored");

    // A crash after reservation but before issue materialization leaves a
    // retryable approval. Configuration rotation must not change its identity.
    const retryToken = stored.accepted_by_user_id === ownerId
      ? memberToken
      : ownerToken;
    const resumed = await worker.fetch(
      request(proposalId, stored.project_id, retryToken),
      env("rotated-channel-proposal-test-secret-at-least-32-characters"),
    );
    expect(resumed.status).toBe(200);
    const resumedBody = await resumed.json<{
      outcome: string;
      projectId: string;
      resultRunId: string;
    }>();
    expect(resumedBody).toMatchObject({
      outcome: "accepted",
      projectId: stored.project_id,
    });
    await expect(
      db.prepare(
        `select status, project_id, accepted_by_user_id, issue_source_key
         from briar_channel_action_proposals where id = ?`,
      ).bind(proposalId).first(),
    ).resolves.toEqual({
      status: "accepted",
      project_id: stored.project_id,
      accepted_by_user_id: stored.accepted_by_user_id,
      issue_source_key: reservations[0].issue_source_key,
    });
    await expect(
      db.prepare(
        `select id, project_id, source_key from briar_hunt_runs where id = ?`,
      ).bind(resumedBody.resultRunId).first(),
    ).resolves.toEqual({
      id: resumedBody.resultRunId,
      project_id: stored.project_id,
      source_key: stored.issue_source_key,
    });
  });

  it("returns successful idempotent results for concurrent same-project approval", async () => {
    const proposalId = await seedProposal(4);
    const responses = await Promise.all([
      worker.fetch(request(proposalId, projectBId, ownerToken), env()),
      worker.fetch(request(proposalId, projectBId, memberToken), env()),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map((response) => response.json<{
      outcome: string;
      projectId: string;
      resultRunId: string;
    }>()));
    expect(new Set(bodies.map((body) => body.resultRunId)).size).toBe(1);
    expect(bodies.every((body) => body.projectId === projectBId)).toBe(true);
    expect(bodies.every(
      (body) => ["accepted", "already_accepted"].includes(body.outcome),
    )).toBe(true);
    expect(bodies.some((body) => body.outcome === "accepted")).toBe(true);
    await expect(
      db.prepare(
        `select count(*) as count from briar_hunt_runs
         where ${proposalRunWhere}`,
      ).bind(proposalId).first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 1 });
  });

  it("rejects cross-organization targets", async () => {
    const crossOrganizationProposalId = await seedProposal(5);

    const crossOrganization = await worker.fetch(
      request(crossOrganizationProposalId, otherProjectId),
      env(),
    );

    expect(crossOrganization.status).toBe(404);
  });

  it("creates an issue in only one project when different targets race", async () => {
    const proposalId = await seedProposal(8);
    const responses = await Promise.all([
      worker.fetch(request(proposalId, projectAId, ownerToken), env()),
      worker.fetch(request(proposalId, projectBId, memberToken), env()),
    ]);

    expect(responses.some((response) => response.status === 200)).toBe(true);
    expect(
      responses.every((response) => [200, 400, 409].includes(response.status)),
    ).toBe(true);
    const runs = await db.prepare(
      `select id, project_id from briar_hunt_runs where ${proposalRunWhere}`,
    ).bind(proposalId).all<{
      id: string;
      project_id: string;
    }>();
    expect(runs.results).toHaveLength(1);
    expect([projectAId, projectBId]).toContain(runs.results[0].project_id);
    await expect(
      db.prepare(
        `select status, project_id, result_run_id
         from briar_channel_action_proposals where id = ?`,
      ).bind(proposalId).first<{
        status: string;
        project_id: string;
        result_run_id: string;
      }>(),
    ).resolves.toEqual({
      status: "accepted",
      project_id: runs.results[0].project_id,
      result_run_id: runs.results[0].id,
    });
  });

  it("requires a fresh explicit approval after its project or approver is deleted", async () => {
    const deletedProjectProposalId = await seedProposal(10);
    const projectReservation = await reserveChannelActionProposalApproval(db, {
      organizationId,
      channelId,
      proposalId: deletedProjectProposalId,
      projectId: projectAId,
      userId: ownerId,
      approvedAt: now,
      issueSourceKey: `briar-channel-approved:${"c".repeat(64)}`,
    });
    expect(projectReservation).not.toBeNull();
    // Equivalent to the ON DELETE SET NULL result of deleting the target.
    await db.prepare(
      `update briar_channel_action_proposals set project_id = null where id = ?`,
    ).bind(deletedProjectProposalId).run();
    await expect(
      reserveChannelActionProposalApproval(db, {
        organizationId,
        channelId,
        proposalId: deletedProjectProposalId,
        projectId: projectBId,
        userId: memberId,
        approvedAt: "2026-08-10T00:02:00.000Z",
        issueSourceKey: `briar-channel-approved:${"d".repeat(64)}`,
      }),
    ).resolves.toMatchObject({
      project_id: projectBId,
      accepted_by_user_id: memberId,
      accepted_at: "2026-08-10T00:02:00.000Z",
      issue_source_key: `briar-channel-approved:${"d".repeat(64)}`,
    });
    const recoveredProjectApproval = await worker.fetch(
      request(deletedProjectProposalId, projectBId, memberToken),
      env(),
    );
    expect(recoveredProjectApproval.status).toBe(200);

    const deletedApproverProposalId = await seedProposal(11);
    const approverReservation = await reserveChannelActionProposalApproval(db, {
      organizationId,
      channelId,
      proposalId: deletedApproverProposalId,
      projectId: projectAId,
      userId: memberId,
      approvedAt: now,
      issueSourceKey: `briar-channel-approved:${"e".repeat(64)}`,
    });
    expect(approverReservation).not.toBeNull();
    // Equivalent to the ON DELETE SET NULL result of deleting the approver.
    await db.prepare(
      `update briar_channel_action_proposals
       set accepted_by_user_id = null where id = ?`,
    ).bind(deletedApproverProposalId).run();
    await expect(
      reserveChannelActionProposalApproval(db, {
        organizationId,
        channelId,
        proposalId: deletedApproverProposalId,
        projectId: projectAId,
        userId: ownerId,
        approvedAt: "2026-08-10T00:02:00.000Z",
        issueSourceKey: `briar-channel-approved:${"f".repeat(64)}`,
      }),
    ).resolves.toMatchObject({
      project_id: projectAId,
      accepted_by_user_id: ownerId,
      accepted_at: "2026-08-10T00:02:00.000Z",
      issue_source_key: `briar-channel-approved:${"f".repeat(64)}`,
    });
    const recoveredApproverApproval = await worker.fetch(
      request(deletedApproverProposalId, projectAId, ownerToken),
      env(),
    );
    expect(recoveredApproverApproval.status).toBe(200);
  });

  it("does not create an orphan issue after its approval record disappears", async () => {
    const proposalId = await seedProposal(12);
    const reservation = await reserveChannelActionProposalApproval(db, {
      organizationId,
      channelId,
      proposalId,
      projectId: projectAId,
      userId: ownerId,
      approvedAt: now,
      issueSourceKey: `briar-channel-approved:${"1".repeat(64)}`,
    });
    expect(reservation).not.toBeNull();
    await db.prepare(
      `delete from briar_channel_action_proposals where id = ?`,
    ).bind(proposalId).run();

    await expect(
      recordHuntEvent(db, projectAId, {
        source: "issue",
        sourceKey: reservation!.issue_source_key,
        title: "Orphan attempt",
        stage: "queued",
        status: "backlog",
        workflowStage: null,
        eventKey: "orphan-attempt:backlog:intake",
        occurredAt: now,
        actor: "briar-channel",
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
        sourceCreatedAt: now,
        qaStatus: null,
        stagingQaDetail: null,
        productionQaDetail: null,
        context: { origin: "briar-channel", proposalId, channelId },
      }),
    ).rejects.toThrow("approval reservation not found");
  });

  it("retains immutable approval evidence after the proposal record is deleted", async () => {
    const proposalId = await seedProposal(13);
    const accepted = await worker.fetch(request(proposalId, projectAId), env());
    expect(accepted.status).toBe(200);
    const result = await accepted.json<{ resultRunId: string }>();

    await db.prepare(
      `delete from briar_channel_action_proposals where id = ?`,
    ).bind(proposalId).run();
    await expect(
      db.prepare(
        `select run_id, approved_by_user_id, payload_json
         from briar_channel_issue_approval_audit where proposal_id = ?`,
      ).bind(proposalId).first(),
    ).resolves.toMatchObject({
      run_id: result.resultRunId,
      approved_by_user_id: ownerId,
      payload_json: expect.stringContaining("Approved issue 13"),
    });
  });

  it("retries accepted proposals but does not approve pending ones after archive", async () => {
    const acceptedProposalId = await seedProposal(7);
    const accepted = await worker.fetch(
      request(acceptedProposalId, projectAId),
      env(),
    );
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json<{ resultRunId: string }>();
    const pendingProposalId = await seedProposal(14);
    await db.prepare(
      `update briar_channels set archived_at = ?, updated_at = ? where id = ?`,
    ).bind(now, now, channelId).run();
    try {
      const retry = await worker.fetch(
        request(acceptedProposalId, projectAId),
        env(),
      );
      expect(retry.status).toBe(200);
      await expect(retry.json()).resolves.toEqual({
        outcome: "already_accepted",
        projectId: projectAId,
        resultRunId: acceptedBody.resultRunId,
        executionProposal: null,
      });
      const pending = await worker.fetch(
        request(pendingProposalId, projectAId),
        env(),
      );
      expect(pending.status).toBe(409);
      await expect(
        db.prepare(
          `select count(*) as count from briar_hunt_runs
           where ${proposalRunWhere}`,
        ).bind(pendingProposalId).first<{ count: number }>(),
      ).resolves.toMatchObject({ count: 0 });
    } finally {
      await db.prepare(
        `update briar_channels set archived_at = null, updated_at = ? where id = ?`,
      ).bind(now, channelId).run();
    }
  });
});
