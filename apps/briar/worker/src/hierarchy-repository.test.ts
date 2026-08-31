import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import {
  createPlanningProject,
  getDefaultProjectForTeam,
  getPlanningProjectForUser,
  listProjectIssues,
  listTeamProjects,
  listWorkspaceTeams,
  moveIssueWithinTeam,
  resolveIssueHierarchyLocation,
} from "./hierarchy-repository";
import { transferIssue } from "./issue-transfer-repository";
import {
  createIsolatedTestDatabase,
  executeD1Sql,
} from "./test-helpers/d1";

describe("Workspace Team Project Issue hierarchy", () => {
  let miniflare: Miniflare;
  let db: D1Database;
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "22222222-2222-4222-8222-222222222222";
  const memberId = "33333333-3333-4333-8333-333333333333";
  const outsiderId = "44444444-4444-4444-8444-444444444444";
  const teamAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const teamBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const runId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const now = "2026-08-31T00:00:00.000Z";

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "workspace-team-project-issue-hierarchy",
    });
    miniflare = database.miniflare;
    db = database.db;
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values
        ('${ownerId}', 'Owner', 'owner@example.com', 1, '${now}', '${now}'),
        ('${memberId}', 'Member', 'member@example.com', 1, '${now}', '${now}'),
        ('${outsiderId}', 'Outsider', 'outsider@example.com', 1, '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${workspaceId}', 'Workspace', 'workspace', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values
        ('${workspaceId}', '${ownerId}', 'owner', '${now}', '${now}'),
        ('${workspaceId}', '${memberId}', 'editor', '${now}', '${now}'),
        ('${workspaceId}', '${outsiderId}', 'editor', '${now}', '${now}');
      insert into briar_teams (
        id, owner_user_id, organization_id, name, agent_token_hash,
        issue_key_prefix, created_at, updated_at
      ) values
        ('${teamAId}', '${ownerId}', '${workspaceId}', 'Team A',
         '${"a".repeat(64)}', 'TA', '${now}', '${now}'),
        ('${teamBId}', '${ownerId}', '${workspaceId}', 'Team B',
         '${"b".repeat(64)}', 'TB', '${now}', '${now}');
      insert into briar_project_members (
        project_id, organization_id, user_id, created_at, updated_at
      ) values ('${teamAId}', '${workspaceId}', '${memberId}', '${now}', '${now}');
      insert into briar_project_settings (
        project_id, workflow_json, mandatory_checkpoints_json,
        github_repository_id, github_repository, created_at, updated_at
      ) values
        ('${teamAId}', '{"version":2,"stages":[{"id":"implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["implementing"]}}', '[]',
         101, 'example/team-a', '${now}', '${now}'),
        ('${teamBId}', '{"version":2,"stages":[{"id":"implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["implementing"]}}', '[]',
         102, 'example/team-b', '${now}', '${now}');
    `);
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("promotes the former Project identity and creates one General Project", async () => {
    await expect(listWorkspaceTeams(db, workspaceId, ownerId)).resolves.toEqual([
      expect.objectContaining({ id: teamAId, workspace_id: workspaceId }),
      expect.objectContaining({ id: teamBId, workspace_id: workspaceId }),
    ]);
    const generalA = await getDefaultProjectForTeam(db, teamAId);
    const generalB = await getDefaultProjectForTeam(db, teamBId);
    expect(generalA?.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(generalB?.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(generalA?.id).not.toBe(generalB?.id);
    await expect(listTeamProjects(db, teamAId, memberId)).resolves.toEqual([
      expect.objectContaining({
        id: generalA?.id,
        team_id: teamAId,
        name: "General",
        is_default: 1,
      }),
    ]);
    await expect(listTeamProjects(db, teamBId, memberId)).resolves.toEqual([]);
  });

  it("inherits Team access and treats leads as metadata instead of ACL", async () => {
    const projectId = await createPlanningProject(db, {
      teamId: teamAId,
      name: "Release 1",
      description: "First release",
      status: "active",
      leadUserId: memberId,
      color: "#22c55e",
      sortOrder: 10,
    });
    await expect(
      getPlanningProjectForUser(db, projectId, memberId),
    ).resolves.toEqual(expect.objectContaining({
      id: projectId,
      lead_user_id: memberId,
      role: "editor",
    }));
    await expect(
      getPlanningProjectForUser(db, projectId, outsiderId),
    ).resolves.toBeNull();
    await expect(createPlanningProject(db, {
      teamId: teamAId,
      name: "Invalid lead",
      leadUserId: outsiderId,
    })).rejects.toThrow("project lead must have access to its team");
  });

  it("assigns compatibility Issues to General and moves them within one Team", async () => {
    const general = await getDefaultProjectForTeam(db, teamAId);
    expect(general).not.toBeNull();
    await db.prepare(
      `insert into briar_hunt_runs (
         id, project_id, source, source_key, title, stage, status,
         workflow_stage, workflow_snapshot_json, issue_checkpoints_json,
         repository, started_at, last_event_at, created_at, updated_at
       ) values (
         ?, ?, 'issue', 'hierarchy:issue', 'Hierarchy issue', 'queued',
         'backlog', null,
         '{"version":2,"stages":[{"id":"implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["implementing"]}}',
         '[]', 'example/team-a', ?, ?, ?, ?
       )`,
    ).bind(runId, teamAId, now, now, now, now).run();
    await expect(db.prepare(
      `select planning_project_id from briar_hunt_runs where id = ?`,
    ).bind(runId).first()).resolves.toEqual({
      planning_project_id: general?.id,
    });

    const target = (await listTeamProjects(db, teamAId, ownerId)).find(
      (project) => project.name === "Release 1",
    );
    expect(target).toBeDefined();
    await expect(moveIssueWithinTeam(db, {
      runId,
      sourceProjectId: general!.id,
      targetProjectId: target!.id,
      userId: ownerId,
    })).resolves.toBe("moved");
    await expect(listProjectIssues(db, target!.id, ownerId)).resolves.toEqual([
      expect.objectContaining({
        id: runId,
        workspace_id: workspaceId,
        team_id: teamAId,
        project_id: target!.id,
        repository: "example/team-a",
      }),
    ]);
    await expect(db.prepare(
      `select id, project_id, source_key, repository, planning_project_id
       from briar_hunt_runs where id = ?`,
    ).bind(runId).first()).resolves.toEqual({
      id: runId,
      project_id: teamAId,
      source_key: "hierarchy:issue",
      repository: "example/team-a",
      planning_project_id: target!.id,
    });
  });

  it("rejects cross-Team Project moves at both service and database boundaries", async () => {
    const source = (await listTeamProjects(db, teamAId, ownerId)).find(
      (project) => project.name === "Release 1",
    );
    const target = await getDefaultProjectForTeam(db, teamBId);
    await expect(moveIssueWithinTeam(db, {
      runId,
      sourceProjectId: source!.id,
      targetProjectId: target!.id,
      userId: ownerId,
    })).resolves.toBe("different_team");
    await expect(db.prepare(
      `update briar_hunt_runs set planning_project_id = ? where id = ?`,
    ).bind(target!.id, runId).run()).rejects.toThrow(
      "issue project must belong to its team",
    );
  });

  it("resolves an old Team deep link through a durable key alias after transfer", async () => {
    await expect(transferIssue(db, {
      sourceProjectId: teamAId,
      targetProjectId: teamBId,
      targetProjectName: "Team B",
      runId,
      observedAt: now,
    })).resolves.toBe("transferred");
    const general = await getDefaultProjectForTeam(db, teamBId);
    await expect(db.prepare(
      `select team_id, issue_key, run_id
       from briar_issue_key_aliases where run_id = ?`,
    ).bind(runId).first()).resolves.toEqual({
      team_id: teamAId,
      issue_key: expect.stringMatching(/^TA-\d+$/u),
      run_id: runId,
    });
    await expect(resolveIssueHierarchyLocation(db, {
      sourceTeamId: teamAId,
      runId,
      userId: ownerId,
    })).resolves.toEqual({
      workspace_id: workspaceId,
      team_id: teamBId,
      project_id: general?.id,
      project_name: "General",
    });
    await expect(db.prepare(
      `select project_id, team_id, planning_project_id
       from briar_hunt_runs where id = ?`,
    ).bind(runId).first()).resolves.toEqual({
      project_id: teamBId,
      team_id: teamBId,
      planning_project_id: general?.id,
    });
  });
});
