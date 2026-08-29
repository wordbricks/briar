import {
  cloneAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
  type AutoHuntPersistedRunStatus,
} from "../../src/lib/auto-hunt-contract";
import {
  defaultPlacementForLinearType,
  linearSourceKey,
  mapLinearPriority,
  parsePlacementKey,
} from "../../src/lib/linear-import";
import type { BriarAuth } from "./auth";
import { HttpError, json } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import {
  decodeLinearApiKeyInput,
  decodeLinearImportInput,
  decodeLinearStatesInput,
} from "./issue-request-contract";
import {
  fetchLinearIssuesForTeams,
  fetchLinearViewerAndTeams,
  fetchLinearWorkflowStates,
  LinearApiError,
  LINEAR_IMPORT_ISSUE_LIMIT,
} from "./linear";
import { importLinearHuntRuns } from "./linear-import-repository";
import { getProject } from "./project-command-repository";
import { getProjectSettings } from "./project-settings-repository";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";

export type ProjectLinearRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
};

export async function handleProjectLinearRoute(
  routeInput: ProjectLinearRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db } = routeInput;
  const { pathname } = url;

  const linearConnectMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/linear\/connect$/u,
  );
  if (linearConnectMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      linearConnectMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const input = decodeLinearApiKeyInput(await readJson(request));
    try {
      const { viewer, teams } = await fetchLinearViewerAndTeams(input.apiKey);
      return json({ viewer, teams });
    } catch (error) {
      if (error instanceof LinearApiError) {
        throw new HttpError(
          error.status === 401 || error.status === 403 ? 401 : 502,
          error.message,
        );
      }
      throw error;
    }
  }

  const linearStatesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/linear\/states$/u,
  );
  if (linearStatesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, linearStatesMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const input = decodeLinearStatesInput(await readJson(request));
    try {
      const states = await fetchLinearWorkflowStates(
        input.apiKey,
        input.teamIds,
      );
      return json({ states });
    } catch (error) {
      if (error instanceof LinearApiError) {
        throw new HttpError(
          error.status === 401 || error.status === 403 ? 401 : 502,
          error.message,
        );
      }
      throw error;
    }
  }

  const linearImportMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/linear\/import$/u,
  );
  if (linearImportMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, linearImportMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const input = decodeLinearImportInput(await readJson(request));
    const settings = await getProjectSettings(db, project.id);
    const workflow = settings?.workflow_json
      ? normalizeAutoHuntWorkflow(JSON.parse(settings.workflow_json))
      : cloneAutoHuntWorkflow();
    const firstStageId = workflow.stages[0]?.id ?? null;
    const workflowStageIds = new Set(workflow.stages.map((stage) => stage.id));

    const statusMap = new Map<
      string,
      { status: AutoHuntPersistedRunStatus; workflowStage: string | null }
    >();
    for (const [stateId, placementKey] of Object.entries(input.statusMapping)) {
      const placement = parsePlacementKey(placementKey);
      if (!placement) {
        throw new HttpError(400, `Invalid status mapping for state ${stateId}`);
      }
      if (
        placement.status === "running" &&
        (!placement.workflowStage ||
          !workflowStageIds.has(placement.workflowStage))
      ) {
        throw new HttpError(
          400,
          `Status mapping for ${stateId} targets an unknown workflow stage`,
        );
      }
      statusMap.set(stateId, placement);
    }

    try {
      const { issues, truncated } = await fetchLinearIssuesForTeams(
        input.apiKey,
        input.teamIds,
        LINEAR_IMPORT_ISSUE_LIMIT,
      );
      const runs = issues.map((issue) => {
        const mapped =
          (issue.state ? statusMap.get(issue.state.id) : null) ??
          defaultPlacementForLinearType(
            issue.state?.type ?? "unstarted",
            firstStageId,
          );
        return {
          sourceKey: linearSourceKey(issue.id),
          title: issue.title,
          description: issue.description,
          priority: mapLinearPriority(issue.priority),
          status: mapped.status,
          workflowStage: mapped.workflowStage,
          tracker: {
            provider: "linear",
            issueId: issue.id,
            identifier: issue.identifier,
            url: issue.url,
            state: issue.state?.name ?? null,
          },
          sourceCreatedAt: issue.createdAt,
        };
      });
      const result = await importLinearHuntRuns(
        db,
        project.id,
        settings?.github_repository ?? project.name,
        runs,
      );
      return json({
        ...result,
        total: issues.length,
        truncated,
      });
    } catch (error) {
      if (error instanceof LinearApiError) {
        throw new HttpError(
          error.status === 401 || error.status === 403 ? 401 : 502,
          error.message,
        );
      }
      throw error;
    }
  }

  return undefined;
}
