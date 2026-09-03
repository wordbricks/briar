import { Code, createClient, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  TeamExecutionWorkerPolicy_SelectionMode,
  TeamService,
  UpdateCheckpointPolicyRequest_Scope,
} from "@briar/contracts/gen/briar/app/v1/team_pb";
import {
  WorkflowCheckpoint_Position,
} from "@briar/contracts/gen/briar/types/v1/workflow_pb";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index";

describe("TeamService mutations", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "project-connect-owner";
  const developerId = "project-connect-developer";
  const viewerId = "project-connect-viewer";
  const now = "2026-08-31T00:00:00.000Z";
  const tokens = {
    owner: "project-connect-owner-token",
    developer: "project-connect-developer-token",
    viewer: "project-connect-viewer-token",
  } as const;
  const db = env.DB;

  beforeAll(async () => {
    const users = [
      [ownerId, "Owner", "owner@example.com", "owner", tokens.owner],
      [
        developerId,
        "Developer",
        "developer@example.com",
        "developer",
        tokens.developer,
      ],
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
         values (?, 'Project Connect', 'project-connect', ?, ?)`,
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
    ]);
  }, 60_000);

  const client = (token: string) =>
    createClient(
      TeamService,
      createConnectTransport({
        baseUrl: "https://briar.example",
        fetch: async (input, init) =>
          worker.fetch(new Request(input, { ...init, redirect: "manual" }), {
            DB: db,
            ATTACHMENTS: {},
            ARCHIVES: {},
            BETTER_AUTH_SECRET:
              "briar-test-secret-that-is-at-least-32-characters",
            GOOGLE_CLIENT_ID: "google-client",
            GOOGLE_CLIENT_SECRET: "google-secret",
          } as never),
      }),
    );

  const options = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  it("owns the full project control lifecycle and enforces capabilities", async () => {
    const owner = client(tokens.owner);
    const created = await owner.createTeam(
      { name: "  Connect Project  ", organizationId },
      options(tokens.owner),
    );
    expect(created.agentToken).toMatch(/^briar_agent_/u);
    expect(created.team).toMatchObject({
      name: "Connect Project",
      issueKeyPrefix: "AH",
      scheduleTabEnabled: true,
      organizationId,
    });
    const projectId = created.team?.id;
    expect(projectId).toBeTruthy();

    await db.batch(
      [developerId, viewerId].map((userId) =>
        db
          .prepare(
            `insert into briar_project_members (
             project_id, organization_id, user_id, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
          )
          .bind(projectId, organizationId, userId, now, now),
      ),
    );

    const icon = "data:image/png;base64,aA==";
    await expect(
      owner.updateTeamIcon(
        { teamId: projectId!, iconUpdate: { case: "icon", value: icon } },
        options(tokens.owner),
      ),
    ).resolves.toMatchObject({ team: { icon } });
    const namedIcon = await owner.updateTeamIcon(
      {
        teamId: projectId!,
        iconUpdate: {
          case: "namedIcon",
          value: { name: "rocket", color: "#6366f1" },
        },
      },
      options(tokens.owner),
    );
    expect(namedIcon.team).toMatchObject({
      iconName: "rocket",
      iconColor: "#6366f1",
    });
    expect(namedIcon.team?.icon).toBeUndefined();
    const imageOverNamed = await owner.updateTeamIcon(
      { teamId: projectId!, iconUpdate: { case: "icon", value: icon } },
      options(tokens.owner),
    );
    expect(imageOverNamed.team?.icon).toBe(icon);
    expect(imageOverNamed.team?.iconName).toBeUndefined();
    expect(imageOverNamed.team?.iconColor).toBeUndefined();
    const invalidNamedIcon = await owner.updateTeamIcon(
      {
        teamId: projectId!,
        iconUpdate: {
          case: "namedIcon",
          value: { name: "definitely-not-an-icon" },
        },
      },
      options(tokens.owner),
    ).catch((error: unknown) => error);
    expect(invalidNamedIcon).toBeInstanceOf(ConnectError);
    expect((invalidNamedIcon as ConnectError).code).toBe(Code.InvalidArgument);
    const invalidIconColor = await owner.updateTeamIcon(
      {
        teamId: projectId!,
        iconUpdate: {
          case: "namedIcon",
          value: { name: "rocket", color: "purple" },
        },
      },
      options(tokens.owner),
    ).catch((error: unknown) => error);
    expect(invalidIconColor).toBeInstanceOf(ConnectError);
    expect((invalidIconColor as ConnectError).code).toBe(Code.InvalidArgument);
    const clearedIcon = await owner.updateTeamIcon(
      {
        teamId: projectId!,
        iconUpdate: { case: "clearIcon", value: {} },
      },
      options(tokens.owner),
    );
    expect(clearedIcon.team?.icon).toBeUndefined();
    expect(clearedIcon.team?.iconName).toBeUndefined();
    expect(clearedIcon.team?.iconColor).toBeUndefined();
    await expect(
      owner.updateTeamIssueKeyPrefix(
        { teamId: projectId!, issueKeyPrefix: " br " },
        options(tokens.owner),
      ),
    ).resolves.toMatchObject({ team: { issueKeyPrefix: "BR" } });
    await expect(
      owner.updateTeamTabs(
        { teamId: projectId!, schedule: false },
        options(tokens.owner),
      ),
    ).resolves.toMatchObject({ team: { scheduleTabEnabled: false } });

    const deniedProjectUpdate = await client(tokens.developer)
      .updateTeamTabs(
        { teamId: projectId!, schedule: true },
        options(tokens.developer),
      )
      .catch((error: unknown) => error);
    expect(deniedProjectUpdate).toBeInstanceOf(ConnectError);
    expect((deniedProjectUpdate as ConnectError).code).toBe(
      Code.PermissionDenied,
    );

    await expect(
      client(tokens.developer).createTeamAgentToken(
        { teamId: projectId! },
        options(tokens.developer),
      ),
    ).resolves.toMatchObject({ agentToken: expect.stringMatching(/^briar_agent_/u) });
    const deniedAgentToken = await client(tokens.viewer)
      .createTeamAgentToken(
        { teamId: projectId! },
        options(tokens.viewer),
      )
      .catch((error: unknown) => error);
    expect(deniedAgentToken).toBeInstanceOf(ConnectError);
    expect((deniedAgentToken as ConnectError).code).toBe(Code.PermissionDenied);

    await expect(
      owner.deleteTeam({ teamId: projectId! }, options(tokens.owner)),
    ).resolves.toMatchObject({ deleted: true });
    const remaining = await owner.listTeams({}, options(tokens.owner));
    expect(remaining.teams).not.toContainEqual(
      expect.objectContaining({ id: projectId }),
    );
  });

  it("guards configuration capabilities, revisions, and worker references", async () => {
    const owner = client(tokens.owner);
    const created = await owner.createTeam(
      { name: "Configured Project", organizationId },
      options(tokens.owner),
    );
    const projectId = created.team?.id;
    expect(projectId).toBeTruthy();
    await db.batch(
      [developerId, viewerId].map((userId) =>
        db
          .prepare(
            `insert into briar_project_members (
             project_id, organization_id, user_id, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
          )
          .bind(projectId, organizationId, userId, now, now),
      ),
    );

    const settingsInput = {
      teamId: projectId!,
      linear: { enabled: false },
      workflow: {
        version: 2,
        requirements: [],
        stages: [{
          id: "implementing",
          label: "Implement",
          required: true,
          checks: ["bun test"],
        }],
        execution: { checkpoints: [] },
        completion: { requiredStages: ["implementing"] },
      },
    };
    const deniedSettings = await client(tokens.viewer)
      .updateTeamSettings(settingsInput, options(tokens.viewer))
      .catch((error: unknown) => error);
    expect(deniedSettings).toBeInstanceOf(ConnectError);
    expect((deniedSettings as ConnectError).code).toBe(Code.PermissionDenied);

    const configured = await client(tokens.developer).updateTeamSettings(
      settingsInput,
      options(tokens.developer),
    );
    expect(configured.settings?.workflow?.stages).toEqual([
      expect.objectContaining({ id: "implementing", checks: ["bun test"] }),
    ]);
    const revision = configured.settings?.checkpointPolicy?.projectRevision;
    expect(revision).toBeDefined();
    const checkpointUpdate = {
      teamId: projectId!,
      scope: UpdateCheckpointPolicyRequest_Scope.TEAM,
      checkpoints: [{
        key: "review",
        stage: "implementing",
        position: WorkflowCheckpoint_Position.AFTER,
      }],
      expectedRevision: revision!,
    };
    const checkpointPolicy = await client(tokens.developer)
      .updateCheckpointPolicy(checkpointUpdate, options(tokens.developer));
    expect(checkpointPolicy.checkpointPolicy?.projectMandatory).toEqual([
      expect.objectContaining({
        key: "project-after-implementing",
        stage: "implementing",
        position: WorkflowCheckpoint_Position.AFTER,
      }),
    ]);
    const staleCheckpointUpdate = await client(tokens.developer)
      .updateCheckpointPolicy(checkpointUpdate, options(tokens.developer))
      .catch((error: unknown) => error);
    expect(staleCheckpointUpdate).toBeInstanceOf(ConnectError);
    expect((staleCheckpointUpdate as ConnectError).code).toBe(
      Code.FailedPrecondition,
    );

    await expect(
      client(tokens.viewer).getTeamExecutionWorkerPolicy(
        { teamId: projectId! },
        options(tokens.viewer),
      ),
    ).resolves.toMatchObject({
      policy: {
        selectionMode: TeamExecutionWorkerPolicy_SelectionMode.ANY,
        allowedWorkerIds: [],
      },
    });
    const deniedWorkerPolicy = await client(tokens.viewer)
      .updateTeamExecutionWorkerPolicy(
        {
          teamId: projectId!,
          selectionMode: TeamExecutionWorkerPolicy_SelectionMode.ANY,
        },
        options(tokens.viewer),
      )
      .catch((error: unknown) => error);
    expect(deniedWorkerPolicy).toBeInstanceOf(ConnectError);
    expect((deniedWorkerPolicy as ConnectError).code).toBe(
      Code.PermissionDenied,
    );
    const unknownWorker = await client(tokens.developer)
      .updateTeamExecutionWorkerPolicy(
        {
          teamId: projectId!,
          selectionMode:
            TeamExecutionWorkerPolicy_SelectionMode.ALLOWLIST,
          defaultWorkerId: "missing-worker",
          allowedWorkerIds: ["missing-worker"],
        },
        options(tokens.developer),
      )
      .catch((error: unknown) => error);
    expect(unknownWorker).toBeInstanceOf(ConnectError);
    expect((unknownWorker as ConnectError).code).toBe(
      Code.FailedPrecondition,
    );
  });

  it("deletes a planning project without orphaning its issues", async () => {
    const owner = client(tokens.owner);
    const createdTeam = await owner.createTeam(
      { name: "Planning lifecycle", organizationId },
      options(tokens.owner),
    );
    const teamId = createdTeam.team?.id;
    expect(teamId).toBeTruthy();
    await db.batch(
      [developerId, viewerId].map((userId) =>
        db.prepare(
          `insert into briar_project_members (
             project_id, organization_id, user_id, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
        ).bind(teamId, organizationId, userId, now, now),
      ),
    );

    const defaultProject = (await owner.listTeamPlanningProjects(
      { teamId: teamId! },
      options(tokens.owner),
    )).projects.find((project) => project.isDefault);
    expect(defaultProject).toBeDefined();
    const project = (await owner.createPlanningProject(
      { teamId: teamId!, name: "Mobile launch" },
      options(tokens.owner),
    )).project;
    expect(project).toBeDefined();

    const runId = "55555555-5555-4555-8555-555555555555";
    await db.prepare(
      `insert into briar_hunt_runs (
         id, project_id, team_id, planning_project_id, source, source_key,
         title, stage, status, workflow_stage, workflow_snapshot_json,
         issue_checkpoints_json, repository, started_at, last_event_at,
         created_at, updated_at
       ) values (
         ?, ?, ?, ?, 'issue', 'planning-delete:issue', 'Keep this issue',
         'queued', 'backlog', null,
         '{"version":2,"stages":[{"id":"implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["implementing"]}}',
         '[]', 'example/planning-delete', ?, ?, ?, ?
       )`,
    ).bind(
      runId,
      teamId,
      teamId,
      project!.id,
      now,
      now,
      now,
      now,
    ).run();

    const denied = await client(tokens.viewer).deletePlanningProject(
      { projectId: project!.id },
      options(tokens.viewer),
    ).catch((error: unknown) => error);
    expect(denied).toBeInstanceOf(ConnectError);
    expect((denied as ConnectError).code).toBe(Code.PermissionDenied);

    const protectedDefault = await owner.deletePlanningProject(
      { projectId: defaultProject!.id },
      options(tokens.owner),
    ).catch((error: unknown) => error);
    expect(protectedDefault).toBeInstanceOf(ConnectError);
    expect((protectedDefault as ConnectError).code).toBe(Code.FailedPrecondition);

    await expect(owner.deletePlanningProject(
      { projectId: project!.id },
      options(tokens.owner),
    )).resolves.toMatchObject({ deleted: true, movedIssueCount: 1 });
    await expect(db.prepare(
      `select planning_project_id from briar_hunt_runs where id = ?`,
    ).bind(runId).first()).resolves.toEqual({
      planning_project_id: defaultProject!.id,
    });
    await expect(owner.listTeamPlanningProjects(
      { teamId: teamId! },
      options(tokens.owner),
    )).resolves.toMatchObject({
      projects: [expect.objectContaining({ id: defaultProject!.id })],
    });
  });
});
