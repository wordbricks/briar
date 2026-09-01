import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import type { ProjectAgentLocale } from "../../src/lib/project-agent";
import { createOrganization } from "./organization-command-repository";
import { hasOrganizationCapability } from "./organization-access";
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
import { issueProjectAgentToken } from "./hunt-run-claim-repository";
import { sha256 } from "./crypto-digest";
import { decodeRequestSync } from "./request-schema";
import { trimmedText, UuidString } from "./schema-codecs";

type ProjectApplicationUser = {
  readonly id: string;
  readonly name?: string | null;
  readonly email: string;
};

export type ProjectApplicationErrorReason =
  | "development_management_required"
  | "project_management_required"
  | "project_not_found"
  | "repository_connection_permission_denied"
  | "transfer_reconciliation_required";

export class ProjectApplicationError extends Error {
  readonly name = "ProjectApplicationError";

  constructor(
    readonly reason: ProjectApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type ProjectApplicationServices = {
  readonly createOrganization: typeof createOrganization;
  readonly createProject: typeof createProject;
  readonly deleteProject: typeof deleteProject;
  readonly getProject: typeof getProject;
  readonly getProjectRunChildMismatch: typeof getProjectRunChildMismatch;
  readonly issueProjectAgentToken: typeof issueProjectAgentToken;
  readonly listOrganizations: typeof listOrganizations;
  readonly updateProjectIcon: typeof updateProjectIcon;
  readonly updateProjectIssueKeyPrefix: typeof updateProjectIssueKeyPrefix;
  readonly updateProjectScheduleTabEnabled:
    typeof updateProjectScheduleTabEnabled;
};

const projectApplicationServices: ProjectApplicationServices = {
  createOrganization,
  createProject,
  deleteProject,
  getProject,
  getProjectRunChildMismatch,
  issueProjectAgentToken,
  listOrganizations,
  updateProjectIcon,
  updateProjectIssueKeyPrefix,
  updateProjectScheduleTabEnabled,
};

const projectImagePattern =
  /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/iu;
const decodeProjectName = decodeRequestSync(trimmedText(1, 100));
const decodeOrganizationId = decodeRequestSync(UuidString);
const decodeProjectIcon = decodeRequestSync(
  Schema.NullOr(
    Schema.String.check(
      Schema.isMaxLength(400_000),
      Schema.isPattern(projectImagePattern),
    ),
  ),
);
const decodeProjectIssueKeyPrefix = decodeRequestSync(
  Schema.Trim.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => value.toUpperCase()),
      encode: SchemaGetter.transform((value) => value.toUpperCase()),
    }),
    Schema.check(Schema.isPattern(/^[A-Z0-9]{1,3}$/u)),
  ),
);

