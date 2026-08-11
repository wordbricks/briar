import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createChannel,
  createChannelMessage,
  getChannelSyncCursor,
  loadChannelDelta,
  reserveChannelActionProposalApproval,
} from "./channels";
import worker from "./index";
import { createOrganizationAgent } from "./organization-agents";
import {
  claimNextQueuedHuntRun,
  createIssueActionProposal,
  createIssueAttachments,
  moveHuntRun,
  reworkHuntRun,
  reserveIssueCreateProposalApproval,
  recordHuntEvent,
  transferIssue,
} from "./db";
import { applyD1Migrations } from "./test-helpers/d1";
import { mobileAcceptIssueActionProposalResponseSchema } from "./mobile-contract";
import {
  dispatchHuntRun,
  leaseExpiryFrom,
  registerExecutionWorker,
  unassignHuntRun,
} from "./workers";

const organizationId = "10000000-0000-4000-8000-000000000001";
const otherOrganizationId = "10000000-0000-4000-8000-000000000002";
const projectAId = "20000000-0000-4000-8000-000000000001";
const projectBId = "20000000-0000-4000-8000-000000000002";
const otherProjectId = "20000000-0000-4000-8000-000000000003";
const channelId = "30000000-0000-4000-8000-000000000001";
const agentId = "40000000-0000-4000-8000-000000000001";
const ownerId = "proposal-owner";
const memberId = "proposal-member";
const outsiderId = "proposal-outsider";
const ownerToken = "channel-proposal-owner-token";
const memberToken = "channel-proposal-member-token";
const outsiderToken = "channel-proposal-outsider-token";
const projectAgentToken = "briar_agent_channel_proposal_test";
const projectBAgentToken = "briar_agent_channel_proposal_target_test";
const now = "2026-08-10T00:00:00.000Z";

