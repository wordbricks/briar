import { Code, createClient, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  AgentService,
  AgentSkillApprovalPolicy,
  AgentSkillExecutionMode,
  AgentSkillKind,
  ProjectAgentSessionEventType,
  ProjectAgentSessionStatus,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import { emptyAgentProviderCapabilityCatalog } from "../../src/lib/agent-provider-contract";
import { workerRuntimeProtoJsonFixture } from "./test-helpers/worker-runtime";

describe("AgentService mutations", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const otherProjectId = "33333333-3333-4333-8333-333333333333";
  const ownerId = "agent-connect-owner";
  const developerId = "agent-connect-developer";
  const editorId = "agent-connect-editor";
  const viewerId = "agent-connect-viewer";
  const now = "2026-08-31T00:00:00.000Z";
  const db = env.DB;

  const tokens = {
    owner: "agent-connect-owner-token",
    developer: "agent-connect-developer-token",
    editor: "agent-connect-editor-token",
    viewer: "agent-connect-viewer-token",
  } as const;

  beforeAll(async () => {
    const users = [
      [ownerId, "Owner", "owner@example.com", "owner", tokens.owner],
      [developerId, "Developer", "developer@example.com", "developer", tokens.developer],
      [editorId, "Editor", "editor@example.com", "editor", tokens.editor],
      [viewerId, "Viewer", "viewer@example.com", "viewer", tokens.viewer],
    ] as const;
    for (const [userId, name, email, role, token] of users) {
      await db.batch([
        db
          .prepare(
            `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
          )
          .bind(userId, name, email, now, now),
        db
          .prepare(
            `insert into "session" (
             id, expiresAt, token, createdAt, updatedAt, userId
           ) values (?, '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
          )
          .bind(`session-${role}`, token, now, now, userId),
      ]);
    }
    await db.batch([
      db
        .prepare(
          `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Agent Connect', 'agent-connect', ?, ?)`,
        )
        .bind(organizationId, now, now),
      ...users.map(([userId, _name, _email, role]) =>
        db
          .prepare(
            `insert into briar_organization_members (
             organization_id, user_id, role, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
          )
          .bind(organizationId, userId, role, now, now),
      ),
      db
        .prepare(
          `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Agent Connect', ?, ?, ?)`,
        )
        .bind(projectId, ownerId, organizationId, "a".repeat(64), now, now),
      db
        .prepare(
          `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Other Project', ?, ?, ?)`,
        )
        .bind(otherProjectId, ownerId, organizationId, "b".repeat(64), now, now),
      ...[developerId, editorId, viewerId].map((userId) =>
        db
          .prepare(
            `insert into briar_project_members (
             project_id, organization_id, user_id, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
          )
          .bind(projectId, organizationId, userId, now, now),
      ),
    ]);
  }, 60_000);

  const client = (token: string) =>
    createClient(
      AgentService,
      createConnectTransport({
        baseUrl: "https://briar.example",
        fetch: async (input, init) =>
          worker.fetch(new Request(input, { ...init, redirect: "manual" }), {
            DB: db,
            ATTACHMENTS: {},
            ARCHIVES: {},
            BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
            GOOGLE_CLIENT_ID: "google-client",
            GOOGLE_CLIENT_SECRET: "google-secret",
          } as never),
      }),
    );

  const options = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  const createInput = {
    projectId,
    name: "Capability Agent",
    provider: AgentProvider.CODEX,
    responsibility: "Verify development authorization.",
    skills: [],
    calendarColor: "#3b82f6",
  };

  it("allows development managers and rejects editor or viewer mutations", async () => {
    await expect(
      client(tokens.developer).createProjectAgent(createInput, options(tokens.developer)),
    ).resolves.toMatchObject({
      agent: { name: "Capability Agent" },
    });

    for (const token of [tokens.editor, tokens.viewer]) {
      const error = await client(token)
        .createProjectAgent(createInput, options(token))
        .catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.PermissionDenied);
    }
  });

  it("rejects unspecified Skill execution contracts", async () => {
    const validSkill = {
      name: "Issue processing",
      description: "Use for queued project issues.",
      body: "Process queued issues.",
      provider: AgentProvider.CODEX,
      kind: AgentSkillKind.ISSUE_PROCESSING,
      executionMode: AgentSkillExecutionMode.TASK,
      approvalPolicy: AgentSkillApprovalPolicy.EXPLICIT,
      position: 0,
    };
    const malformedSkills = [
      {
        ...validSkill,
        executionMode: AgentSkillExecutionMode.UNSPECIFIED,
      },
      {
        ...validSkill,
        approvalPolicy: AgentSkillApprovalPolicy.UNSPECIFIED,
      },
    ];

    for (const [index, skill] of malformedSkills.entries()) {
      const error = await client(tokens.owner)
        .createProjectAgent(
          {
            ...createInput,
            name: `Invalid Skill Agent ${index}`,
            skills: [skill],
          },
          options(tokens.owner),
        )
        .catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    }
  });

  it("validates Designated Workers and preserves or clears explicit update state", async () => {
    const deviceId = "44444444-4444-4444-8444-444444444444";
    const workerId = "designated-worker";
    const otherWorkerId = "other-project-worker";
    const observedAt = new Date().toISOString();
    const runtimeProtoJson = workerRuntimeProtoJsonFixture({
      providers: ["codex"],
      providerCapabilities: {
        ...emptyAgentProviderCapabilityCatalog(),
        codex: {
          models: [],
          defaultEfforts: [{ id: "medium", label: "Medium", isDefault: true }],
          allowCustomModels: true,
          error: null,
        },
      },
    });
    await db.batch([
      db
        .prepare(
          `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Designated Mac', ?, 'online', ?, ?, ?)`,
        )
        .bind(
          deviceId,
          organizationId,
          ownerId,
          "c".repeat(64),
          observedAt,
          observedAt,
          observedAt,
        ),
      db
        .prepare(
          `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at
         ) values (?, ?, ?)`,
        )
        .bind(deviceId, "d".repeat(64), observedAt),
      ...[
        [workerId, projectId, "Designated Mac", "e".repeat(64)],
        [otherWorkerId, otherProjectId, "Other Mac", "f".repeat(64)],
      ].map(([id, targetProjectId, label, fingerprint]) =>
        db
          .prepare(
            `insert into briar_execution_workers (
             id, project_id, device_id, label, host_fingerprint,
             runtime_proto_json, state, accepting_work,
             readiness_state, last_heartbeat_at, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, 'online', 1, 'ready', ?, ?, ?)`,
          )
          .bind(
            id,
            targetProjectId,
            deviceId,
            label,
            fingerprint,
            runtimeProtoJson,
            observedAt,
            observedAt,
            observedAt,
          ),
      ),
    ]);

    const ownerClient = client(tokens.owner);
    const callOptions = options(tokens.owner);
    const created = await ownerClient.createProjectAgent(
      {
        ...createInput,
        name: "Pinned Agent",
        model: "gpt-5",
        effort: "medium",
        designatedWorkerId: workerId,
        description: "Preserve this description.",
      },
      callOptions,
    );
    expect(created.agent).toMatchObject({
      designatedWorkerId: workerId,
      designatedWorkerLabel: "Designated Mac",
    });

    const crossProjectError = await ownerClient
      .createProjectAgent(
        {
          ...createInput,
          name: "Wrong Project",
          designatedWorkerId: otherWorkerId,
        },
        callOptions,
      )
      .catch((cause: unknown) => cause);
    expect(crossProjectError).toBeInstanceOf(ConnectError);
    expect((crossProjectError as ConnectError).code).toBe(Code.InvalidArgument);

    const agentId = created.agent?.id;
    expect(agentId).toBeTruthy();
    const preserved = await ownerClient.updateProjectAgent(
      {
        projectId,
        agentId: agentId!,
        provider: AgentProvider.CODEX,
        responsibility: "Updated responsibility.",
        skills: [],
        calendarColor: "#3b82f6",
      },
      callOptions,
    );
    expect(preserved.agent).toMatchObject({
      name: "Codex Agent",
      effort: "medium",
      designatedWorkerId: workerId,
      designatedWorkerLabel: "Designated Mac",
      description: "Preserve this description.",
      responsibility: "Updated responsibility.",
    });
    expect(preserved.agent?.model).toBeUndefined();

    const cleared = await ownerClient.updateProjectAgent(
      {
        projectId,
        agentId: agentId!,
        name: "Cleared Agent",
        provider: AgentProvider.CODEX,
        effortUpdate: { case: "clearEffort", value: {} },
        designatedWorkerUpdate: {
          case: "clearDesignatedWorker",
          value: {},
        },
        responsibility: "Cleared optional execution settings.",
        skills: [],
        calendarColor: "#3b82f6",
      },
      callOptions,
    );
    expect(cleared.agent).toMatchObject({
      name: "Cleared Agent",
    });
    expect(cleared.agent?.effort).toBeUndefined();
    expect(cleared.agent?.designatedWorkerId).toBeUndefined();
    expect(cleared.agent?.designatedWorkerLabel).toBeUndefined();
  });
  it("stops a remote Worker task session and rejects an unknown session", async () => {
    const deviceId = "55555555-5555-4555-8555-555555555555";
    const taskWorkerId = "cancel-task-worker";
    const observedAt = new Date().toISOString();
    const runtimeProtoJson = workerRuntimeProtoJsonFixture({
      providers: ["codex"],
    });
    await db.batch([
      db
        .prepare(
          `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Cancel Mac', ?, 'online', ?, ?, ?)`,
        )
        .bind(
          deviceId,
          organizationId,
          ownerId,
          "1".repeat(64),
          observedAt,
          observedAt,
          observedAt,
        ),
      db
        .prepare(
          `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at
         ) values (?, ?, ?)`,
        )
        .bind(deviceId, "2".repeat(64), observedAt),
      db
        .prepare(
          `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint,
           runtime_proto_json, state, accepting_work,
           readiness_state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Cancel Mac', ?, ?, 'online', 1, 'ready', ?, ?, ?)`,
        )
        .bind(
          taskWorkerId,
          projectId,
          deviceId,
          "3".repeat(64),
          runtimeProtoJson,
          observedAt,
          observedAt,
          observedAt,
        ),
    ]);

    const ownerClient = client(tokens.owner);
    const callOptions = options(tokens.owner);
    const agent = await ownerClient.createProjectAgent(
      {
        ...createInput,
        name: "Stoppable Agent",
        responsibility: "Run a long task on a remote Worker.",
        skills: [{
          name: "Long task",
          description: "Use for long running direct tasks.",
          body: "Do the long running work.",
          provider: AgentProvider.CODEX,
          kind: AgentSkillKind.CUSTOM,
          executionMode: AgentSkillExecutionMode.TASK,
          approvalPolicy: AgentSkillApprovalPolicy.INVOKE_IS_CONSENT,
          position: 0,
        }],
      },
      callOptions,
    );
    const agentId = agent.agent?.id;
    expect(agentId).toBeTruthy();

    const started = await ownerClient.runProjectAgentTask(
      {
        projectId,
        agentId: agentId!,
        skillId: agent.agent?.skills[0]?.id ?? "",
        request: "Investigate the flaky suite.",
        workerId: taskWorkerId,
        requestId: "66666666-6666-4666-8666-666666666666",
      },
      callOptions,
    );
    const sessionId = started.session?.id;
    expect(started.session).toMatchObject({
      status: ProjectAgentSessionStatus.RUNNING,
      workerId: taskWorkerId,
    });

    for (const token of [tokens.editor, tokens.viewer]) {
      const denied = await client(token)
        .cancelProjectAgentTask(
          { projectId, sessionId: sessionId! },
          options(token),
        )
        .catch((cause: unknown) => cause);
      expect(denied).toBeInstanceOf(ConnectError);
      expect((denied as ConnectError).code).toBe(Code.PermissionDenied);
    }

    const stopped = await ownerClient.cancelProjectAgentTask(
      { projectId, sessionId: sessionId! },
      callOptions,
    );
    expect(stopped.session).toMatchObject({
      id: sessionId,
      status: ProjectAgentSessionStatus.INTERRUPTED,
    });
    expect(stopped.session?.error).toBeUndefined();
    expect(stopped.session?.events.at(-1)).toMatchObject({
      type: ProjectAgentSessionEventType.STOPPED,
    });
    expect(
      await db
        .prepare(
          `select status, claim_token_hash, cancelled_by_user_id
           from briar_project_agent_task_jobs where id = ?`,
        )
        .bind(sessionId)
        .first(),
    ).toMatchObject({
      status: "failed",
      claim_token_hash: null,
      cancelled_by_user_id: ownerId,
    });

    // A second stop is a no-op that still returns the stopped session.
    await expect(
      ownerClient.cancelProjectAgentTask(
        { projectId, sessionId: sessionId! },
        callOptions,
      ),
    ).resolves.toMatchObject({
      session: { id: sessionId, status: ProjectAgentSessionStatus.INTERRUPTED },
    });

    const missing = await ownerClient
      .cancelProjectAgentTask(
        { projectId, sessionId: "77777777-7777-4777-8777-777777777777" },
        callOptions,
      )
      .catch((cause: unknown) => cause);
    expect(missing).toBeInstanceOf(ConnectError);
    expect((missing as ConnectError).code).toBe(Code.NotFound);
  });
});