const createAgentToken = () =>
  `briar_agent_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;

const requireProject = async (
  db: D1Database,
  projectId: string,
  userId: string,
  capability: "development:manage" | "projects:manage",
  services: ProjectApplicationServices,
) => {
  const project = await services.getProject(db, projectId, userId);
  if (!project) {
    throw new ProjectApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  if (!hasOrganizationCapability(project.member_role, capability)) {
    throw new ProjectApplicationError(
      capability === "projects:manage"
        ? "project_management_required"
        : "development_management_required",
      capability === "projects:manage"
        ? "Project management permission required"
        : "Development management permission required",
    );
  }
  return project;
};

export async function createProjectApplication(
  input: {
    readonly db: D1Database;
    readonly user: ProjectApplicationUser;
    readonly name: string;
    readonly organizationId?: string;
    readonly locale: ProjectAgentLocale;
  },
  services: ProjectApplicationServices = projectApplicationServices,
) {
  const name = decodeProjectName(input.name);
  const organizationId = input.organizationId === undefined
    ? undefined
    : decodeOrganizationId(input.organizationId);
  let organizations = await services.listOrganizations(input.db, input.user.id);
  if (organizations.length === 0) {
    const organization = await services.createOrganization(input.db, {
      name:
        input.user.name?.trim() ||
        input.user.email.split("@")[0]?.trim() ||
        "Briar",
      handle: `organization-${crypto.randomUUID().replaceAll("-", "")}`,
      ownerUserId: input.user.id,
    });
    organizations = [organization];
  }
  const organization =
    organizations.find((candidate) => candidate.id === organizationId) ??
    (organizationId ? null : organizations[0]);
  if (
    !organization ||
    !hasOrganizationCapability(organization.role, "projects:manage")
  ) {
    throw new ProjectApplicationError(
      "project_management_required",
      "Project management permission required",
    );
  }

  const agentToken = createAgentToken();
  const project = await services.createProject(input.db, {
    ownerUserId: input.user.id,
    organizationId: organization.id,
    name,
    agentTokenHash: await sha256(agentToken),
    locale: input.locale,
  });
  project.organization_name = organization.name;
  project.member_role = organization.role;
  return { project, agentToken };
}

export async function deleteProjectApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
  },
  services: ProjectApplicationServices = projectApplicationServices,
) {
  const project = await requireProject(
    input.db,
    input.projectId,
    input.userId,
    "projects:manage",
    services,
  );
  if (await services.getProjectRunChildMismatch(input.db, project.id)) {
    throw new ProjectApplicationError(
      "transfer_reconciliation_required",
      "Project transfer reconciliation is required before deletion",
    );
  }
  const observedAt = new Date().toISOString();
  let deleted = false;
  try {
    deleted = await services.deleteProject(
      input.db,
      project.id,
      input.userId,
      observedAt,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("project has stranded transferred issue data") ||
        error.message.includes("quarantined transcript"))
    ) {
      throw new ProjectApplicationError(
        "transfer_reconciliation_required",
        "Project transfer reconciliation is required before deletion",
      );
    }
    throw error;
  }
  if (!deleted) {
    throw new ProjectApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  return { projectId: project.id, observedAt };
}

export async function updateProjectIconApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
    readonly icon: string | null;
  },
  services: ProjectApplicationServices = projectApplicationServices,
) {
  const project = await requireProject(
    input.db,
    input.projectId,
    input.userId,
    "projects:manage",
    services,
  );
  const icon = decodeProjectIcon(input.icon);
  if (!(await services.updateProjectIcon(input.db, project.id, icon))) {
    throw new ProjectApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  return { ...project, icon };
}

export async function updateProjectIssueKeyPrefixApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
    readonly issueKeyPrefix: string;
  },
  services: ProjectApplicationServices = projectApplicationServices,
) {
  const project = await requireProject(
    input.db,
    input.projectId,
    input.userId,
    "projects:manage",
    services,
  );
  const issueKeyPrefix = decodeProjectIssueKeyPrefix(input.issueKeyPrefix);
  if (
    !(await services.updateProjectIssueKeyPrefix(
      input.db,
      project.id,
      issueKeyPrefix,
    ))
  ) {
    throw new ProjectApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  return { ...project, issue_key_prefix: issueKeyPrefix };
}

export async function updateProjectTabsApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
    readonly schedule: boolean;
  },
  services: ProjectApplicationServices = projectApplicationServices,
) {
  const project = await requireProject(
    input.db,
    input.projectId,
    input.userId,
    "projects:manage",
    services,
  );
  if (
    !(await services.updateProjectScheduleTabEnabled(
      input.db,
      project.id,
      input.schedule,
    ))
  ) {
    throw new ProjectApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  return { ...project, schedule_tab_enabled: input.schedule ? 1 : 0 };
}

export async function createProjectAgentTokenApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
  },
  services: ProjectApplicationServices = projectApplicationServices,
) {
  const project = await requireProject(
    input.db,
    input.projectId,
    input.userId,
    "development:manage",
    services,
  );
  const agentToken = createAgentToken();
  const issued = await services.issueProjectAgentToken(
    input.db,
    project.id,
    input.userId,
    await sha256(agentToken),
  );
  if (!issued) {
    throw new ProjectApplicationError(
      "repository_connection_permission_denied",
      "Repository connection permission denied",
    );
  }
  return agentToken;
}
