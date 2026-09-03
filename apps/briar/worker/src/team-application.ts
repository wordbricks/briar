import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import type { ProjectAgentLocale } from "../../src/lib/team-agent";
import {
  isProjectIconColor,
  isProjectIconName,
} from "../../src/lib/team-icon-library";
import type { TeamIconUpdate } from "./team-command-repository";
import { createOrganization } from "./organization-command-repository";
import { hasOrganizationCapability } from "./organization-access";
import { listOrganizations } from "./organization-repository";
import {
  createTeam,
  deleteTeam,
  getTeam,
  getTeamRunChildMismatch,
  updateTeamIcon,
  updateTeamIssueKeyPrefix,
  updateTeamScheduleTabEnabled,
} from "./team-command-repository";
import { issueProjectAgentToken } from "./hunt-run-claim-repository";
import { sha256 } from "./crypto-digest";
import { decodeRequestSync } from "./request-schema";
import { trimmedText, UuidString } from "./schema-codecs";

type TeamApplicationUser = {
  readonly id: string;
  readonly name?: string | null;
  readonly email: string;
};

export type TeamApplicationErrorReason =
  | "development_management_required"
  | "invalid_project_icon"
  | "project_management_required"
  | "project_not_found"
  | "repository_connection_permission_denied"
  | "transfer_reconciliation_required";

export class TeamApplicationError extends Error {
  readonly name = "TeamApplicationError";