describe("channel issue proposal approval route", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-channel-proposal-routes-test" },
    r2Buckets: ["ATTACHMENTS"],
  });
  let db: D1Database;
  let attachments: R2Bucket;

  beforeAll(async () => {
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    attachments = await miniflare.getR2Bucket(
      "ATTACHMENTS",
    ) as unknown as R2Bucket;
    await applyD1Migrations(db);

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
         ) values (?, ?, 'member', ?, ?)`,
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
    await createChannel(db, {
      id: channelId,
      organizationId,
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
  }, 60_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

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
    providers: ["codex"],
    providerHealth: {
      codex: { installed: true, authenticated: true, healthy: true },
    },
    versions: { briar: "1.0.0" },
    observedAt,
  });

  const request = (
    proposalId: string,
    projectId: string | null,
    token: string | null = ownerToken,
  ) =>
    new Request(
      `https://briar.example/organizations/${organizationId}/channels/${channelId}/proposals/${proposalId}/accept`,
      {
        method: "POST",
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({ projectId }),
      },
    );

  const seedProposal = async (
    sequence: number,
    options: {
      actionType?: "request_issue_create" | "request_plan_document";
      projectId?: string | null;
    } = {},
  ) => {
    const suffix = sequence.toString(16).padStart(12, "0");
    const triggerId = `50000000-0000-4000-8000-${suffix}`;
    const replyId = `60000000-0000-4000-8000-${suffix}`;
    const proposalId = `70000000-0000-4000-8000-${suffix}`;
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
      authorAgentId: agentId,
      authorAgentName: "Bumble",
      authorAgentProvider: "codex",
      body: `Issue proposal ${sequence}`,
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: now,
    });
    await db.prepare(
      `insert into briar_channel_action_proposals (
         id, channel_id, project_id, trigger_message_id, reply_message_id,
         action_type, payload_json, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      proposalId,
      channelId,
      options.projectId ?? null,
      triggerId,
      replyId,
      options.actionType ?? "request_issue_create",
      JSON.stringify({
        issue: {
          title: `Approved issue ${sequence}`,
          description: "Create it, but do not execute it.",
          priority: 2,
          status: "backlog",
        },
      }),
      now,
      now,
    ).run();
    return proposalId;
  };

  const proposalRunWhere =
    `source = 'issue'
     and json_extract(context_json, '$.origin') = 'briar-channel'
     and json_extract(context_json, '$.proposalId') = ?`;

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
          status: "backlog",
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

  it("prevents a project agent from preempting the approval identity namespace", async () => {
    for (const [index, sourceKey] of [
      `briar-channel-approved:${"f".repeat(64)}`,
      "briar-channel-proposal:legacy-channel",
      `briar-conversation-approved:${"e".repeat(64)}`,
      "briar-conversation-proposal:legacy-conversation",
    ].entries()) {
      const response = await worker.fetch(
        new Request("https://briar.example/run-events", {
          method: "POST",
          headers: {
            authorization: `Bearer ${projectAgentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            source: "issue",
            sourceKey,
            title: "Preempted approval",
            status: "backlog",
            eventKey: `preempted-approval:${index}:backlog:intake`,
            occurredAt: now,
            actor: "project-agent",
            repository: "Project A",
          }),
        }),
        env(),
      );
      expect(response.status).toBe(403);
    }
    await expect(
      db.prepare(
        `select count(*) as count from briar_hunt_runs
         where source_key = ?`,
      ).bind(`briar-channel-approved:${"f".repeat(64)}`).first<{
        count: number;
      }>(),
    ).resolves.toMatchObject({ count: 0 });
  });

  it("binds conversation approval to an opaque payload and keeps execution in backlog", async () => {
    const { conversationRunId, proposalId } =
      await seedConversationProposal(101);
    const response = await worker.fetch(
      new Request(
        `https://briar.example/projects/${projectAId}/runs/${conversationRunId}/issue-action-proposals/${proposalId}/accept`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}` },
        },
      ),
      env(),
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

    const moveResponse = await worker.fetch(
      new Request(
        `https://briar.example/projects/${projectAId}/runs/${body.resultRunId}/status`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${ownerToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            requestId: "81000000-0000-4000-8000-000000000101",
            status: "queued",
            workflowStage: null,
          }),
        },
      ),
      env(),
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

  it("serializes executeAfterCreate only for create proposals and keeps update retries exact", async () => {
    const { conversationRunId } = await seedConversationProposal(120);
    const updateProposalId = "71000000-0000-4000-8000-000000000102";
    const updateProposal = await createIssueActionProposal(db, {
      id: updateProposalId,
      projectId: projectAId,
      conversationRunId,
      triggerMessageId: "72000000-0000-4000-8000-000000000102",
      replyMessageId: "73000000-0000-4000-8000-000000000102",
      actionType: "request_issue_update",
      payloadJson: JSON.stringify({
        changes: { description: "Approved updated description." },
      }),
      createdAt: now,
    });
    expect(updateProposal).not.toBeNull();
    const url =
      `https://briar.example/projects/${projectAId}/runs/${conversationRunId}` +
      `/issue-action-proposals/${updateProposalId}/accept`;

    const accepted = await worker.fetch(new Request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
    }), env());
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json();
    expect(mobileAcceptIssueActionProposalResponseSchema.parse(acceptedBody))
      .toEqual({
        proposal: {
          id: updateProposalId,
          type: "request_issue_update",
          changes: { description: "Approved updated description." },
          changedFields: ["description"],
          status: "accepted",
          acceptedAt: expect.any(String),
          resultRunId: conversationRunId,
        },
        outcome: "accepted",
        resultRunId: conversationRunId,
      });
    expect((acceptedBody as { proposal: Record<string, unknown> }).proposal)
      .not.toHaveProperty("executeAfterCreate");

    const retried = await worker.fetch(new Request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
    }), env());
    expect(retried.status).toBe(200);
    const retriedBody = await retried.json();
    expect(mobileAcceptIssueActionProposalResponseSchema.parse(retriedBody))
      .toEqual({
        proposal: {
          id: updateProposalId,
          type: "request_issue_update",
          changes: { description: "Approved updated description." },
          changedFields: ["description"],
          status: "accepted",
          acceptedAt: expect.any(String),
          resultRunId: conversationRunId,
        },
        executionProposal: null,
        outcome: "already_accepted",
        resultRunId: conversationRunId,
      });
    expect((retriedBody as { proposal: Record<string, unknown> }).proposal)
      .not.toHaveProperty("executeAfterCreate");
  });

  it("resets conversation-approved execution on unassign and transfer", async () => {
    const { conversationRunId, proposalId } =
      await seedConversationProposal(103);
    const accepted = await worker.fetch(
      new Request(
        `https://briar.example/projects/${projectAId}/runs/${conversationRunId}/issue-action-proposals/${proposalId}/accept`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken}` },
        },
      ),
      env(),
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

  it("fails closed when an old Worker tries to create a pending legacy issue", async () => {
    const proposalId = await seedProposal(15);
    await expect(
      recordHuntEvent(db, projectAId, {
        source: "issue",
        sourceKey: `briar-channel-proposal:${proposalId}`,
        title: "Old queued proposal",
        stage: "queued",
        status: "queued",
        workflowStage: null,
        eventKey: "old-worker:queued:intake",
        occurredAt: now,
        actor: "old-worker",
        repository: "Project A",
        detail: null,
        priority: 2,
        branch: null,
        commitSha: null,
        tracker: null,
        issueDescription: "Must not execute before approval.",
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
    ).rejects.toThrow("legacy channel proposal issue creation is disabled");
  });

  it("creates one backlog issue only after approval and makes retries idempotent", async () => {
    const proposalId = await seedProposal(2);
    const beforeApproval = await getChannelSyncCursor(db, organizationId);
    const accepted = await worker.fetch(
      request(proposalId, projectAId),
      env(),
    );
    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json<{
      outcome: string;
      projectId: string;
      resultRunId: string;
    }>();
    expect(acceptedBody).toMatchObject({
      outcome: "accepted",
      projectId: projectAId,
    });

    const retried = await worker.fetch(
      request(proposalId, projectAId, memberToken),
      env(),
    );
    await expect(retried.json()).resolves.toEqual({
      outcome: "already_accepted",
      projectId: projectAId,
      resultRunId: acceptedBody.resultRunId,
      executionProposal: null,
    });

    const runs = await db.prepare(
      `select source_key, project_id, status, workflow_stage,
              preferred_agent_provider, preferred_agent_model,
              preferred_agent_effort
       from briar_hunt_runs where ${proposalRunWhere}`,
    ).bind(proposalId).all<{
      source_key: string;
      project_id: string;
      status: string;
      workflow_stage: string | null;
      preferred_agent_provider: string | null;
      preferred_agent_model: string | null;
      preferred_agent_effort: string | null;
    }>();
    expect(runs.results).toEqual([{
      source_key: expect.stringMatching(/^briar-channel-approved:[0-9a-f]{64}$/u),
      project_id: projectAId,
      status: "backlog",
      workflow_stage: null,
      preferred_agent_provider: null,
      preferred_agent_model: null,
      preferred_agent_effort: null,
    }]);
    await expect(
      db.prepare(
        `select accepted_by_user_id from briar_channel_action_proposals
         where id = ?`,
      ).bind(proposalId).first<{ accepted_by_user_id: string }>(),
    ).resolves.toEqual({ accepted_by_user_id: ownerId });
    const delta = await loadChannelDelta(
      db,
      organizationId,
      ownerId,
      beforeApproval,
    );
    expect(delta.messages).toContainEqual(
      expect.objectContaining({
        proposal: expect.objectContaining({
          id: proposalId,
          status: "accepted",
          projectId: projectAId,
          resultRunId: acceptedBody.resultRunId,
        }),
      }),
    );
    const approvedSourceKey = runs.results[0].source_key;
    expect(approvedSourceKey).not.toContain(proposalId);
    await expect(
      db.prepare(
        `select organization_id, channel_id, project_id, run_id,
                approved_by_user_id, approved_at, issue_source_key, payload_json
         from briar_channel_issue_approval_audit where proposal_id = ?`,
      ).bind(proposalId).first(),
    ).resolves.toEqual({
      organization_id: organizationId,
      channel_id: channelId,
      project_id: projectAId,
      run_id: acceptedBody.resultRunId,
      approved_by_user_id: ownerId,
      approved_at: expect.any(String),
      issue_source_key: approvedSourceKey,
      payload_json: JSON.stringify({
        issue: {
          title: "Approved issue 2",
          description: "Create it, but do not execute it.",
          priority: 2,
          status: "backlog",
        },
      }),
    });
    for (const transition of [
      { status: "queued" as const, stage: "queued" as const, workflowStage: null },
      {
        status: "running" as const,
        stage: "analyzing" as const,
        workflowStage: "analyzing" as const,
      },
    ]) {
      await expect(recordHuntEvent(db, projectAId, {
        source: "issue",
        sourceKey: approvedSourceKey,
        title: "Old Worker must not execute",
        stage: transition.stage,
        status: transition.status,
        workflowStage: transition.workflowStage,
        eventKey: `old-worker:${transition.status}`,
        occurredAt: "2026-08-10T00:00:30.000Z",
        actor: "old-worker",
        repository: "Project A",
        detail: null,
        priority: 2,
        branch: null,
        commitSha: null,
        tracker: null,
        issueDescription: "Create it, but do not execute it.",
        resultSummary: null,
        structuredResult: null,
        pullRequestUrls: [],
        targetSha: null,
        sourceCreatedAt: now,
        qaStatus: null,
        stagingQaDetail: null,
        productionQaDetail: null,
        context: { origin: "briar-channel", fullAuto: true },
      })).rejects.toThrow(
        "channel-approved issue execution requires explicit dispatch",
      );
    }
    await expect(db.prepare(
      `update briar_hunt_runs
       set status = 'queued', stage = 'queued', workflow_stage = null
       where id = ?`,
    ).bind(acceptedBody.resultRunId).run()).rejects.toThrow(
      "channel-approved issue execution requires explicit dispatch",
    );
    await expect(db.prepare(
      `update briar_hunt_runs set context_json = '{"fullAuto":true}'
       where id = ?`,
    ).bind(acceptedBody.resultRunId).run()).rejects.toThrow(
      "channel-approved issue context is immutable before dispatch",
    );
    await expect(db.prepare(
      `select status,
              (select count(*) from briar_hunt_events event
               where event.run_id = run.id) as event_count
       from briar_hunt_runs run where id = ?`,
    ).bind(acceptedBody.resultRunId).first()).resolves.toEqual({
      status: "backlog",
      event_count: 1,
    });
    // Use a second approved issue for terminal-state checks so the primary
    // backlog issue can still exercise the separate transfer flow below.
    const cancelledProposalId = await seedProposal(21);
    const cancelledAcceptance = await worker.fetch(
      request(cancelledProposalId, projectAId),
      env(),
    );
    expect(cancelledAcceptance.status).toBe(200);
    const cancelledBody = await cancelledAcceptance.json<{
      resultRunId: string;
    }>();
    const cancelledRun = await db.prepare(
      `select source_key, title, repository, priority, issue_description,
              source_created_at, context_json
       from briar_hunt_runs where id = ?`,
    ).bind(cancelledBody.resultRunId).first<{
      source_key: string;
      title: string;
      repository: string;
      priority: number | null;
      issue_description: string | null;
      source_created_at: string | null;
      context_json: string;
    }>();
    if (!cancelledRun) throw new Error("Expected approved run");
    await expect(recordHuntEvent(db, projectAId, {
      source: "issue",
      sourceKey: cancelledRun.source_key,
      title: cancelledRun.title,
      stage: "cancelled",
      status: "cancelled",
      workflowStage: null,
      eventKey: "approved-user:cancelled",
      occurredAt: "2026-08-10T00:00:40.000Z",
      actor: "briar-app",
      repository: cancelledRun.repository,
      detail: "User cancelled the backlog issue.",
      priority: cancelledRun.priority,
      branch: null,
      commitSha: null,
      tracker: null,
      issueDescription: cancelledRun.issue_description,
      resultSummary: null,
      structuredResult: null,
      pullRequestUrls: [],
      targetSha: null,
      sourceCreatedAt: cancelledRun.source_created_at,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: JSON.parse(cancelledRun.context_json) as Record<string, unknown>,
    })).resolves.toBe(cancelledBody.resultRunId);
    await expect(db.prepare(
      `insert into briar_hunt_events (
         id, run_id, event_key, attempt, revision, stage, status,
         workflow_stage, detail, actor, branch, commit_sha, qa_status,
         tracker_issue_state, pull_request_urls, target_sha,
         occurred_at, recorded_at
       ) select 'cancelled-bypass-event', id, 'cancelled-bypass:running',
                current_attempt, current_revision, 'analyzing', 'running',
                'analyzing', null, 'old-worker', null, null, null, null,
                '[]', null, ?, ?
         from briar_hunt_runs where id = ?`,
    ).bind(
      "2026-08-10T00:00:50.000Z",
      "2026-08-10T00:00:50.000Z",
      cancelledBody.resultRunId,
    ).run()).rejects.toThrow(
      "channel-approved issue execution requires explicit dispatch",
    );
    await expect(db.prepare(
      `update briar_hunt_runs set context_json = '{"fullAuto":true}'
       where id = ?`,
    ).bind(cancelledBody.resultRunId).run()).rejects.toThrow(
      "channel-approved issue context is immutable before dispatch",
    );
    await expect(db.prepare(
      `update briar_hunt_runs
       set status = 'running', stage = 'analyzing', workflow_stage = 'analyzing',
           completed_at = null where id = ?`,
    ).bind(cancelledBody.resultRunId).run()).rejects.toThrow(
      "channel-approved issue execution requires explicit dispatch",
    );
    await expect(db.prepare(
      `update briar_hunt_runs
       set status = 'backlog', stage = 'queued', workflow_stage = null,
           completed_at = null, updated_at = ? where id = ?`,
    ).bind("2026-08-10T00:00:55.000Z", cancelledBody.resultRunId).run())
      .rejects.toThrow(
        "approved issue terminal reactivation requires fresh execution approval",
      );
    // A delayed pre-upgrade Worker must not materialize its predictable legacy
    // identity after the new atomic approval has already committed.
    await expect(
      recordHuntEvent(db, projectAId, {
        source: "issue",
        sourceKey: `briar-channel-proposal:${proposalId}`,
        title: "Delayed legacy Worker issue",
        stage: "queued",
        status: "backlog",
        workflowStage: null,
        eventKey: "delayed-legacy-worker:backlog:intake",
        occurredAt: now,
        actor: "legacy-worker",
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
      }),
    ).rejects.toThrow("legacy channel proposal issue creation is disabled");
    await expect(
      recordHuntEvent(db, projectBId, {
        source: "issue",
        sourceKey: approvedSourceKey,
        title: "Conflicting old Worker issue",
        stage: "queued",
        status: "backlog",
        workflowStage: null,
        eventKey: "conflicting-old-worker:backlog:intake",
        occurredAt: now,
        actor: "test",
        repository: "Project B",
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
      }),
    ).rejects.toThrow(
      /channel proposal (issue project conflict|approval reservation not found)/u,
    );

    await createIssueAttachments(db, projectAId, acceptedBody.resultRunId, [{
      id: "channel-transfer-repair-attachment",
      object_key: "issue-attachments/channel-transfer-repair.png",
      filename: "repair.png",
      content_type: "image/png",
      byte_size: 6,
    }]);
    const beforeTransfer = await getChannelSyncCursor(db, organizationId);
    await expect(
      transferIssue(db, {
        sourceProjectId: projectAId,
        targetProjectId: projectBId,
        targetProjectName: "Project B",
        runId: acceptedBody.resultRunId,
        observedAt: "2026-08-10T00:01:00.000Z",
      }),
    ).resolves.toBe("transferred");
    const transferDelta = await loadChannelDelta(
      db,
      organizationId,
      ownerId,
      beforeTransfer,
    );
    expect(transferDelta.messages).toContainEqual(
      expect.objectContaining({
        proposal: expect.objectContaining({
          id: proposalId,
          status: "accepted",
          projectId: projectBId,
          resultRunId: acceptedBody.resultRunId,
        }),
      }),
    );
    // Simulate a Worker stopping after the run moved but before the accepted
    // proposal/child repair batch completed. A source-project retry must repair
    // the proposal deep-link instead of returning early.
    await db.prepare(
      `update briar_channel_action_proposals
       set project_id = ? where id = ?`,
    ).bind(projectAId, proposalId).run();
    await db.prepare(
      `update briar_issue_attachments set project_id = ? where id = ?`,
    ).bind(projectAId, "channel-transfer-repair-attachment").run();
    await expect(
      transferIssue(db, {
        sourceProjectId: projectAId,
        targetProjectId: projectBId,
        targetProjectName: "Project B",
        runId: acceptedBody.resultRunId,
        observedAt: "2026-08-10T00:01:30.000Z",
      }),
    ).resolves.toBe("transferred");
    await expect(db.prepare(
      `select project_id from briar_issue_attachments where id = ?`,
    ).bind("channel-transfer-repair-attachment").first()).resolves.toEqual({
      project_id: projectBId,
    });
    const afterTransferRetry = await worker.fetch(
      request(proposalId, projectBId, memberToken),
      env(),
    );
    await expect(afterTransferRetry.json()).resolves.toEqual({
      outcome: "already_accepted",
      projectId: projectBId,
      resultRunId: acceptedBody.resultRunId,
      executionProposal: null,
    });
    await expect(transferIssue(db, {
      sourceProjectId: projectBId,
      targetProjectId: projectAId,
      targetProjectName: "Project A",
      runId: acceptedBody.resultRunId,
      observedAt: "2026-08-10T00:01:40.000Z",
    })).resolves.toBe("transferred");
    // The source-project dashboard tombstone is durable provenance for an
    // idempotent retry even though the immutable creation audit still names A.
    await expect(transferIssue(db, {
      sourceProjectId: projectBId,
      targetProjectId: projectAId,
      targetProjectName: "Project A",
      runId: acceptedBody.resultRunId,
      observedAt: "2026-08-10T00:01:50.000Z",
    })).resolves.toBe("transferred");
  });

  it("allows the approved provider/model/effort dispatch and Worker lifecycle", async () => {
    const proposalId = await seedProposal(16);
    const accepted = await worker.fetch(request(proposalId, projectAId), env());
    const acceptedBody = await accepted.json<{
      outcome: string;
      projectId: string;
      resultRunId: string;
    }>();
    expect(acceptedBody.outcome).toBe("accepted");

    const observedAt = "2026-08-10T00:05:00.000Z";
    const selected = await registerExecutionWorker(db, projectAId, {
      id: "channel-approval-worker",
      deviceId: "channel-approval-device",
      organizationId,
      ownerUserId: ownerId,
      label: "Channel approval Worker",
      deviceIdentityHash: createHash("sha256")
        .update("channel-approval-device")
        .digest("hex"),
      credentialTokenHash: createHash("sha256")
        .update("channel-approval-credential")
        .digest("hex"),
      agentProvider: "codex",
      providers: ["codex"],
      providerHealth: {
        codex: { installed: true, authenticated: true, healthy: true },
      },
      versions: { briar: "1.0.0" },
      observedAt,
    });
    await db.prepare(
      `update briar_hunt_runs
       set preferred_agent_provider = 'claude',
           preferred_agent_model = 'claude-opus-4-1',
           preferred_agent_effort = 'xhigh'
       where id = ?`,
    ).bind(acceptedBody.resultRunId).run();
    const dispatchedAt = "2026-08-10T00:05:30.000Z";
    await expect(dispatchHuntRun(db, organizationId, projectAId, {
      runId: acceptedBody.resultRunId,
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      persistPreferences: false,
      workerId: selected.worker.id,
      requestedByUserId: ownerId,
      requestId: "channel-approval-dispatch-request",
      occurredAt: dispatchedAt,
    })).resolves.toMatchObject({
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      requestedWorkerId: selected.worker.id,
      outcome: "dispatched",
    });
    await expect(db.prepare(
      `select requested_agent_provider, requested_agent_model,
              requested_agent_effort, preferred_agent_provider,
              preferred_agent_model, preferred_agent_effort
       from briar_hunt_runs where id = ?`,
    ).bind(acceptedBody.resultRunId).first()).resolves.toEqual({
      requested_agent_provider: "codex",
      requested_agent_model: "gpt-5.6-sol",
      requested_agent_effort: "high",
      preferred_agent_provider: "codex",
      preferred_agent_model: "gpt-5.6-sol",
      preferred_agent_effort: "high",
    });
    await expect(db.prepare(
      `update briar_hunt_runs
       set preferred_agent_provider = 'claude',
           preferred_agent_model = 'claude-opus-4-1'
       where id = ?`,
    ).bind(acceptedBody.resultRunId).run()).rejects.toThrow(
      "approved channel issue dispatch preferences are immutable",
    );

    const claimedAt = "2026-08-10T00:06:00.000Z";
    const claimed = await claimNextQueuedHuntRun(db, projectAId, {
      claimTokenHash: createHash("sha256")
        .update("channel-approval-claim")
        .digest("hex"),
      claimedBy: selected.worker.label,
      claimedAt,
      leaseExpiresAt: leaseExpiryFrom(claimedAt),
      runId: acceptedBody.resultRunId,
      workerId: selected.worker.id,
      agentProvider: "codex",
      detachedOnly: true,
    });
    expect(claimed).toMatchObject({
      id: acceptedBody.resultRunId,
      status: "queued",
      requested_agent_provider: "codex",
      requested_agent_model: "gpt-5.6-sol",
      requested_agent_effort: "high",
      worker_id: selected.worker.id,
    });

    await expect(recordHuntEvent(db, projectAId, {
      source: "issue",
      sourceKey: claimed!.source_key,
      title: claimed!.title,
      stage: "analyzing",
      status: "running",
      workflowStage: "analyzing",
      eventKey: "channel-approval-worker:analyzing",
      occurredAt: "2026-08-10T00:06:30.000Z",
      actor: selected.worker.label,
      repository: claimed!.repository,
      detail: "Explicitly approved execution started.",
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
    })).resolves.toBe(acceptedBody.resultRunId);
    await expect(db.prepare(
      `select status, workflow_stage from briar_hunt_runs where id = ?`,
    ).bind(acceptedBody.resultRunId).first()).resolves.toEqual({
      status: "running",
      workflow_stage: "analyzing",
    });
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
        `https://briar.example/runs/${acceptedBody.resultRunId}/retry`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${projectBAgentToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            requestId: `81000000-0000-4000-8000-${suffix}`,
            actor: "target-project-agent",
            reason: "Retry after transfer",
          }),
        },
      ), env());
      expect(agentRetry.status).toBe(409);

      const userRetry = await worker.fetch(new Request(
        `https://briar.example/projects/${projectBId}/runs/${acceptedBody.resultRunId}/retry`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${memberToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            requestId: `82000000-0000-4000-8000-${suffix}`,
            reason: "Retry after transfer",
          }),
        },
      ), env());
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

  it("rejects cross-organization targets and non-issue action types", async () => {
    const crossOrganizationProposalId = await seedProposal(5);
    const wrongActionProposalId = await seedProposal(6, {
      actionType: "request_plan_document",
    });

    const crossOrganization = await worker.fetch(
      request(crossOrganizationProposalId, otherProjectId),
      env(),
    );
    const wrongAction = await worker.fetch(
      request(wrongActionProposalId, projectAId),
      env(),
    );

    expect(crossOrganization.status).toBe(404);
    expect(wrongAction.status).toBe(409);
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
