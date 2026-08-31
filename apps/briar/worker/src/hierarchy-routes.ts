import type { BriarAuth } from "./auth";
import {
  archivePlanningProject,
  createPlanningProject,
  getPlanningProjectForUser,
  getTeamForUser,
  listProjectIssues,
  listTeamAgentsAndSchedules,
  listTeamProjects,
  listTeams,
  listWorkspaceTeams,
  moveIssueWithinTeam,
  resolveIssueHierarchyLocation,
  updatePlanningProject,
} from "./hierarchy-repository";
import {
  planningProjectJson,
  projectIssueJson,
  teamHierarchyJson,
} from "./hierarchy-json";
import {
  decodeIssueProjectMoveInput,
  decodePlanningProjectCreateInput,
  decodePlanningProjectUpdateInput,
} from "./hierarchy-request-contract";
import { HttpError, json } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import { listOrganizations } from "./organization-repository";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";

const requirePlanningWrite = (role: Parameters<typeof hasOrganizationCapability>[0]) => {
  if (!hasOrganizationCapability(role, "issues:write")) {
    throw new HttpError(403, "Team project editing permission required");
  }
};

const workspaceJson = (workspace: Awaited<
  ReturnType<typeof listOrganizations>
>[number]) => ({
  id: workspace.id,
  name: workspace.name,
  handle: workspace.handle,
  logo: workspace.logo,
  role: workspace.role,
  createdAt: workspace.created_at,
});

export async function handleHierarchyRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
}): Promise<Response | undefined> {
  const { request, url, auth, db } = input;
  const { pathname } = url;

  if (pathname === "/workspaces" && request.method === "GET") {
    const session = await requireSession(auth, request);
    const workspaces = await listOrganizations(db, session.user.id);
    return json({ workspaces: workspaces.map(workspaceJson) });
  }

  if (pathname === "/teams" && request.method === "GET") {
    const session = await requireSession(auth, request);
    const teams = await listTeams(db, session.user.id);
    return json({ teams: teams.map((team) => teamHierarchyJson(team)) });
  }

  const workspaceTeamsMatch = pathname.match(
    /^\/workspaces\/([0-9a-f-]+)\/teams$/u,
  );
  if (workspaceTeamsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const teams = await listWorkspaceTeams(
      db,
      workspaceTeamsMatch[1],
      session.user.id,
    );
    return json({
      workspaceId: workspaceTeamsMatch[1],
      teams: teams.map((team) => teamHierarchyJson(team)),
    });
  }

  const teamMatch = pathname.match(/^\/teams\/([0-9a-f-]+)$/u);
  const issueLocationMatch = pathname.match(
    /^\/teams\/([0-9a-f-]+)\/issues\/([0-9a-f-]+)\/location$/u,
  );
  if (issueLocationMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const location = await resolveIssueHierarchyLocation(db, {
      sourceTeamId: issueLocationMatch[1],
      runId: issueLocationMatch[2],
      userId: session.user.id,
    });
    if (!location) throw new HttpError(404, "Issue not found");
    return json({
      runId: issueLocationMatch[2],
      workspaceId: location.workspace_id,
      teamId: location.team_id,
      projectId: location.project_id,
      projectName: location.project_name,
    });
  }

  if (teamMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const team = await getTeamForUser(db, teamMatch[1], session.user.id);
    if (!team) throw new HttpError(404, "Team not found");
    const runtime = await listTeamAgentsAndSchedules(db, team.id);
    return json({ team: teamHierarchyJson(team, runtime) });
  }

  const teamProjectsMatch = pathname.match(
    /^\/teams\/([0-9a-f-]+)\/projects$/u,
  );
  if (teamProjectsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const team = await getTeamForUser(
      db,
      teamProjectsMatch[1],
      session.user.id,
    );
    if (!team) throw new HttpError(404, "Team not found");
    const projects = await listTeamProjects(db, team.id, session.user.id);
    return json({
      workspaceId: team.workspace_id,
      teamId: team.id,
      projects: projects.map(planningProjectJson),
    });
  }
  if (teamProjectsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const team = await getTeamForUser(
      db,
      teamProjectsMatch[1],
      session.user.id,
    );
    if (!team) throw new HttpError(404, "Team not found");
    requirePlanningWrite(team.role);
    const body = decodePlanningProjectCreateInput(await readJson(request));
    const projectId = await createPlanningProject(db, {
      teamId: team.id,
      ...body,
    });
    const project = await getPlanningProjectForUser(
      db,
      projectId,
      session.user.id,
    );
    if (!project) throw new HttpError(500, "Created project is unavailable");
    return json({ project: planningProjectJson(project) }, 201);
  }

  const projectMatch = pathname.match(/^\/projects\/([0-9a-f-]+)$/u);
  if (
    projectMatch &&
    ["GET", "PATCH", "DELETE"].includes(request.method)
  ) {
    const session = await requireSession(auth, request);
    const project = await getPlanningProjectForUser(
      db,
      projectMatch[1],
      session.user.id,
    );
    // A missing planning Project falls through so the legacy Team alias can
    // continue handling /projects/{oldTeamId}.
    if (!project) return undefined;
    if (request.method === "GET") {
      return json({ project: planningProjectJson(project) });
    }
    requirePlanningWrite(project.role);
    if (request.method === "DELETE") {
      if (!(await archivePlanningProject(db, project.id))) {
        throw new HttpError(409, "The Team default project cannot be archived");
      }
    } else {
      const body = decodePlanningProjectUpdateInput(await readJson(request));
      if (!(await updatePlanningProject(db, project.id, body))) {
        throw new HttpError(409, "The Team default project must remain available");
      }
    }
    const updated = await getPlanningProjectForUser(
      db,
      project.id,
      session.user.id,
    );
    if (!updated) throw new HttpError(404, "Project not found");
    return json({ project: planningProjectJson(updated) });
  }

  const projectIssuesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/issues$/u,
  );
  if (projectIssuesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getPlanningProjectForUser(
      db,
      projectIssuesMatch[1],
      session.user.id,
    );
    if (!project) return undefined;
    const issues = await listProjectIssues(db, project.id, session.user.id);
    return json({
      workspaceId: project.workspace_id,
      teamId: project.team_id,
      projectId: project.id,
      issues: issues.map(projectIssueJson),
    });
  }

  const issueMoveMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/issues\/([0-9a-f-]+)$/u,
  );
  if (issueMoveMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const source = await getPlanningProjectForUser(
      db,
      issueMoveMatch[1],
      session.user.id,
    );
    if (!source) throw new HttpError(404, "Project not found");
    requirePlanningWrite(source.role);
    const body = decodeIssueProjectMoveInput(await readJson(request));
    const outcome = await moveIssueWithinTeam(db, {
      sourceProjectId: source.id,
      targetProjectId: body.targetProjectId,
      runId: issueMoveMatch[2],
      userId: session.user.id,
    });
    if (outcome === "not_found") throw new HttpError(404, "Issue not found");
    if (outcome === "different_team") {
      throw new HttpError(
        409,
        "Use a Team transfer to move an issue across repository boundaries",
        "ISSUE_TEAM_TRANSFER_REQUIRED",
      );
    }
    const target = await getPlanningProjectForUser(
      db,
      body.targetProjectId,
      session.user.id,
    );
    if (!target) throw new HttpError(404, "Target project not found");
    return json({
      outcome,
      issueId: issueMoveMatch[2],
      workspaceId: target.workspace_id,
      teamId: target.team_id,
      projectId: target.id,
    });
  }

  return undefined;
}