  constructor(
    readonly reason: TeamApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type TeamApplicationServices = {
  readonly createOrganization: typeof createOrganization;
  readonly createTeam: typeof createTeam;
  readonly deleteTeam: typeof deleteTeam;
  readonly getTeam: typeof getTeam;
  readonly getTeamRunChildMismatch: typeof getTeamRunChildMismatch;
  readonly issueProjectAgentToken: typeof issueProjectAgentToken;
  readonly listOrganizations: typeof listOrganizations;
  readonly updateTeamIcon: typeof updateTeamIcon;
  readonly updateTeamIssueKeyPrefix: typeof updateTeamIssueKeyPrefix;
  readonly updateTeamScheduleTabEnabled:
    typeof updateTeamScheduleTabEnabled;
};

const teamApplicationServices: TeamApplicationServices = {
  createOrganization,
  createTeam,
  deleteTeam,
  getTeam,
  getTeamRunChildMismatch,
  issueProjectAgentToken,
  listOrganizations,
  updateTeamIcon,
  updateTeamIssueKeyPrefix,
  updateTeamScheduleTabEnabled,
};

const teamImagePattern =
  /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/iu;
const decodeTeamName = decodeRequestSync(trimmedText(1, 100));
const decodeOrganizationId = decodeRequestSync(UuidString);
const decodeTeamIconImage = decodeRequestSync(
  Schema.NullOr(
    Schema.String.check(
      Schema.isMaxLength(400_000),
      Schema.isPattern(teamImagePattern),
    ),
  ),
);

const decodeTeamIconUpdate = (
  update: TeamIconUpdate,
): TeamIconUpdate => {
  switch (update.type) {
    case "image":
      return { type: "image", dataUrl: decodeTeamIconUpdateImage(update.dataUrl) };
    case "named":
      if (!isProjectIconName(update.name)) {
        throw new TeamApplicationError(
          "invalid_project_icon",
          "Project icon is not in the predefined icon library",
        );
      }
      if (update.color !== null && !isProjectIconColor(update.color)) {
        throw new TeamApplicationError(
          "invalid_project_icon",
          "Project icon color must be a #RRGGBB hex value",
        );
      }
      return update;
    case "clear":
      return update;
  }
};

const decodeTeamIconUpdateImage = (dataUrl: string) => {
  const decoded = decodeTeamIconImage(dataUrl);
  if (decoded === null) {
    throw new TeamApplicationError(
      "invalid_project_icon",
      "Project icon image is required",
    );
  }
  return decoded;
};
const decodeTeamIssueKeyPrefix = decodeRequestSync(
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

const requireTeam = async (
  db: D1Database,
  projectId: string,
  userId: string,
  capability: "development:manage" | "projects:manage",
  services: TeamApplicationServices,
) => {
  const project = await services.getTeam(db, projectId, userId);
  if (!project) {
    throw new TeamApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  if (!hasOrganizationCapability(project.member_role, capability)) {
    throw new TeamApplicationError(
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

export async function createTeamApplication(
  input: {
    readonly db: D1Database;
    readonly user: TeamApplicationUser;
    readonly name: string;
    readonly organizationId?: string;
    readonly locale: ProjectAgentLocale;
  },
  services: TeamApplicationServices = teamApplicationServices,
) {
  const name = decodeTeamName(input.name);
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
    throw new TeamApplicationError(
      "project_management_required",
      "Project management permission required",
    );
  }

  const agentToken = createAgentToken();
  const project = await services.createTeam(input.db, {
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

export async function deleteTeamApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
  },
  services: TeamApplicationServices = teamApplicationServices,
) {
  const project = await requireTeam(
    input.db,
    input.projectId,
    input.userId,
    "projects:manage",
    services,
  );
  if (await services.getTeamRunChildMismatch(input.db, project.id)) {
    throw new TeamApplicationError(
      "transfer_reconciliation_required",
      "Project transfer reconciliation is required before deletion",
    );
  }
  const observedAt = new Date().toISOString();
  let deleted = false;
  try {
    deleted = await services.deleteTeam(
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
      throw new TeamApplicationError(
        "transfer_reconciliation_required",
        "Project transfer reconciliation is required before deletion",
      );
    }
    throw error;
  }
  if (!deleted) {
    throw new TeamApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  return { projectId: project.id, observedAt };
}

export async function updateTeamIconApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
    readonly iconUpdate: TeamIconUpdate;
  },
  services: TeamApplicationServices = teamApplicationServices,
) {
  const project = await requireTeam(
    input.db,
    input.projectId,
    input.userId,
    "projects:manage",
    services,
  );
  const iconUpdate = decodeTeamIconUpdate(input.iconUpdate);
  if (!(await services.updateTeamIcon(input.db, project.id, iconUpdate))) {
    throw new TeamApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  return {
    ...project,
    icon: iconUpdate.type === "image" ? iconUpdate.dataUrl : null,
    icon_name: iconUpdate.type === "named" ? iconUpdate.name : null,
    icon_color: iconUpdate.type === "named" ? iconUpdate.color : null,
  };
}

export async function updateTeamIssueKeyPrefixApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
    readonly issueKeyPrefix: string;
  },
  services: TeamApplicationServices = teamApplicationServices,
) {
  const project = await requireTeam(
    input.db,
    input.projectId,
    input.userId,
    "projects:manage",
    services,
  );
  const issueKeyPrefix = decodeTeamIssueKeyPrefix(input.issueKeyPrefix);
  if (
    !(await services.updateTeamIssueKeyPrefix(
      input.db,
      project.id,
      issueKeyPrefix,
    ))
  ) {
    throw new TeamApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  return { ...project, issue_key_prefix: issueKeyPrefix };
}

export async function updateTeamTabsApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
    readonly schedule: boolean;
  },
  services: TeamApplicationServices = teamApplicationServices,
) {
  const project = await requireTeam(
    input.db,
    input.projectId,
    input.userId,
    "projects:manage",
    services,
  );
  if (
    !(await services.updateTeamScheduleTabEnabled(
      input.db,
      project.id,
      input.schedule,
    ))
  ) {
    throw new TeamApplicationError(
      "project_not_found",
      "Project not found",
    );
  }
  return { ...project, schedule_tab_enabled: input.schedule ? 1 : 0 };
}

export async function createTeamAgentTokenApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly userId: string;
  },
  services: TeamApplicationServices = teamApplicationServices,
) {
  const project = await requireTeam(
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
    throw new TeamApplicationError(
      "repository_connection_permission_denied",
      "Repository connection permission denied",
    );
  }
  return agentToken;
}
