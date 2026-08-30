import { normalizeProjectAgentLocale } from "../../src/lib/project-agent";
import {
  listProjectsOperation,
  matchesMobileOperation,
} from "@briar/contracts";
import type { BriarAuth } from "./auth";
import { processArchiveCleanupQueue } from "./archive";
import { sha256 } from "./crypto-digest";
import { issueProjectAgentToken } from "./hunt-run-claim-repository";
import { corsHeaders, HttpError, json } from "./http-response";
import { authenticateMobileOperation } from "./mobile-contract-auth";
import { mobileJson } from "./mobile-contract-response";
import { hasOrganizationCapability } from "./organization-access";
import { createOrganization } from "./organization-command-repository";
import { listOrganizations } from "./organization-repository";
import {
  createProject,
  deleteProject,
  getProject,
  getProjectRunChildMismatch,
  updateProjectIcon,
  updateProjectIssueKeyPrefix,
  updateProjectScheduleTabEnabled,
} from "./project-command-repository";
import { projectJson } from "./project-json";
import { listProjects } from "./project-repository";
import {
  decodeProjectIconInput,
  decodeProjectInput,
  decodeProjectIssueKeyPrefixInput,
  decodeProjectTabsInput,
} from "./project-request-contract";
import { responseWithPostCommitCleanup } from "./post-commit-cleanup";
import { maxProjectIconRequestBytes, readJson } from "./request-readers";
import { requireSession } from "./session-auth";

export type ProjectCoreRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  env: Env;
  context?: ExecutionContext;
};

export type ProjectListRouteServices = {
  readonly requireSession: typeof requireSession;
  readonly listProjects: typeof listProjects;
};

const projectListRouteServices: ProjectListRouteServices = {
  requireSession,
  listProjects,
};

export async function handleProjectCoreRoute(
  routeInput: ProjectCoreRouteInput,
  listRouteServices: ProjectListRouteServices = projectListRouteServices,
): Promise<Response | undefined> {
  const { request, url, auth, db, attachmentsBucket, env, context } = routeInput;
  const { pathname } = url;

  if (
    matchesMobileOperation(
      listProjectsOperation,
      request.method,
      pathname,
    )
  ) {
    const session = await authenticateMobileOperation(
      listProjectsOperation,
      auth,
      request,
      listRouteServices.requireSession,
    );
    const projects = await listRouteServices.listProjects(db, session.user.id);
    return mobileJson(listProjectsOperation, {
      projects: projects.map(projectJson),
    });
  }

  if (pathname === "/projects" && request.method === "POST") {
    const session = await requireSession(auth, request);
    const input = decodeProjectInput(await readJson(request));
    let organizations = await listOrganizations(db, session.user.id);
    if (organizations.length === 0) {
      const organization = await createOrganization(db, {
        name:
          session.user.name?.trim() ||
          session.user.email.split("@")[0]?.trim() ||
          "Briar",
        handle: `organization-${crypto.randomUUID().replaceAll("-", "")}`,
        ownerUserId: session.user.id,
      });
      organizations = [organization];
    }
    const organization =
      organizations.find(
        (candidate) => candidate.id === input.organizationId,
      ) ?? (input.organizationId ? null : organizations[0]);
    if (
      !organization ||
      !hasOrganizationCapability(organization.role, "projects:manage")
    ) {
      throw new HttpError(403, "Project management permission required");
    }
    const agentToken = `briar_agent_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const tokenHash = await sha256(agentToken);
    const project = await createProject(db, {
      ownerUserId: session.user.id,
      organizationId: organization.id,
      name: input.name,
      agentTokenHash: tokenHash,
      locale: normalizeProjectAgentLocale(
        request.headers.get("accept-language"),
      ),
    });
    project.organization_name = organization.name;
    project.member_role = organization.role;
    return json({ project: projectJson(project), agentToken }, 201);
  }

  const projectMatch = pathname.match(/^\/projects\/([0-9a-f-]+)$/u);
  if (projectMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "projects:manage")) {
      throw new HttpError(403, "Project management permission required");
    }
    if (await getProjectRunChildMismatch(db, project.id)) {
      throw new HttpError(
        409,
        "Project transfer reconciliation is required before deletion",
        "PROJECT_TRANSFER_RECONCILIATION_REQUIRED",
      );
    }
    const observedAt = new Date().toISOString();
    let deleted = false;
    try {
      deleted = await deleteProject(
        db,
        project.id,
        session.user.id,
        observedAt,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.message.includes("project has stranded transferred issue data") ||
          error.message.includes("quarantined transcript")
        )
      ) {
        throw new HttpError(
          409,
          "Project transfer reconciliation is required before deletion",
          "PROJECT_TRANSFER_RECONCILIATION_REQUIRED",
        );
      }
      throw error;
    }
    if (!deleted) {
      throw new HttpError(404, "Project not found");
    }
    return responseWithPostCommitCleanup(
      new Response(null, { status: 204, headers: corsHeaders }),
      {
        context,
        operation: "project_delete",
        observedAt,
        tasks: [{
          queue: "archive",
          run: () => processArchiveCleanupQueue(
            db,
            env.ARCHIVES,
            attachmentsBucket,
            observedAt,
            1_000,
          ),
        }],
      },
    );
  }

  const projectIconMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/icon$/u,
  );
  if (projectIconMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectIconMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "projects:manage")) {
      throw new HttpError(403, "Project management permission required");
    }
    const input = decodeProjectIconInput(
      await readJson(request, maxProjectIconRequestBytes),
    );
    if (!(await updateProjectIcon(db, project.id, input.icon))) {
      throw new HttpError(404, "Project not found");
    }
    return json({ project: projectJson({ ...project, icon: input.icon }) });
  }

  const projectIssueKeyPrefixMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/issue-key-prefix$/u,
  );
  if (projectIssueKeyPrefixMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectIssueKeyPrefixMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "projects:manage")) {
      throw new HttpError(403, "Project management permission required");
    }
    const input = decodeProjectIssueKeyPrefixInput(
      await readJson(request),
    );
    if (
      !(await updateProjectIssueKeyPrefix(
        db,
        project.id,
        input.issueKeyPrefix,
      ))
    ) {
      throw new HttpError(404, "Project not found");
    }
    return json({
      project: projectJson({
        ...project,
        issue_key_prefix: input.issueKeyPrefix,
      }),
    });
  }

  const projectTabsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/tabs$/u,
  );
  if (projectTabsMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectTabsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "projects:manage")) {
      throw new HttpError(403, "Project management permission required");
    }
    const input = decodeProjectTabsInput(await readJson(request));
    if (
      !(await updateProjectScheduleTabEnabled(
        db,
        project.id,
        input.schedule,
      ))
    ) {
      throw new HttpError(404, "Project not found");
    }
    return json({
      project: projectJson({
        ...project,
        schedule_tab_enabled: input.schedule ? 1 : 0,
      }),
    });
  }

  const agentTokenMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-token$/u,
  );
  if (agentTokenMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, agentTokenMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const agentToken = `briar_agent_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const issued = await issueProjectAgentToken(
      db,
      project.id,
      session.user.id,
      await sha256(agentToken),
    );
    if (!issued) {
      throw new HttpError(403, "Repository connection permission denied");
    }
    return json({ agentToken });
  }
}
