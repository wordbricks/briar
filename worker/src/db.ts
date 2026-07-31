import {
  isTerminalTrackerState,
  isRepositoryWorkflowPending,
  normalizeAutoHuntWorkflow,
  requiredExecutableWorkflowStages,
  repositoryWorkflowBootstrap,
  workflowStopIndex,
  type AutoHuntQaEnvironment,
  type AutoHuntQaStatus,
  type AutoHuntRunStatus,
  type AutoHuntSource,
  type DashboardStage,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";
import type { StructuredAgentResult } from "../../src/lib/agent-result";
import {
  defaultProjectAgentCalendarColor,
  defaultProjectAgentCopy,
  projectAgentSkill,
} from "../../src/lib/project-agent";
import {
  nextProjectAgentScheduleRunAt,
  parseProjectAgentScheduleDays,
  serializeProjectAgentScheduleDays,
  type ProjectAgentScheduleIntervalUnit,
  type ProjectAgentScheduleNotificationLevel,
  type ProjectAgentScheduleRecurrence,
} from "../../src/lib/project-agent-schedule";

type ProjectAgentProvider = "codex" | "claude" | "grok";
type ModelEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export type ProjectRow = {
  id: string;
  name: string;
  icon: string | null;
  organization_id: string;
  organization_name: string;
  member_role: OrganizationRole;
  created_at: string;
};

export type OrganizationRole = "owner" | "admin" | "member";
export type OrganizationRow = {
  id: string;
  name: string;
  handle: string;
  logo: string | null;
  role: OrganizationRole;
  created_at: string;
};
export type OrganizationMemberRow = {
  user_id: string;
  name: string;
  email: string;
  image: string | null;
  role: OrganizationRole;
  created_at: string;
};

export type SlackInstallationRow = {
  team_id: string;
  team_name: string;
  organization_id: string;
  default_project_id: string | null;
  default_project_name: string | null;
  bot_user_id: string;
  encrypted_bot_token: string;
  token_iv: string;
  installed_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type SlackOAuthStateRow = {
  state_hash: string;
  organization_id: string;
  default_project_id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
};

export type ProjectSettingsRow = {
  project_id: string;
  velen_org: string | null;
  data_source: string | null;
  linear_enabled: number;
  linear_source: string | null;
  linear_team_key: string | null;
  github_repository: string | null;
  workflow_json: string;
  created_at: string;
  updated_at: string;
};

export type ProjectAgentRow = {
  id: string;
  project_id: string;
  name: string;
  avatar: string | null;
  avatar_pet_json: string | null;
  avatar_spritesheet_object_key: string | null;
  provider: ProjectAgentProvider;
  model: string | null;
  responsibility: string;
  skill_markdown: string;
  calendar_color: string;
  created_at: string;
  updated_at: string;
};

export type ProjectAgentSessionRow = {
  project_id: string;
  id: string;
  agent_id: string | null;
  status: "running" | "completed" | "failed" | "interrupted";
  session_type: "task" | "dispatch";
  payload_json: string;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
};

export type ProjectAgentScheduleRow = {
  id: string;
  project_id: string;
  agent_id: string;
  agent_name: string;
  agent_provider: ProjectAgentProvider;
  name: string;
  recurrence: ProjectAgentScheduleRecurrence;
  frequency: ProjectAgentScheduleRecurrence | null;
  time_of_day: string;
  day_of_week: number | null;
  interval_value: number;
  interval_unit: ProjectAgentScheduleIntervalUnit;
  days_of_week: string | null;
  notification_level: ProjectAgentScheduleNotificationLevel;
  time_zone: string;
  enabled: number;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectAgentScheduleRunStatus = "running" | "completed" | "failed";

export type ProjectAgentScheduleRunRow = {
  id: string;
  project_id: string;
  schedule_id: string;
  schedule_name: string;
  agent_id: string;
  agent_name: string;
  agent_provider: ProjectAgentProvider;
  agent_model: string | null;
  agent_responsibility: string;
  agent_skill_markdown: string;
  workflow_json: string;
  status: ProjectAgentScheduleRunStatus;
  scheduled_for: string;
  lease_expires_at: string | null;
  started_at: string;
  completed_at: string | null;
  result_summary: string | null;
  structured_result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type HuntRunRow = {
  id: string;
  run_number: number;
  source: AutoHuntSource;
  source_key: string;
  title: string;
  stage: DashboardStage;
  status: AutoHuntRunStatus;
  workflow_stage: AutoHuntWorkflowStageId | null;
  workflow_snapshot_json: string;
  detail: string | null;
  priority: number | null;
  repository: string;
  branch: string | null;
  commit_sha: string | null;
  tracker_provider: string | null;
  tracker_issue_id: string | null;
  tracker_issue_identifier: string | null;
  tracker_issue_url: string | null;
  tracker_issue_state: string | null;
  issue_description: string | null;
  result_summary: string | null;
  structured_result_json: string | null;
  pull_request_urls: string;
  target_sha: string | null;
  source_created_at: string | null;
  staging_qa_status: AutoHuntQaStatus | null;
  production_qa_status: AutoHuntQaStatus | null;
  staging_qa_detail: string | null;
  production_qa_detail: string | null;
  context_json: string | null;
  current_attempt: number;
  current_revision: number;
  claim_token_hash: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  claim_attempts: number;
  agent_id: string | null;
  preferred_agent_provider: ProjectAgentProvider | null;
  preferred_agent_model: string | null;
  preferred_agent_effort: ModelEffort | null;
  requested_agent_provider: ProjectAgentProvider | null;
  requested_agent_model: string | null;
  requested_agent_effort: ModelEffort | null;
  requested_worker_id: string | null;
  requested_by_user_id: string | null;
  dispatch_mode: "any" | "specific" | null;
  dispatch_request_id: string | null;
  dispatched_at: string | null;
  worker_id: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  last_event_at: string;
  event_count: number;
};

export type IssueDependencyRow = {
  project_id: string;
  prerequisite_run_id: string;
  dependent_run_id: string;
  created_by_user_id: string | null;
  created_at: string;
  prerequisite_run_number: number;
  prerequisite_title: string;
  prerequisite_status: AutoHuntRunStatus;
  dependent_run_number: number;
  dependent_title: string;
  dependent_status: AutoHuntRunStatus;
};

export type IssueDependencyMutationOutcome =
  | "created"
  | "already_exists"
  | "cycle"
  | "ineligible"
  | "not_found";

export type HuntEventRow = {
  id: string;
  run_id: string;
  event_key: string;
  attempt: number;
  revision: number;
  stage: DashboardStage;
  status: AutoHuntRunStatus;
  workflow_stage: AutoHuntWorkflowStageId | null;
  detail: string | null;
  actor: string;
  branch: string | null;
  commit_sha: string | null;
  qa_status: AutoHuntQaStatus | null;
  tracker_issue_state: string | null;
  pull_request_urls: string;
  target_sha: string | null;
  occurred_at: string;
  recorded_at: string;
};

export type RunEvidenceRow = {
  id: string;
  run_id: string;
  attempt: number;
  revision: number;
  evidence_key: string;
  workflow_stage: string;
  evidence_type: string;
  status: "pending" | "passed" | "failed" | "skipped";
  detail: string | null;
  command: string | null;
  url: string | null;
  metadata_json: string | null;
  actor: string;
  observed_at: string;
  recorded_at: string;
};

export type RunEvidenceImageRow = {
  id: string;
  project_id: string;
  run_id: string;
  evidence_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  position: number;
  created_at: string;
};

export type RunEvidenceImageInput = Omit<
  RunEvidenceImageRow,
  "project_id" | "run_id" | "evidence_id" | "created_at"
>;

export type IssueMessageRow = {
  id: string;
  run_id: string;
  parent_message_id: string | null;
  author_user_id: string | null;
  author_agent_provider: "codex" | "claude" | "grok" | null;
  author_name: string | null;
  author_image: string | null;
  body: string;
  reply_count: number;
  created_at: string;
  updated_at: string;
};

export type IssueAgentReplyJobRow = {
  id: string;
  project_id: string;
  run_id: string;
  trigger_message_id: string;
  parent_message_id: string;
  reply_message_id: string;
  status: "queued" | "running" | "completed" | "failed";
  preferred_worker_id: string | null;
  claimed_worker_id: string | null;
  preferred_provider: ProjectAgentProvider | null;
  agent_provider: ProjectAgentProvider | null;
  claim_token_hash: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type IssueConversationNotificationRow = IssueMessageRow & {
  run_title: string;
  root_message_id: string;
  notification_reason: "mention" | "thread_reply";
};

export type DashboardChangeRow = {
  version: number;
  entity_type: "run" | "worker" | "notifications" | "metadata";
  entity_id: string | null;
  operation: "upsert" | "delete" | "replace";
};

export type DashboardChangesPage = {
  currentVersion: number;
  oldestVersion: number | null;
  changes: DashboardChangeRow[];
  hasMore: boolean;
  nextCursor: number;
  expired: boolean;
};

export type IssueAttachmentRow = {
  id: string;
  run_id: string;
  project_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  created_at: string;
};

export type IssueAttachmentInput = Omit<
  IssueAttachmentRow,
  "run_id" | "project_id" | "created_at"
>;

export type TrackerInput = {
  provider: string;
  issueId: string | null;
  identifier: string | null;
  url: string | null;
  state: string | null;
} | null;

export type HuntEventInput = {
  source: AutoHuntSource;
  sourceKey: string;
  title: string;
  stage: DashboardStage;
  status?: AutoHuntRunStatus;
  workflowStage?: AutoHuntWorkflowStageId | null;
  eventKey: string;
  occurredAt: string;
  actor: string;
  repository: string;
  detail: string | null;
  priority: number | null;
  branch: string | null;
  commitSha: string | null;
  tracker: TrackerInput;
  issueDescription: string | null;
  resultSummary: string | null;
  structuredResult: StructuredAgentResult | null;
  pullRequestUrls: string[];
  targetSha: string | null;
  sourceCreatedAt: string | null;
  qaStatus: "pending" | null;
  stagingQaDetail: string | null;
  productionQaDetail: string | null;
  context: Record<string, unknown> | null;
};

export type ProjectSettingsInput = {
  velenOrg: string | null;
  dataSource: string | null;
  linear: {
    enabled: boolean;
    source: string | null;
    teamKey: string | null;
  };
  githubRepository: string | null;
  workflow: AutoHuntWorkflow;
};

export class EventKeyConflictError extends Error {
  constructor() {
    super("Event key was reused with different run data");
  }
}
export class HuntTransitionError extends Error {}
export class HuntClaimError extends Error {}

const DASHBOARD_CHANGE_PAGE_SIZE = 500;
const DASHBOARD_CHANGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export async function getDashboardSyncCursor(
  db: D1Database,
  projectId: string,
) {
  const state = await db
    .prepare(
      `select current_version from briar_dashboard_sync_state
       where project_id = ?`,
    )
    .bind(projectId)
    .first<{ current_version: number }>();
  return state?.current_version ?? 0;
}

export async function listDashboardChanges(
  db: D1Database,
  projectId: string,
  cursor: number,
): Promise<DashboardChangesPage> {
  const currentVersion = await getDashboardSyncCursor(db, projectId);
  const retentionCutoff = new Date(
    Date.now() - DASHBOARD_CHANGE_RETENTION_MS,
  ).toISOString().replace("T", " ").slice(0, 19);
  const stale = await db
    .prepare(
      `select 1 as stale from briar_dashboard_changes
       where project_id = ? and created_at < ? limit 1`,
    )
    .bind(projectId, retentionCutoff)
    .first<{ stale: number }>();
  if (stale) {
    await db
      .prepare(
        `delete from briar_dashboard_changes
         where project_id = ? and created_at < ?`,
      )
      .bind(projectId, retentionCutoff)
      .run();
  }
  const oldest = await db
    .prepare(
      `select min(version) as oldest_version
       from briar_dashboard_changes where project_id = ?`,
    )
    .bind(projectId)
    .first<{ oldest_version: number | null }>();
  const oldestVersion = oldest?.oldest_version ?? null;
  const expired =
    cursor < 0 ||
    cursor > currentVersion ||
    (cursor < currentVersion &&
      (oldestVersion === null || cursor < oldestVersion - 1));
  if (expired) {
    return {
      currentVersion,
      oldestVersion,
      changes: [],
      hasMore: false,
      nextCursor: currentVersion,
      expired: true,
    };
  }

  const result = await db
    .prepare(
      `select version, entity_type, entity_id, operation
       from briar_dashboard_changes
       where project_id = ? and version > ? and version <= ?
       order by version
       limit ?`,
    )
    .bind(projectId, cursor, currentVersion, DASHBOARD_CHANGE_PAGE_SIZE + 1)
    .all<DashboardChangeRow>();
  const hasMore = result.results.length > DASHBOARD_CHANGE_PAGE_SIZE;
  const changes = result.results.slice(0, DASHBOARD_CHANGE_PAGE_SIZE);
  return {
    currentVersion,
    oldestVersion,
    changes,
    hasMore,
    nextCursor: hasMore
      ? (changes.at(-1)?.version ?? cursor)
      : currentVersion,
    expired: false,
  };
}

const stableJson = (value: unknown) => JSON.stringify(value);
const parseWorkflow = (value: string | null | undefined) => {
  if (!value) return structuredClone(repositoryWorkflowBootstrap);
  return normalizeAutoHuntWorkflow(JSON.parse(value) as AutoHuntWorkflow);
};
const normalizedUrls = (urls: string[]) => [...new Set(urls)].sort();
const parseUrls = (value: string | null | undefined) => {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
};

export async function listOrganizations(db: D1Database, userId: string) {
  const result = await db
    .prepare(
      `select organization.id, organization.name, organization.handle,
              coalesce(organization.logo_data_url, organization.logo) as logo,
              membership.role,
              organization.created_at
       from briar_organizations organization
       join briar_organization_members membership
         on membership.organization_id = organization.id
       where membership.user_id = ?
       order by organization.created_at, organization.id`,
    )
    .bind(userId)
    .all<OrganizationRow>();
  return result.results;
}

export async function createOrganization(
  db: D1Database,
  input: { name: string; handle: string; ownerUserId: string },
) {
  const createdAt = new Date().toISOString();
  const organization: OrganizationRow = {
    id: crypto.randomUUID(),
    name: input.name,
    handle: input.handle,
    logo: null,
    role: "owner",
    created_at: createdAt,
  };
  await db.batch([
    db
      .prepare(
        `insert into briar_organizations
         (id, name, handle, created_at, updated_at)
       values (?, ?, ?, ?, ?)`,
      )
      .bind(
        organization.id,
        organization.name,
        organization.handle,
        createdAt,
        createdAt,
      ),
    db
      .prepare(
        `insert into briar_organization_members
         (organization_id, user_id, role, created_at, updated_at)
       values (?, ?, 'owner', ?, ?)`,
      )
      .bind(organization.id, input.ownerUserId, createdAt, createdAt),
  ]);
  return organization;
}

export async function updateOrganization(
  db: D1Database,
  organizationId: string,
  name: string,
  role: OrganizationRole,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_organizations
       set name = ?, updated_at = ?
       where id = ?`,
    )
    .bind(name, updatedAt, organizationId)
    .run();
  if (result.meta.changes === 0) return null;
  return db
    .prepare(
      `select id, name, handle, coalesce(logo_data_url, logo) as logo, created_at
       from briar_organizations
       where id = ?`,
    )
    .bind(organizationId)
    .first<Omit<OrganizationRow, "role">>()
    .then((organization) => (organization ? { ...organization, role } : null));
}

export async function updateOrganizationLogo(
  db: D1Database,
  organizationId: string,
  logo: string | null,
  role: OrganizationRole,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_organizations
       set logo_data_url = ?, logo = null, updated_at = ?
       where id = ?`,
    )
    .bind(logo, updatedAt, organizationId)
    .run();
  if (result.meta.changes === 0) return null;
  return db
    .prepare(
      `select id, name, handle, coalesce(logo_data_url, logo) as logo, created_at
       from briar_organizations
       where id = ?`,
    )
    .bind(organizationId)
    .first<Omit<OrganizationRow, "role">>()
    .then((organization) => (organization ? { ...organization, role } : null));
}

export async function isOrganizationHandleAvailable(
  db: D1Database,
  handle: string,
) {
  const organization = await db
    .prepare(`select 1 as found from briar_organizations where handle = ?`)
    .bind(handle)
    .first<{ found: number }>();
  return organization === null;
}

export async function getOrganizationRole(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const row = await db
    .prepare(
      `select role from briar_organization_members
     where organization_id = ? and user_id = ?`,
    )
    .bind(organizationId, userId)
    .first<{ role: OrganizationRole }>();
  return row?.role ?? null;
}

export async function listOrganizationMembers(
  db: D1Database,
  organizationId: string,
) {
  const result = await db
    .prepare(
      `select member.user_id, user.name, user.email, user.image,
            member.role, member.created_at
     from briar_organization_members member
     join "user" on user.id = member.user_id
     where member.organization_id = ?
     order by case member.role when 'owner' then 0 when 'admin' then 1 else 2 end,
              lower(user.name), lower(user.email)`,
    )
    .bind(organizationId)
    .all<OrganizationMemberRow>();
  return result.results;
}

export async function addOrganizationMember(
  db: D1Database,
  organizationId: string,
  email: string,
  role: Exclude<OrganizationRole, "owner">,
) {
  const user = await db
    .prepare(`select id from "user" where lower(email) = lower(?)`)
    .bind(email)
    .first<{ id: string }>();
  if (!user) return null;
  const now = new Date().toISOString();
  await db
    .prepare(
      `insert into briar_organization_members
       (organization_id, user_id, role, created_at, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict(organization_id, user_id) do update set
       role = excluded.role, updated_at = excluded.updated_at
     where briar_organization_members.role != 'owner'`,
    )
    .bind(organizationId, user.id, role, now, now)
    .run();
  return user.id;
}

export async function updateOrganizationMemberRole(
  db: D1Database,
  organizationId: string,
  userId: string,
  role: Exclude<OrganizationRole, "owner">,
) {
  const result = await db
    .prepare(
      `update briar_organization_members
       set role = ?, updated_at = ?
       where organization_id = ? and user_id = ? and role != 'owner'`,
    )
    .bind(role, new Date().toISOString(), organizationId, userId)
    .run();
  return result.meta.changes > 0;
}

export async function removeOrganizationMember(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_organization_members
     where organization_id = ? and user_id = ? and role != 'owner'`,
    )
    .bind(organizationId, userId)
    .run();
  return result.meta.changes > 0;
}

export async function createSlackOAuthState(
  db: D1Database,
  input: {
    stateHash: string;
    organizationId: string;
    defaultProjectId: string;
    userId: string;
    expiresAt: string;
    createdAt: string;
  },
) {
  await db.batch([
    db
      .prepare(`delete from briar_slack_oauth_states where expires_at <= ?`)
      .bind(input.createdAt),
    db
      .prepare(
        `insert into briar_slack_oauth_states (
           state_hash, organization_id, default_project_id, user_id,
           expires_at, created_at
         ) values (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.stateHash,
        input.organizationId,
        input.defaultProjectId,
        input.userId,
        input.expiresAt,
        input.createdAt,
      ),
  ]);
}

export async function consumeSlackOAuthState(
  db: D1Database,
  stateHash: string,
  now: string,
) {
  const state = await db
    .prepare(
      `select state_hash, organization_id, default_project_id, user_id,
              expires_at, created_at
       from briar_slack_oauth_states
       where state_hash = ? and expires_at > ?`,
    )
    .bind(stateHash, now)
    .first<SlackOAuthStateRow>();
  if (!state) return null;
  const deleted = await db
    .prepare(`delete from briar_slack_oauth_states where state_hash = ?`)
    .bind(stateHash)
    .run();
  return deleted.meta.changes > 0 ? state : null;
}

export async function upsertSlackInstallation(
  db: D1Database,
  input: {
    teamId: string;
    teamName: string;
    organizationId: string;
    defaultProjectId: string;
    botUserId: string;
    encryptedBotToken: string;
    tokenIv: string;
    installedByUserId: string;
    observedAt: string;
  },
) {
  await db
    .prepare(
      `insert into briar_slack_installations (
         team_id, team_name, organization_id, default_project_id, bot_user_id,
         encrypted_bot_token, token_iv, installed_by_user_id,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(team_id) do update set
         team_name = excluded.team_name,
         organization_id = excluded.organization_id,
         default_project_id = excluded.default_project_id,
         bot_user_id = excluded.bot_user_id,
         encrypted_bot_token = excluded.encrypted_bot_token,
         token_iv = excluded.token_iv,
         installed_by_user_id = excluded.installed_by_user_id,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.teamId,
      input.teamName,
      input.organizationId,
      input.defaultProjectId,
      input.botUserId,
      input.encryptedBotToken,
      input.tokenIv,
      input.installedByUserId,
      input.observedAt,
      input.observedAt,
    )
    .run();
}

const slackInstallationSelect = `
  select installation.team_id, installation.team_name,
         installation.organization_id, installation.default_project_id,
         project.name as default_project_name, installation.bot_user_id,
         installation.encrypted_bot_token, installation.token_iv,
         installation.installed_by_user_id, installation.created_at,
         installation.updated_at
  from briar_slack_installations installation
  left join briar_projects project on project.id = installation.default_project_id
`;

export async function getSlackInstallation(
  db: D1Database,
  teamId: string,
) {
  return db
    .prepare(`${slackInstallationSelect} where installation.team_id = ?`)
    .bind(teamId)
    .first<SlackInstallationRow>();
}

export async function listSlackInstallations(
  db: D1Database,
  organizationId: string,
) {
  const result = await db
    .prepare(
      `${slackInstallationSelect}
       where installation.organization_id = ?
       order by installation.created_at`,
    )
    .bind(organizationId)
    .all<SlackInstallationRow>();
  return result.results;
}

export async function updateSlackInstallationProject(
  db: D1Database,
  organizationId: string,
  teamId: string,
  projectId: string,
) {
  const result = await db
    .prepare(
      `update briar_slack_installations
       set default_project_id = ?, updated_at = ?
       where organization_id = ? and team_id = ?
         and exists (
           select 1 from briar_projects
           where id = ? and organization_id = ?
         )`,
    )
    .bind(
      projectId,
      new Date().toISOString(),
      organizationId,
      teamId,
      projectId,
      organizationId,
    )
    .run();
  return result.meta.changes > 0;
}

export async function deleteSlackInstallation(
  db: D1Database,
  organizationId: string,
  teamId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_slack_installations
       where organization_id = ? and team_id = ?`,
    )
    .bind(organizationId, teamId)
    .run();
  return result.meta.changes > 0;
}

export async function claimSlackEvent(
  db: D1Database,
  teamId: string,
  eventId: string,
  claimedAt: string,
  staleBefore: string,
) {
  const retentionBefore = new Date(
    Date.parse(claimedAt) - 30 * 24 * 60 * 60_000,
  ).toISOString();
  await db
    .prepare(
      `delete from briar_slack_events
       where coalesce(completed_at, claimed_at) < ?`,
    )
    .bind(retentionBefore)
    .run();
  const result = await db
    .prepare(
      `insert into briar_slack_events (
         team_id, event_id, status, claimed_at, completed_at
       ) values (?, ?, 'processing', ?, null)
       on conflict(team_id, event_id) do update set
         status = 'processing', claimed_at = excluded.claimed_at,
         completed_at = null
       where briar_slack_events.status = 'processing'
         and briar_slack_events.claimed_at < ?`,
    )
    .bind(teamId, eventId, claimedAt, staleBefore)
    .run();
  return result.meta.changes > 0;
}

export async function completeSlackEvent(
  db: D1Database,
  teamId: string,
  eventId: string,
  completedAt: string,
) {
  await db
    .prepare(
      `update briar_slack_events
       set status = 'completed', completed_at = ?
       where team_id = ? and event_id = ?`,
    )
    .bind(completedAt, teamId, eventId)
    .run();
}

export async function releaseSlackEvent(
  db: D1Database,
  teamId: string,
  eventId: string,
) {
  await db
    .prepare(
      `delete from briar_slack_events
       where team_id = ? and event_id = ? and status = 'processing'`,
    )
    .bind(teamId, eventId)
    .run();
}

export async function listProjects(db: D1Database, userId: string) {
  const result = await db
    .prepare(
      `select project.id, project.name,
              coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
              project.organization_id,
              organization.name as organization_name,
              membership.role as member_role, project.created_at
       from briar_projects project
       join briar_organizations organization on organization.id = project.organization_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       order by organization.created_at, project.created_at`,
    )
    .bind(userId)
    .all<ProjectRow>();
  return result.results;
}

export async function listOrganizationProjects(
  db: D1Database,
  organizationId: string,
) {
  const result = await db
    .prepare(
      `select project.id, project.name,
              coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
              project.organization_id,
              organization.name as organization_name,
              'member' as member_role, project.created_at
       from briar_projects project
       join briar_organizations organization
         on organization.id = project.organization_id
       where project.organization_id = ?
       order by project.created_at`,
    )
    .bind(organizationId)
    .all<ProjectRow>();
  return result.results;
}

export async function createProject(
  db: D1Database,
  input: {
    ownerUserId: string;
    organizationId: string;
    name: string;
    agentTokenHash: string;
  },
) {
  const createdAt = new Date().toISOString();
  const project: ProjectRow = {
    id: crypto.randomUUID(),
    name: input.name,
    icon: null,
    organization_id: input.organizationId,
    organization_name: "",
    member_role: "owner",
    created_at: createdAt,
  };
  const defaultAgentCopy = defaultProjectAgentCopy("en");
  const defaultAgent: ProjectAgentRow = {
    id: crypto.randomUUID(),
    project_id: project.id,
    name: defaultAgentCopy.name,
    avatar: null,
    avatar_pet_json: null,
    avatar_spritesheet_object_key: null,
    provider: "codex",
    model: null,
    responsibility: defaultAgentCopy.responsibility,
    skill_markdown: projectAgentSkill({
      ...defaultAgentCopy,
    }),
    calendar_color: defaultProjectAgentCalendarColor,
    created_at: createdAt,
    updated_at: createdAt,
  };
  await db.batch([
    db
      .prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        project.id,
        input.ownerUserId,
        input.organizationId,
        project.name,
        input.agentTokenHash,
        createdAt,
        createdAt,
      ),
    db
      .prepare(
        `insert into briar_project_settings (
           project_id, workflow_json, created_at, updated_at
         ) values (?, ?, ?, ?)`,
      )
      .bind(
        project.id,
        stableJson(repositoryWorkflowBootstrap),
        createdAt,
        createdAt,
      ),
    db
      .prepare(
        `insert into briar_project_agents (
           id, project_id, name, provider, model, responsibility,
           skill_markdown, calendar_color, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        defaultAgent.id,
        defaultAgent.project_id,
        defaultAgent.name,
        defaultAgent.provider,
        defaultAgent.model,
        defaultAgent.responsibility,
        defaultAgent.skill_markdown,
        defaultAgent.calendar_color,
        defaultAgent.created_at,
        defaultAgent.updated_at,
      ),
  ]);
  return project;
}

export async function getProject(
  db: D1Database,
  projectId: string,
  userId: string,
) {
  return await db
    .prepare(
      `select project.id, project.name,
              coalesce(project.icon_data_url_browser, project.icon_data_url) as icon,
              project.organization_id,
              organization.name as organization_name,
              membership.role as member_role, project.created_at
       from briar_projects project
       join briar_organizations organization on organization.id = project.organization_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       where project.id = ?`,
    )
    .bind(userId, projectId)
    .first<ProjectRow>();
}

export async function updateProjectIcon(
  db: D1Database,
  projectId: string,
  icon: string | null,
) {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `update briar_projects
       set icon_data_url_browser = ?, icon_data_url = null, updated_at = ?
       where id = ?`,
    )
    .bind(icon, updatedAt, projectId)
    .run();
  return result.meta.changes > 0;
}

export async function deleteProject(
  db: D1Database,
  projectId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_projects
       where id = ? and organization_id in (
         select organization_id from briar_organization_members
         where user_id = ? and role = 'owner'
       )`,
    )
    .bind(projectId, userId)
    .run();
  return result.meta.changes > 0;
}

export async function listProjectAgents(db: D1Database, projectId: string) {
  const result = await db
    .prepare(
      `select id, project_id, name, avatar, avatar_pet_json,
              avatar_spritesheet_object_key, provider, model, responsibility, skill_markdown, calendar_color,
              created_at, updated_at
       from briar_project_agents
       where project_id = ?
       order by created_at, id`,
    )
    .bind(projectId)
    .all<ProjectAgentRow>();
  return result.results;
}

export async function getProjectAgent(
  db: D1Database,
  projectId: string,
  agentId: string,
) {
  return db
    .prepare(
      `select id, project_id, name, avatar, avatar_pet_json,
              avatar_spritesheet_object_key, provider, model, responsibility,
              skill_markdown, calendar_color, created_at, updated_at
       from briar_project_agents
       where id = ? and project_id = ?`,
    )
    .bind(agentId, projectId)
    .first<ProjectAgentRow>();
}

export async function listProjectAgentSessions(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `select project_id, id, agent_id, status, session_type, payload_json,
              started_at, completed_at, updated_at
       from briar_project_agent_sessions
       where project_id = ?
       order by updated_at desc, id
       limit 200`,
    )
    .bind(projectId)
    .all<ProjectAgentSessionRow>();
  return result.results;
}

export async function upsertProjectAgentSession(
  db: D1Database,
  input: ProjectAgentSessionRow,
) {
  await db
    .prepare(
      `insert into briar_project_agent_sessions (
         project_id, id, agent_id, status, session_type, payload_json,
         started_at, completed_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (project_id, id) do update set
         agent_id = excluded.agent_id,
         status = excluded.status,
         session_type = excluded.session_type,
         payload_json = excluded.payload_json,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at
       where excluded.updated_at > briar_project_agent_sessions.updated_at`,
    )
    .bind(
      input.project_id,
      input.id,
      input.agent_id,
      input.status,
      input.session_type,
      input.payload_json,
      input.started_at,
      input.completed_at,
      input.updated_at,
    )
    .run();
  return db
    .prepare(
      `select project_id, id, agent_id, status, session_type, payload_json,
              started_at, completed_at, updated_at
       from briar_project_agent_sessions
       where project_id = ? and id = ?`,
    )
    .bind(input.project_id, input.id)
    .first<ProjectAgentSessionRow>();
}

export async function createProjectAgent(
  db: D1Database,
  projectId: string,
  input: {
    name: string;
    avatar?: string | null;
    avatarPetJson?: string | null;
    avatarSpritesheetObjectKey?: string | null;
    provider: ProjectAgentProvider;
    model: string | null;
    responsibility: string;
    calendarColor: string;
  },
) {
  const createdAt = new Date().toISOString();
  const agent: ProjectAgentRow = {
    id: crypto.randomUUID(),
    project_id: projectId,
    name: input.name,
    avatar: input.avatar ?? null,
    avatar_pet_json: input.avatarPetJson ?? null,
    avatar_spritesheet_object_key: input.avatarSpritesheetObjectKey ?? null,
    provider: input.provider,
    model: input.model,
    responsibility: input.responsibility,
    skill_markdown: projectAgentSkill({
      name: input.name,
      responsibility: input.responsibility,
    }),
    calendar_color: input.calendarColor,
    created_at: createdAt,
    updated_at: createdAt,
  };
  await db
    .prepare(
      `insert into briar_project_agents (
         id, project_id, name, avatar, avatar_pet_json,
         avatar_spritesheet_object_key, provider, model, responsibility,
         skill_markdown, calendar_color, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      agent.id,
      agent.project_id,
      agent.name,
      agent.avatar,
      agent.avatar_pet_json,
      agent.avatar_spritesheet_object_key,
      agent.provider,
      agent.model,
      agent.responsibility,
      agent.skill_markdown,
      agent.calendar_color,
      agent.created_at,
      agent.updated_at,
    )
    .run();
  return agent;
}

export async function deleteProjectAgent(
  db: D1Database,
  projectId: string,
  agentId: string,
) {
  const deleted = await db
    .prepare(
      `delete from briar_project_agents
       where id = ? and project_id = ?
         and not exists (
           select 1 from briar_project_agent_schedule_runs
           where project_id = ? and agent_id = ? and status = 'running'
         )
       returning id, project_id, name, avatar, avatar_pet_json,
                 avatar_spritesheet_object_key, provider, model,
                 responsibility, skill_markdown, calendar_color,
                 created_at, updated_at`,
    )
    .bind(agentId, projectId, projectId, agentId)
    .first<ProjectAgentRow>();
  if (deleted) return deleted;
  return (await getProjectAgent(db, projectId, agentId)) ? "running" : null;
}

type ProjectAgentScheduleInput = {
  agentId: string;
  name: string;
  recurrence: ProjectAgentScheduleRecurrence;
  timeOfDay: string;
  dayOfWeek: number | null;
  intervalValue?: number;
  intervalUnit?: ProjectAgentScheduleIntervalUnit;
  daysOfWeek?: number[];
  notificationLevel?: ProjectAgentScheduleNotificationLevel;
  timeZone: string;
};

function persistedProjectAgentScheduleRecurrence(
  input: ProjectAgentScheduleInput,
): "daily" | "weekdays" | "weekly" {
  if (input.recurrence === "interval") return "daily";
  if (input.recurrence === "custom") return "daily";
  return input.recurrence;
}

export async function listProjectAgentSchedules(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `select schedule.id, schedule.project_id, schedule.agent_id,
              agent.name as agent_name, agent.provider as agent_provider,
              schedule.name, schedule.recurrence, schedule.frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.notification_level,
              schedule.time_zone, schedule.enabled,
              schedule.next_run_at,
              schedule.created_at, schedule.updated_at
       from briar_project_agent_schedules schedule
       join briar_project_agents agent on agent.id = schedule.agent_id
       where schedule.project_id = ?
       order by schedule.created_at, schedule.id`,
    )
    .bind(projectId)
    .all<ProjectAgentScheduleRow>();
  return result.results;
}

export async function createProjectAgentSchedule(
  db: D1Database,
  projectId: string,
  input: ProjectAgentScheduleInput,
) {
  const agent = await db
    .prepare(
      `select id
       from briar_project_agents
       where id = ? and project_id = ?`,
    )
    .bind(input.agentId, projectId)
    .first<{ id: string }>();
  if (!agent) return null;

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const nextRunAt = nextProjectAgentScheduleRunAt(
    {
      recurrence: input.recurrence,
      timeOfDay: input.timeOfDay,
      dayOfWeek: input.dayOfWeek,
      intervalValue: input.intervalValue,
      intervalUnit: input.intervalUnit,
      daysOfWeek: input.daysOfWeek,
      anchorAt: createdAt,
      timeZone: input.timeZone,
    },
    new Date(
      Date.parse(createdAt) -
        (input.recurrence === "interval" ? 0 : 60_000),
    ),
  );
  const persistedRecurrence = persistedProjectAgentScheduleRecurrence(input);
  await db
    .prepare(
      `insert into briar_project_agent_schedules (
         id, project_id, agent_id, name, recurrence, frequency, time_of_day,
         day_of_week, interval_value, interval_unit, days_of_week,
         notification_level, time_zone, enabled, next_run_at, created_at,
         updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(
      id,
      projectId,
      input.agentId,
      input.name,
      persistedRecurrence,
      input.recurrence,
      input.timeOfDay,
      input.dayOfWeek,
      input.intervalValue ?? 1,
      input.intervalUnit ??
        (input.recurrence === "interval" ? "hour" : "day"),
      serializeProjectAgentScheduleDays(input.daysOfWeek),
      input.notificationLevel ?? "important_updates",
      input.timeZone,
      nextRunAt,
      createdAt,
      createdAt,
    )
    .run();

  return await db
    .prepare(
      `select schedule.id, schedule.project_id, schedule.agent_id,
              agent.name as agent_name, agent.provider as agent_provider,
              schedule.name, schedule.recurrence, schedule.frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.notification_level,
              schedule.time_zone, schedule.enabled,
              schedule.next_run_at,
              schedule.created_at, schedule.updated_at
       from briar_project_agent_schedules schedule
       join briar_project_agents agent on agent.id = schedule.agent_id
       where schedule.id = ? and schedule.project_id = ?`,
    )
    .bind(id, projectId)
    .first<ProjectAgentScheduleRow>();
}

export async function updateProjectAgentSchedule(
  db: D1Database,
  projectId: string,
  scheduleId: string,
  input: ProjectAgentScheduleInput,
) {
  const observedAt = new Date().toISOString();
  const existing = await db
    .prepare(
      `select created_at
       from briar_project_agent_schedules
       where id = ? and project_id = ?`,
    )
    .bind(scheduleId, projectId)
    .first<{ created_at: string }>();
  const nextRunAt = nextProjectAgentScheduleRunAt(
    {
      recurrence: input.recurrence,
      timeOfDay: input.timeOfDay,
      dayOfWeek: input.dayOfWeek,
      intervalValue: input.intervalValue,
      intervalUnit: input.intervalUnit,
      daysOfWeek: input.daysOfWeek,
      anchorAt: existing?.created_at ?? observedAt,
      timeZone: input.timeZone,
    },
    new Date(
      Date.parse(observedAt) -
        (input.recurrence === "interval" ? 0 : 60_000),
    ),
  );
  const persistedRecurrence = persistedProjectAgentScheduleRecurrence(input);
  const updated = await db
    .prepare(
      `update briar_project_agent_schedules
       set agent_id = ?, name = ?, recurrence = ?, frequency = ?,
           time_of_day = ?, day_of_week = ?, interval_value = ?,
           interval_unit = ?, days_of_week = ?, notification_level = ?,
           time_zone = ?, next_run_at = ?, updated_at = ?
       where id = ? and project_id = ?
         and exists (
           select 1 from briar_project_agents agent
           where agent.id = ? and agent.project_id = ?
         )
       returning id`,
    )
    .bind(
      input.agentId,
      input.name,
      persistedRecurrence,
      input.recurrence,
      input.timeOfDay,
      input.dayOfWeek,
      input.intervalValue ?? 1,
      input.intervalUnit ??
        (input.recurrence === "interval" ? "hour" : "day"),
      serializeProjectAgentScheduleDays(input.daysOfWeek),
      input.notificationLevel ?? "important_updates",
      input.timeZone,
      nextRunAt,
      observedAt,
      scheduleId,
      projectId,
      input.agentId,
      projectId,
    )
    .first<{ id: string }>();
  if (!updated) return null;
  return db
    .prepare(
      `select schedule.id, schedule.project_id, schedule.agent_id,
              agent.name as agent_name, agent.provider as agent_provider,
              schedule.name, schedule.recurrence, schedule.frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.notification_level,
              schedule.time_zone, schedule.enabled,
              schedule.next_run_at,
              schedule.created_at, schedule.updated_at
       from briar_project_agent_schedules schedule
       join briar_project_agents agent on agent.id = schedule.agent_id
       where schedule.id = ? and schedule.project_id = ?`,
    )
    .bind(scheduleId, projectId)
    .first<ProjectAgentScheduleRow>();
}

export async function deleteProjectAgentSchedule(
  db: D1Database,
  projectId: string,
  scheduleId: string,
): Promise<"deleted" | "running" | "not_found"> {
  const result = await db
    .prepare(
      `delete from briar_project_agent_schedules
       where id = ? and project_id = ?
         and not exists (
           select 1 from briar_project_agent_schedule_runs run
           where run.schedule_id = briar_project_agent_schedules.id
             and run.project_id = briar_project_agent_schedules.project_id
             and run.status = 'running'
         )`,
    )
    .bind(scheduleId, projectId)
    .run();
  if (result.meta.changes === 1) return "deleted";
  const schedule = await db
    .prepare(
      `select id from briar_project_agent_schedules
       where id = ? and project_id = ?`,
    )
    .bind(scheduleId, projectId)
    .first<{ id: string }>();
  return schedule ? "running" : "not_found";
}

const scheduleRunSelect = `
  select run.id, run.project_id, run.schedule_id,
         schedule.name as schedule_name,
         run.agent_id, agent.name as agent_name,
         agent.provider as agent_provider, agent.model as agent_model,
         agent.responsibility as agent_responsibility,
         agent.skill_markdown as agent_skill_markdown,
         settings.workflow_json,
         run.status, run.scheduled_for, run.lease_expires_at,
         run.started_at, run.completed_at, run.result_summary,
         run.structured_result_json, run.error,
         run.created_at, run.updated_at
  from briar_project_agent_schedule_runs run
  join briar_project_agent_schedules schedule on schedule.id = run.schedule_id
  join briar_project_agents agent on agent.id = run.agent_id
  join briar_project_settings settings on settings.project_id = run.project_id`;

export async function listProjectAgentScheduleRuns(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `${scheduleRunSelect}
       where run.project_id = ?
       order by run.started_at desc, run.id`,
    )
    .bind(projectId)
    .all<ProjectAgentScheduleRunRow>();
  return result.results;
}

export const PROJECT_AGENT_SCHEDULE_LEASE_MS = 2 * 60 * 60_000;

const scheduleLeaseExpiresAt = (observedAt: string) =>
  new Date(
    Date.parse(observedAt) + PROJECT_AGENT_SCHEDULE_LEASE_MS,
  ).toISOString();

async function initializeProjectAgentScheduleNextRuns(
  db: D1Database,
  projectId: string,
  observedAt: string,
) {
  const schedules = await db
    .prepare(
      `select id, coalesce(frequency, recurrence) as frequency,
              time_of_day, day_of_week, interval_value, interval_unit,
              days_of_week, time_zone, created_at
       from briar_project_agent_schedules
       where project_id = ? and enabled = 1 and next_run_at is null`,
    )
    .bind(projectId)
    .all<{
      id: string;
      frequency: ProjectAgentScheduleRecurrence;
      time_of_day: string;
      day_of_week: number | null;
      interval_value: number;
      interval_unit: ProjectAgentScheduleIntervalUnit;
      days_of_week: string | null;
      time_zone: string;
      created_at: string;
    }>();
  for (const schedule of schedules.results ?? []) {
    const startAt = Math.min(
      Date.parse(observedAt),
      Date.parse(schedule.created_at),
    );
    const nextRunAt = nextProjectAgentScheduleRunAt(
      {
        recurrence: schedule.frequency,
        timeOfDay: schedule.time_of_day,
        dayOfWeek: schedule.day_of_week,
        intervalValue: schedule.interval_value,
        intervalUnit: schedule.interval_unit,
        daysOfWeek: parseProjectAgentScheduleDays(schedule.days_of_week),
        anchorAt: schedule.created_at,
        timeZone: schedule.time_zone,
      },
      new Date(
        startAt - (schedule.frequency === "interval" ? 0 : 60_000),
      ),
    );
    await db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = ?, updated_at = ?
         where id = ? and project_id = ? and next_run_at is null`,
      )
      .bind(nextRunAt, observedAt, schedule.id, projectId)
      .run();
  }
}

async function reclaimExpiredProjectAgentScheduleRun(
  db: D1Database,
  projectId: string,
  input: {
    claimTokenHash: string;
    observedAt: string;
  },
) {
  const expired = await db
    .prepare(
      `select id
       from briar_project_agent_schedule_runs
       where project_id = ? and status = 'running'
         and lease_expires_at is not null and lease_expires_at <= ?
       order by scheduled_for, id
       limit 1`,
    )
    .bind(projectId, input.observedAt)
    .first<{ id: string }>();
  if (!expired) return null;
  const run = await db
    .prepare(
      `update briar_project_agent_schedule_runs
       set claim_token_hash = ?, lease_expires_at = ?,
           started_at = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and lease_expires_at is not null and lease_expires_at <= ?
       returning id`,
    )
    .bind(
      input.claimTokenHash,
      scheduleLeaseExpiresAt(input.observedAt),
      input.observedAt,
      input.observedAt,
      expired.id,
      projectId,
      input.observedAt,
    )
    .first<{ id: string }>();
  if (!run) return null;
  return db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(run.id, projectId)
    .first<ProjectAgentScheduleRunRow>();
}

export async function claimDueProjectAgentScheduleRun(
  db: D1Database,
  projectId: string,
  input: {
    claimTokenHash: string;
    observedAt: string;
  },
) {
  const reclaimed = await reclaimExpiredProjectAgentScheduleRun(
    db,
    projectId,
    input,
  );
  if (reclaimed) return reclaimed;

  await initializeProjectAgentScheduleNextRuns(db, projectId, input.observedAt);
  const schedule = await db
    .prepare(
      `select schedule.id, schedule.agent_id, schedule.next_run_at,
              coalesce(schedule.frequency, schedule.recurrence) as frequency,
              schedule.time_of_day, schedule.day_of_week,
              schedule.interval_value, schedule.interval_unit,
              schedule.days_of_week, schedule.time_zone, schedule.created_at
       from briar_project_agent_schedules schedule
       where schedule.project_id = ? and schedule.enabled = 1
         and schedule.next_run_at is not null
         and schedule.next_run_at <= ?
         and not exists (
           select 1 from briar_project_agent_schedule_runs active
           where active.schedule_id = schedule.id and active.status = 'running'
             and active.lease_expires_at > ?
         )
       order by schedule.next_run_at, schedule.id
       limit 1`,
    )
    .bind(projectId, input.observedAt, input.observedAt)
    .first<{
      id: string;
      agent_id: string;
      next_run_at: string;
      frequency: ProjectAgentScheduleRecurrence;
      time_of_day: string;
      day_of_week: number | null;
      interval_value: number;
      interval_unit: ProjectAgentScheduleIntervalUnit;
      days_of_week: string | null;
      time_zone: string;
      created_at: string;
    }>();
  if (!schedule) return null;

  const nextRunAt = nextProjectAgentScheduleRunAt(
    {
      recurrence: schedule.frequency,
      timeOfDay: schedule.time_of_day,
      dayOfWeek: schedule.day_of_week,
      intervalValue: schedule.interval_value,
      intervalUnit: schedule.interval_unit,
      daysOfWeek: parseProjectAgentScheduleDays(schedule.days_of_week),
      anchorAt: schedule.created_at,
      timeZone: schedule.time_zone,
    },
    new Date(
      Math.max(Date.parse(schedule.next_run_at), Date.parse(input.observedAt)),
    ),
  );
  const runId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `insert or ignore into briar_project_agent_schedule_runs (
           id, project_id, schedule_id, agent_id, status, scheduled_for,
           claim_token_hash, lease_expires_at, started_at, created_at, updated_at
         )
         select ?, ?, schedule.id, schedule.agent_id, 'running',
                schedule.next_run_at, ?, ?, ?, ?, ?
         from briar_project_agent_schedules schedule
         where schedule.id = ? and schedule.project_id = ?
           and schedule.enabled = 1 and schedule.next_run_at = ?
           and not exists (
             select 1 from briar_project_agent_schedule_runs active
             where active.schedule_id = schedule.id and active.status = 'running'
               and active.lease_expires_at > ?
           )`,
      )
      .bind(
        runId,
        projectId,
        input.claimTokenHash,
        scheduleLeaseExpiresAt(input.observedAt),
        input.observedAt,
        input.observedAt,
        input.observedAt,
        schedule.id,
        projectId,
        schedule.next_run_at,
        input.observedAt,
      ),
    db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = ?, updated_at = ?
         where id = ? and project_id = ? and next_run_at = ?
           and exists (
             select 1 from briar_project_agent_schedule_runs run
             where run.id = ? and run.claim_token_hash = ?
           )`,
      )
      .bind(
        nextRunAt,
        input.observedAt,
        schedule.id,
        projectId,
        schedule.next_run_at,
        runId,
        input.claimTokenHash,
      ),
  ]);
  return db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(runId, projectId)
    .first<ProjectAgentScheduleRunRow>();
}

export async function completeProjectAgentScheduleRun(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    claimTokenHash: string;
    status: Exclude<ProjectAgentScheduleRunStatus, "running">;
    resultSummary: string | null;
    structuredResult: StructuredAgentResult;
    error: string | null;
    observedAt: string;
  },
) {
  const row = await db
    .prepare(
      `update briar_project_agent_schedule_runs
       set status = ?, claim_token_hash = null, lease_expires_at = null,
           completed_at = ?, result_summary = ?, structured_result_json = ?,
           error = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claim_token_hash = ?
       returning id`,
    )
    .bind(
      input.status,
      input.observedAt,
      input.resultSummary,
      stableJson(input.structuredResult),
      input.error,
      input.observedAt,
      runId,
      projectId,
      input.claimTokenHash,
    )
    .first<{ id: string }>();
  if (!row) return null;
  return db
    .prepare(`${scheduleRunSelect} where run.id = ? and run.project_id = ?`)
    .bind(runId, projectId)
    .first<ProjectAgentScheduleRunRow>();
}

export async function renewProjectAgentScheduleRunLease(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    claimTokenHash: string;
    observedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_project_agent_schedule_runs
       set lease_expires_at = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claim_token_hash = ?
       returning id, lease_expires_at`,
    )
    .bind(
      scheduleLeaseExpiresAt(input.observedAt),
      input.observedAt,
      runId,
      projectId,
      input.claimTokenHash,
    )
    .first<{ id: string; lease_expires_at: string }>();
}

export async function updateProjectAgent(
  db: D1Database,
  projectId: string,
  agentId: string,
  input: {
    name: string;
    avatar?: string | null;
    codexPet?: {
      json: string;
      objectKey: string;
    } | null;
    provider: ProjectAgentProvider;
    model: string | null;
    responsibility: string;
    calendarColor: string;
  },
) {
  const updatedAt = new Date().toISOString();
  const existing = await getProjectAgent(db, projectId, agentId);
  if (!existing) return null;
  const skill = projectAgentSkill({
    name: input.name,
    responsibility: input.responsibility,
  });
  const result = await db
    .prepare(
      `update briar_project_agents
       set name = ?, avatar = case when ? = 1 then ? else avatar end,
           avatar_pet_json = case when ? = 1 then ? else avatar_pet_json end,
           avatar_spritesheet_object_key =
             case when ? = 1 then ? else avatar_spritesheet_object_key end,
           provider = ?, model = ?, responsibility = ?,
           skill_markdown = ?, calendar_color = ?, updated_at = ?
       where id = ? and project_id = ?`,
    )
    .bind(
      input.name,
      input.avatar === undefined ? 0 : 1,
      input.avatar ?? null,
      input.codexPet === undefined ? 0 : 1,
      input.codexPet ? input.codexPet.json : null,
      input.codexPet === undefined ? 0 : 1,
      input.codexPet ? input.codexPet.objectKey : null,
      input.provider,
      input.model,
      input.responsibility,
      skill,
      input.calendarColor,
      updatedAt,
      agentId,
      projectId,
    )
    .run();
  if (result.meta.changes === 0) return null;
  return db
    .prepare(
      `select id, project_id, name, avatar, avatar_pet_json,
              avatar_spritesheet_object_key, provider, model, responsibility, skill_markdown, calendar_color,
              created_at, updated_at
       from briar_project_agents
       where id = ? and project_id = ?`,
    )
    .bind(agentId, projectId)
    .first<ProjectAgentRow>();
}

export async function getProjectSettings(db: D1Database, projectId: string) {
  return await db
    .prepare(
      `select project_id, velen_org, data_source, linear_enabled,
              linear_source, linear_team_key, github_repository, workflow_json,
              created_at, updated_at
       from briar_project_settings
       where project_id = ?`,
    )
    .bind(projectId)
    .first<ProjectSettingsRow>();
}

export async function updateProjectSettings(
  db: D1Database,
  projectId: string,
  input: ProjectSettingsInput,
) {
  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      `insert into briar_project_settings (
         project_id, velen_org, data_source, linear_enabled, linear_source,
         linear_team_key, github_repository, workflow_json, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(project_id) do update set
         velen_org = excluded.velen_org,
         data_source = excluded.data_source,
         linear_enabled = excluded.linear_enabled,
         linear_source = excluded.linear_source,
         linear_team_key = excluded.linear_team_key,
         github_repository = excluded.github_repository,
         workflow_json = excluded.workflow_json,
         updated_at = excluded.updated_at`,
    )
    .bind(
      projectId,
      input.velenOrg,
      input.dataSource,
      input.linear.enabled ? 1 : 0,
      input.linear.enabled ? input.linear.source : null,
      input.linear.enabled ? input.linear.teamKey : null,
      input.githubRepository,
      stableJson(normalizeAutoHuntWorkflow(input.workflow)),
      updatedAt,
      updatedAt,
    )
    .run();
  return await getProjectSettings(db, projectId);
}

export async function listDashboardRuns(db: D1Database, projectId: string) {
  const runs = await db
    .prepare(
      `select run.id, run.run_number, run.source, run.source_key, run.title,
              run.stage, run.status, run.workflow_stage,
              run.workflow_snapshot_json, run.detail, run.priority,
              run.repository, run.branch,
              run.commit_sha, run.tracker_provider, run.tracker_issue_id,
              run.tracker_issue_identifier, run.tracker_issue_url,
              run.tracker_issue_state, run.issue_description,
              run.result_summary, run.structured_result_json,
              run.pull_request_urls, run.target_sha,
              run.source_created_at, run.staging_qa_status,
              run.production_qa_status, run.staging_qa_detail,
              run.production_qa_detail, run.context_json,
              run.current_attempt, run.claimed_by, run.claimed_at,
              run.current_revision, run.lease_expires_at, run.claim_attempts,
              run.agent_id, run.preferred_agent_provider,
              run.preferred_agent_model, run.preferred_agent_effort,
              run.requested_agent_provider, run.requested_agent_model,
              run.requested_agent_effort, run.requested_worker_id,
              run.requested_by_user_id, run.dispatch_mode,
              run.dispatch_request_id, run.dispatched_at, run.worker_id,
              run.started_at,
              run.updated_at, run.completed_at, run.last_event_at,
              (select count(*) from briar_hunt_events event
               where event.run_id = run.id) as event_count
       from briar_hunt_runs run
       where run.project_id = ?
       order by
         case when run.status in ('completed', 'cancelled') then 1 else 0 end,
         run.updated_at desc
       limit 200`,
    )
    .bind(projectId)
    .all<HuntRunRow>();

  const events = await db
    .prepare(
      `select ranked.id, ranked.run_id, ranked.event_key, ranked.attempt,
              ranked.stage, ranked.status, ranked.workflow_stage,
              ranked.detail, ranked.actor, ranked.branch, ranked.commit_sha,
              ranked.qa_status, ranked.tracker_issue_state,
              ranked.pull_request_urls, ranked.target_sha,
              ranked.occurred_at, ranked.recorded_at
       from (
         select event.*,
                row_number() over (
                  partition by event.run_id
                  order by event.occurred_at desc, event.id desc
                ) as event_rank
         from briar_hunt_events event
         join briar_hunt_runs run on run.id = event.run_id
         where run.project_id = ?
       ) ranked
       where ranked.event_rank <= 20
       order by ranked.occurred_at desc, ranked.id desc`,
    )
    .bind(projectId)
    .all<HuntEventRow>();

  return { runs: runs.results, events: events.results };
}

export async function listIssueDependencies(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `select dependency.project_id, dependency.prerequisite_run_id,
              dependency.dependent_run_id, dependency.created_by_user_id,
              dependency.created_at,
              prerequisite.run_number as prerequisite_run_number,
              prerequisite.title as prerequisite_title,
              prerequisite.status as prerequisite_status,
              dependent.run_number as dependent_run_number,
              dependent.title as dependent_title,
              dependent.status as dependent_status
       from briar_issue_dependencies dependency
       join briar_hunt_runs prerequisite
         on prerequisite.id = dependency.prerequisite_run_id
       join briar_hunt_runs dependent
         on dependent.id = dependency.dependent_run_id
       where dependency.project_id = ?
       order by dependency.created_at, dependency.prerequisite_run_id,
                dependency.dependent_run_id`,
    )
    .bind(projectId)
    .all<IssueDependencyRow>();
  return result.results;
}

export async function createIssueDependency(
  db: D1Database,
  projectId: string,
  input: {
    prerequisiteRunId: string;
    dependentRunId: string;
    createdByUserId: string;
    createdAt: string;
  },
): Promise<IssueDependencyMutationOutcome> {
  const inserted = await db
    .prepare(
      `with recursive reachable(run_id) as (
         values (?)
         union
         select dependency.dependent_run_id
         from briar_issue_dependencies dependency
         join reachable
           on reachable.run_id = dependency.prerequisite_run_id
         where dependency.project_id = ?
       )
       insert into briar_issue_dependencies (
         project_id, prerequisite_run_id, dependent_run_id,
         created_by_user_id, created_at
       )
       select ?, ?, ?, ?, ?
       where exists (
         select 1 from briar_hunt_runs
         where id = ? and project_id = ?
       )
         and exists (
           select 1 from briar_hunt_runs
           where id = ? and project_id = ?
             and status in ('backlog', 'queued', 'blocked', 'failed')
         )
         and not exists (
           select 1 from reachable where run_id = ?
         )
       on conflict (prerequisite_run_id, dependent_run_id) do nothing
       returning prerequisite_run_id`,
    )
    .bind(
      input.dependentRunId,
      projectId,
      projectId,
      input.prerequisiteRunId,
      input.dependentRunId,
      input.createdByUserId,
      input.createdAt,
      input.prerequisiteRunId,
      projectId,
      input.dependentRunId,
      projectId,
      input.prerequisiteRunId,
    )
    .first<{ prerequisite_run_id: string }>();
  if (inserted) return "created";

  const runs = await db
    .prepare(
      `select
         exists(
           select 1 from briar_hunt_runs
           where project_id = ? and id = ?
         ) as prerequisite_exists,
         exists(
           select 1 from briar_hunt_runs
           where project_id = ? and id = ?
         ) as dependent_exists,
         (select status from briar_hunt_runs
          where project_id = ? and id = ?) as dependent_status`,
    )
    .bind(
      projectId,
      input.prerequisiteRunId,
      projectId,
      input.dependentRunId,
      projectId,
      input.dependentRunId,
    )
    .first<{
      prerequisite_exists: number;
      dependent_exists: number;
      dependent_status: AutoHuntRunStatus | null;
    }>();
  if (!runs?.prerequisite_exists || !runs.dependent_exists) return "not_found";

  const existing = await db
    .prepare(
      `select 1 as present from briar_issue_dependencies
       where project_id = ? and prerequisite_run_id = ?
         and dependent_run_id = ?`,
    )
    .bind(projectId, input.prerequisiteRunId, input.dependentRunId)
    .first<{ present: number }>();
  if (existing) return "already_exists";
  if (
    !["backlog", "queued", "blocked", "failed"].includes(
      runs.dependent_status ?? "",
    )
  ) {
    return "ineligible";
  }
  return "cycle";
}

export async function deleteIssueDependency(
  db: D1Database,
  projectId: string,
  prerequisiteRunId: string,
  dependentRunId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_issue_dependencies
       where project_id = ? and prerequisite_run_id = ?
         and dependent_run_id = ?`,
    )
    .bind(projectId, prerequisiteRunId, dependentRunId)
    .run();
  return result.meta.changes > 0;
}

export async function listIssueMessages(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `select message.id, message.run_id, message.parent_message_id,
              message.author_user_id, message.author_agent_provider,
              author.name as author_name,
              author.image as author_image, message.body,
              (select count(*) from briar_issue_messages reply
               where reply.parent_message_id = message.id) as reply_count,
              message.created_at, message.updated_at
       from briar_issue_messages message
       left join "user" author on author.id = message.author_user_id
       where message.project_id = ? and message.run_id = ?
       order by message.created_at, message.id
       limit 1000`,
    )
    .bind(projectId, runId)
    .all<IssueMessageRow>();
  return result.results;
}

export async function createIssueMessage(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    runId: string;
    parentMessageId: string | null;
    authorUserId: string | null;
    authorAgentProvider: "codex" | "claude" | "grok" | null;
    body: string;
    mentionedUserIds?: string[];
    createdAt: string;
  },
) {
  const result = await db
    .prepare(
      `insert into briar_issue_messages (
         id, project_id, run_id, parent_message_id, author_user_id,
         author_agent_provider, body, created_at, updated_at
       )
       select ?, run.project_id, run.id, parent.id, ?, ?, ?, ?, ?
       from briar_hunt_runs run
       left join briar_issue_messages parent
         on parent.id = ?
        and parent.project_id = run.project_id
        and parent.run_id = run.id
        and parent.parent_message_id is null
       where run.id = ? and run.project_id = ?
         and (? is null or parent.id is not null)`,
    )
    .bind(
      input.id,
      input.authorUserId,
      input.authorAgentProvider,
      input.body,
      input.createdAt,
      input.createdAt,
      input.parentMessageId,
      input.runId,
      input.projectId,
      input.parentMessageId,
    )
    .run();
  if (result.meta.changes < 1) return null;
  const mentionedUserIds = [...new Set(input.mentionedUserIds ?? [])];
  if (mentionedUserIds.length > 0) {
    await db.batch(
      mentionedUserIds.map((userId) =>
        db
          .prepare(
            `insert into briar_issue_message_mentions (
               message_id, user_id, created_at
             )
             select message.id, membership.user_id, ?
             from briar_issue_messages message
             join briar_projects project on project.id = message.project_id
             join briar_organization_members membership
               on membership.organization_id = project.organization_id
              and membership.user_id = ?
             where message.id = ?
               and (message.author_user_id is null
                 or message.author_user_id != membership.user_id)
             on conflict (message_id, user_id) do nothing`,
          )
          .bind(input.createdAt, userId, input.id),
      ),
    );
  }
  const messages = await listIssueMessages(db, input.projectId, input.runId);
  return messages.find((message) => message.id === input.id) ?? null;
}

export async function enqueueIssueAgentReply(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    runId: string;
    triggerMessageId: string;
    parentMessageId: string;
    replyMessageId: string;
    createdAt: string;
  },
) {
  await db
    .prepare(
      `insert into briar_issue_agent_reply_jobs (
         id, project_id, run_id, trigger_message_id, parent_message_id,
         reply_message_id, preferred_worker_id, preferred_provider,
         created_at, updated_at
       )
       select ?, run.project_id, run.id, trigger.id, parent.id, ?,
              run.worker_id,
              coalesce(run.requested_agent_provider, agent.provider),
              ?, ?
       from briar_hunt_runs run
       join briar_issue_messages trigger
         on trigger.id = ? and trigger.project_id = run.project_id
        and trigger.run_id = run.id
       join briar_issue_messages parent
         on parent.id = ? and parent.project_id = run.project_id
        and parent.run_id = run.id and parent.parent_message_id is null
       left join briar_project_agents agent
         on agent.id = run.agent_id and agent.project_id = run.project_id
       where run.id = ? and run.project_id = ?
       on conflict (project_id, trigger_message_id) do nothing`,
    )
    .bind(
      input.id,
      input.replyMessageId,
      input.createdAt,
      input.createdAt,
      input.triggerMessageId,
      input.parentMessageId,
      input.runId,
      input.projectId,
    )
    .run();
  return getIssueAgentReplyJob(db, input.projectId, input.triggerMessageId);
}

export async function getIssueAgentReplyJob(
  db: D1Database,
  projectId: string,
  triggerMessageId: string,
) {
  return await db
    .prepare(
      `select * from briar_issue_agent_reply_jobs
       where project_id = ? and trigger_message_id = ?`,
    )
    .bind(projectId, triggerMessageId)
    .first<IssueAgentReplyJobRow>();
}

export async function claimNextIssueAgentReply(
  db: D1Database,
  projectId: string,
  input: {
    workerId: string;
    agentProvider: ProjectAgentProvider;
    agentProviders: ProjectAgentProvider[];
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
    staleBefore: string;
  },
) {
  await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set status = 'failed',
           error = coalesce(error, 'Worker reply lease expired repeatedly.'),
           claim_token_hash = null, lease_expires_at = null, updated_at = ?
       where project_id = ? and status = 'running' and attempts >= 3
         and lease_expires_at <= ?`,
    )
    .bind(input.claimedAt, projectId, input.claimedAt)
    .run();
  return await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set status = 'running', claimed_worker_id = ?,
           agent_provider = case
             when preferred_provider = 'codex' and ? = 1 then 'codex'
             when preferred_provider = 'claude' and ? = 1 then 'claude'
             when preferred_provider = 'grok' and ? = 1 then 'grok'
             else ?
           end,
           claim_token_hash = ?, claimed_at = ?, lease_expires_at = ?,
           attempts = attempts + 1, error = null, updated_at = ?
       where id = (
         select job.id
         from briar_issue_agent_reply_jobs job
         where job.project_id = ?
           and job.attempts < 3
           and (
             job.status = 'queued'
             or (job.status = 'running' and job.lease_expires_at <= ?)
           )
           and (
             not exists (
               select 1 from briar_project_execution_worker_policies policy
               where policy.project_id = job.project_id
                 and policy.selection_mode = 'allowlist'
             )
             or exists (
               select 1
               from briar_project_execution_worker_allowlist allowed
               where allowed.project_id = job.project_id
                 and allowed.worker_id = ?
             )
           )
           and (
             job.preferred_worker_id is null
             or job.preferred_worker_id = ?
             or not exists (
               select 1
               from briar_execution_workers preferred
               join briar_execution_worker_devices device
                 on device.id = preferred.device_id
               where preferred.id = job.preferred_worker_id
                 and preferred.project_id = job.project_id
                 and preferred.state != 'disabled'
                 and device.state != 'disabled'
                 and preferred.accepting_work = 1
                 and preferred.readiness_state != 'needs_attention'
                 and preferred.last_heartbeat_at >= ?
                 and (
                   not exists (
                     select 1
                     from briar_project_execution_worker_policies policy
                     where policy.project_id = job.project_id
                       and policy.selection_mode = 'allowlist'
                   )
                   or exists (
                     select 1
                     from briar_project_execution_worker_allowlist allowed
                     where allowed.project_id = job.project_id
                       and allowed.worker_id = preferred.id
                   )
                 )
             )
           )
         order by job.created_at, job.id
         limit 1
       )
       returning *`,
    )
    .bind(
      input.workerId,
      input.agentProviders.includes("codex") ? 1 : 0,
      input.agentProviders.includes("claude") ? 1 : 0,
      input.agentProviders.includes("grok") ? 1 : 0,
      input.agentProvider,
      input.claimTokenHash,
      input.claimedAt,
      input.leaseExpiresAt,
      input.claimedAt,
      projectId,
      input.claimedAt,
      input.workerId,
      input.workerId,
      input.staleBefore,
    )
    .first<IssueAgentReplyJobRow>();
}

export async function renewIssueAgentReplyLease(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    leaseExpiresAt: string;
    updatedAt: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set lease_expires_at = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
       returning *`,
    )
    .bind(
      input.leaseExpiresAt,
      input.updatedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
    )
    .first<IssueAgentReplyJobRow>();
}

export async function getClaimedIssueAgentReply(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: { workerId: string; claimTokenHash: string },
) {
  return await db
    .prepare(
      `select * from briar_issue_agent_reply_jobs
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?`,
    )
    .bind(jobId, projectId, input.workerId, input.claimTokenHash)
    .first<IssueAgentReplyJobRow>();
}

export async function failIssueAgentReply(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    error: string;
    updatedAt: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set status = case when attempts >= 3 then 'failed' else 'queued' end,
           preferred_worker_id = null,
           claim_token_hash = null, claimed_at = null, lease_expires_at = null,
           error = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
       returning *`,
    )
    .bind(
      input.error,
      input.updatedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
    )
    .first<IssueAgentReplyJobRow>();
}

export async function completeIssueAgentReply(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    completedAt: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set status = 'completed', claim_token_hash = null,
           lease_expires_at = null, completed_at = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
       returning *`,
    )
    .bind(
      input.completedAt,
      input.completedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
    )
    .first<IssueAgentReplyJobRow>();
}

export async function listIssueConversationNotifications(
  db: D1Database,
  projectId: string,
  userId: string,
) {
  const result = await db
    .prepare(
      `select message.id, message.run_id, message.parent_message_id,
              message.author_user_id, message.author_agent_provider,
              author.name as author_name, author.image as author_image,
              message.body, 0 as reply_count, message.created_at,
              message.updated_at, run.title as run_title,
              coalesce(message.parent_message_id, message.id) as root_message_id,
              case when mention.user_id is not null
                then 'mention' else 'thread_reply' end as notification_reason
       from briar_issue_messages message
       join briar_hunt_runs run
         on run.id = message.run_id and run.project_id = message.project_id
       left join "user" author on author.id = message.author_user_id
       left join briar_issue_messages root
         on root.id = message.parent_message_id
        and root.project_id = message.project_id
        and root.run_id = message.run_id
       left join briar_issue_message_mentions mention
         on mention.message_id = message.id and mention.user_id = ?
       where message.project_id = ?
         and (message.author_user_id is null or message.author_user_id != ?)
         and (
           mention.user_id is not null
           or (
             message.parent_message_id is not null
             and root.author_user_id = ?
           )
         )
       order by message.created_at desc, message.id desc
       limit 500`,
    )
    .bind(userId, projectId, userId, userId)
    .all<IssueConversationNotificationRow>();
  return result.results;
}

export async function createIssueAttachments(
  db: D1Database,
  projectId: string,
  runId: string,
  attachments: IssueAttachmentInput[],
) {
  if (attachments.length === 0) return;
  const createdAt = new Date().toISOString();
  const results = await db.batch(
    attachments.map((attachment) =>
      db
        .prepare(
          `insert into briar_issue_attachments (
             id, run_id, project_id, object_key, filename, content_type,
             byte_size, created_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          attachment.id,
          runId,
          projectId,
          attachment.object_key,
          attachment.filename,
          attachment.content_type,
          attachment.byte_size,
          createdAt,
        ),
    ),
  );
  if (results.some((result) => !result.success)) {
    throw new Error("Issue attachment metadata could not be stored");
  }
}

export async function listIssueAttachments(
  db: D1Database,
  projectId: string,
  runId?: string,
) {
  const query = runId
    ? `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments
       where project_id = ? and run_id = ?
       order by created_at, id`
    : `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments attachment
       where attachment.project_id = ?
         and attachment.run_id in (
           select run.id from briar_hunt_runs run
           where run.project_id = ?
           order by
             case when run.status in ('completed', 'cancelled') then 1 else 0 end,
             run.last_event_at desc
           limit 200
         )
       order by created_at, id`;
  const statement = db.prepare(query);
  const result = runId
    ? await statement.bind(projectId, runId).all<IssueAttachmentRow>()
    : await statement.bind(projectId, projectId).all<IssueAttachmentRow>();
  return result.results;
}

export async function getIssueAttachment(
  db: D1Database,
  projectId: string,
  runId: string,
  attachmentId: string,
) {
  return db
    .prepare(
      `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments
       where project_id = ? and run_id = ? and id = ?`,
    )
    .bind(projectId, runId, attachmentId)
    .first<IssueAttachmentRow>();
}

export async function rollbackNewAppIssue(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_hunt_runs
       where id = ? and project_id = ? and source = 'issue'
         and status = 'queued' and claim_attempts = 0
         and (select count(*) from briar_hunt_events where run_id = ?) = 1`,
    )
    .bind(runId, projectId, runId)
    .run();
  return result.meta.changes > 0;
}

export async function getNextQueuedHuntRun(db: D1Database, projectId: string) {
  return await db
    .prepare(
      `select run.*,
              (select count(*) from briar_hunt_events event
               where event.run_id = run.id) as event_count
       from briar_hunt_runs run
       where run.project_id = ? and run.status = 'queued'
         and not exists (
           select 1
           from briar_issue_dependencies dependency
           join briar_hunt_runs prerequisite
             on prerequisite.id = dependency.prerequisite_run_id
           where dependency.project_id = run.project_id
             and dependency.dependent_run_id = run.id
             and prerequisite.status != 'completed'
         )
       order by
         case when run.priority is null then 1 else 0 end,
         run.priority asc,
         coalesce(run.source_created_at, run.started_at) asc,
         run.run_number asc
       limit 1`,
    )
    .bind(projectId)
    .first<HuntRunRow>();
}

export async function claimNextQueuedHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    claimTokenHash: string;
    claimedBy: string;
    claimedAt: string;
    leaseExpiresAt: string;
    runId?: string;
    workerId?: string;
    workerDeviceId?: string;
    agentProvider?: "codex" | "claude" | "grok";
    agentProviders?: Array<"codex" | "claude" | "grok">;
    detachedOnly?: boolean;
  },
) {
  const allowedProviders =
    input.agentProviders ??
    (input.agentProvider ? [input.agentProvider] : undefined);
  return await db
    .prepare(
      `update briar_hunt_runs
       set claim_token_hash = ?, claimed_by = ?, claimed_at = ?,
           lease_expires_at = ?, claim_attempts = claim_attempts + 1,
           worker_id = coalesce(?, worker_id), updated_at = ?
       where id = (
         select id from briar_hunt_runs
         where project_id = ? and status = 'queued'
           and (lease_expires_at is null or lease_expires_at <= ?)
           and (? is null or id = ?)
           and not exists (
             select 1
             from briar_issue_dependencies dependency
             join briar_hunt_runs prerequisite
               on prerequisite.id = dependency.prerequisite_run_id
             where dependency.project_id = briar_hunt_runs.project_id
               and dependency.dependent_run_id = briar_hunt_runs.id
               and prerequisite.status != 'completed'
           )
           and (? = 0 or dispatched_at is not null)
           and (? is null or requested_worker_id is null or requested_worker_id = ?)
           and (
             ? is null
             or not exists (
               select 1 from briar_project_execution_worker_policies policy
               where policy.project_id = briar_hunt_runs.project_id
                 and policy.selection_mode = 'allowlist'
             )
             or exists (
               select 1
               from briar_project_execution_worker_allowlist allowed
               where allowed.project_id = briar_hunt_runs.project_id
                 and allowed.worker_id = ?
             )
           )
           and (
             ? = 0
             or (
               ? = 1
               and coalesce(
                 preferred_agent_provider,
                 requested_agent_provider,
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'codex'
             )
             or (
               ? = 1
               and coalesce(
                 preferred_agent_provider,
                 requested_agent_provider,
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'claude'
             )
             or (
               ? = 1
               and coalesce(
                 preferred_agent_provider,
                 requested_agent_provider,
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'grok'
             )
           )
           and (
             ? is null or (
               select count(*)
               from briar_hunt_runs active
               join briar_execution_workers holder
                 on holder.id = active.worker_id
               where holder.device_id = ?
                 and active.claim_token_hash is not null
                 and active.lease_expires_at is not null
                 and active.lease_expires_at > ?
                 and active.status not in (
                   'backlog', 'completed', 'cancelled', 'blocked', 'failed'
                 )
             ) < coalesce((
               select device.max_concurrent_sessions
               from briar_execution_worker_devices device
               where device.id = ?
             ), 0)
           )
         order by
           case when priority is null then 1 else 0 end,
           priority asc,
           coalesce(source_created_at, started_at) asc,
           run_number asc
         limit 1
       )
       returning *`,
    )
    .bind(
      input.claimTokenHash,
      input.claimedBy,
      input.claimedAt,
      input.leaseExpiresAt,
      input.workerId ?? null,
      input.claimedAt,
      projectId,
      input.claimedAt,
      input.runId ?? null,
      input.runId ?? null,
      input.detachedOnly ? 1 : 0,
      input.workerId ?? null,
      input.workerId ?? null,
      input.workerId ?? null,
      input.workerId ?? null,
      allowedProviders ? 1 : 0,
      allowedProviders?.includes("codex") ? 1 : 0,
      allowedProviders?.includes("claude") ? 1 : 0,
      allowedProviders?.includes("grok") ? 1 : 0,
      input.workerDeviceId ?? null,
      input.workerDeviceId ?? null,
      input.claimedAt,
      input.workerDeviceId ?? null,
    )
    .first<HuntRunRow>();
}

export async function assertQueuedHuntClaim(
  db: D1Database,
  projectId: string,
  input: Pick<HuntEventInput, "source" | "sourceKey">,
  claimTokenHash: string | null,
  observedAt: string,
) {
  const run = await db
    .prepare(
      `select stage, status, claim_token_hash, lease_expires_at, context_json,
              case when claim_token_hash = ? then 1 else 0 end as claim_token_valid
       from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?
       limit 1`,
    )
    .bind(claimTokenHash ?? "", projectId, input.source, input.sourceKey)
    .first<{
      stage: DashboardStage;
      status: AutoHuntRunStatus;
      claim_token_hash: string | null;
      lease_expires_at: string | null;
      context_json: string | null;
      claim_token_valid: number;
    }>();
  if (!run) return;
  if (run.status !== "queued") {
    if (claimTokenHash && run.claim_token_valid !== 1) {
      throw new HuntClaimError("Auto Hunt claim token is no longer active");
    }
    return;
  }
  const context: unknown = run.context_json
    ? JSON.parse(run.context_json)
    : null;
  const appCreated =
    context !== null &&
    typeof context === "object" &&
    !Array.isArray(context) &&
    (context as Record<string, unknown>).origin === "briar-app";
  if (!run.claim_token_hash) {
    if (claimTokenHash) {
      throw new HuntClaimError("Auto Hunt claim token is no longer active");
    }
    if (!appCreated) return;
  }
  if (
    run.claim_token_valid !== 1 ||
    !run.lease_expires_at ||
    run.lease_expires_at <= observedAt
  ) {
    throw new HuntClaimError(
      "Queued Auto Hunt run requires its active claim token",
    );
  }
}

export async function findProjectIdByAgentTokenHash(
  db: D1Database,
  agentTokenHash: string,
) {
  return await db
    .prepare(
      `select token.project_id
       from briar_project_agent_tokens token
       join briar_projects project on project.id = token.project_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = token.issued_to_user_id
       where token.token_hash = ?
       union all
       select id as project_id
       from briar_projects
       where agent_token_hash = ?
       limit 1`,
    )
    .bind(agentTokenHash, agentTokenHash)
    .first<string>("project_id");
}

export async function issueProjectAgentToken(
  db: D1Database,
  projectId: string,
  userId: string,
  agentTokenHash: string,
) {
  const result = await db
    .prepare(
      `insert into briar_project_agent_tokens (
         token_hash, project_id, issued_to_user_id, created_at
       )
       select ?, project.id, ?, ?
       from briar_projects project
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       where project.id = ?`,
    )
    .bind(
      agentTokenHash,
      userId,
      new Date().toISOString(),
      userId,
      projectId,
    )
    .run();
  return result.meta.changes > 0;
}

const digestRunId = async (
  projectId: string,
  source: AutoHuntSource,
  sourceKey: string,
) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${projectId}\u0000${source}\u0000${sourceKey}`),
    ),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const scopedRunKey = async (
  key: string,
  attempt: number,
  revision: number,
) => {
  if (attempt === 1 && revision === 1) return key;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  const fingerprint = [...digest.slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const suffix = `:attempt-${attempt}:revision-${revision}:${fingerprint}`;
  return `${key.slice(0, 300 - suffix.length)}${suffix}`;
};

const scopedEvidenceKey = async (key: string, revision: number) => {
  if (revision === 1) return key;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  );
  const fingerprint = [...digest.slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const suffix = `:revision-${revision}:${fingerprint}`;
  return `${key.slice(0, 300 - suffix.length)}${suffix}`;
};

const loadStageRevisionRequirements = async (
  db: D1Database,
  run: HuntRunRow,
) => {
  const result = await db
    .prepare(
      `select workflow_stage, required_revision
       from briar_run_stage_revisions
       where run_id = ? and attempt = ?`,
    )
    .bind(run.id, run.current_attempt)
    .all<{ workflow_stage: string; required_revision: number }>();
  return new Map(
    result.results.map((item) => [
      item.workflow_stage,
      item.required_revision,
    ]),
  );
};

const sameEvent = (row: HuntEventRow, input: HuntEventInput) =>
  row.stage === input.stage &&
  row.status === input.status &&
  row.workflow_stage === input.workflowStage &&
  row.detail === input.detail &&
  row.actor === input.actor &&
  row.branch === input.branch &&
  row.commit_sha === input.commitSha &&
  row.qa_status === input.qaStatus &&
  row.tracker_issue_state === (input.tracker?.state ?? null) &&
  row.pull_request_urls === stableJson(input.pullRequestUrls) &&
  row.target_sha === input.targetSha &&
  row.occurred_at === input.occurredAt;

const loadRunForIdentity = async (
  db: D1Database,
  projectId: string,
  input: HuntEventInput,
) => {
  if (input.tracker?.issueId) {
    const byTracker = await db
      .prepare(
        `select * from briar_hunt_runs
         where project_id = ? and tracker_provider = ? and tracker_issue_id = ?
         limit 1`,
      )
      .bind(projectId, input.tracker.provider, input.tracker.issueId)
      .first<HuntRunRow>();
    if (byTracker) return byTracker;
  }
  return await db
    .prepare(
      `select * from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?
       limit 1`,
    )
    .bind(projectId, input.source, input.sourceKey)
    .first<HuntRunRow>();
};

const assertCompletionEligible = async (
  db: D1Database,
  projectId: string,
  run: HuntRunRow | null,
  input: HuntEventInput,
) => {
  if (input.status !== "completed") return;
  if (!run) throw new HuntTransitionError("Run does not exist");
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const requiredStages = requiredExecutableWorkflowStages(workflow);
  const revisionRequirements = await loadStageRevisionRequirements(db, run);
  const completedStages = await db
    .prepare(
      `select workflow_stage, revision from briar_hunt_events
       where run_id = ? and attempt = ? and workflow_stage is not null`,
    )
    .bind(run.id, run.current_attempt)
    .all<{ workflow_stage: AutoHuntWorkflowStageId; revision: number }>();
  const completedStageIds = new Set(
    completedStages.results
      .filter(
        (event) =>
          event.revision >=
          (revisionRequirements.get(event.workflow_stage) ?? 1),
      )
      .map((event) => event.workflow_stage),
  );
  const missingStages = requiredStages.filter(
    (stage) => !completedStageIds.has(stage),
  );
  if (missingStages.length > 0) {
    throw new HuntTransitionError(
      `Run completion requires workflow stages: ${missingStages.join(", ")}`,
    );
  }
  const requiredEvidence = workflow.stages.flatMap((stage) =>
    requiredStages.includes(stage.id)
      ? (stage.evidence ?? []).map((type) => ({ stage: stage.id, type }))
      : [],
  );
  if (requiredEvidence.length > 0) {
    const evidence = await db
      .prepare(
        `select workflow_stage, evidence_type, revision from briar_run_evidence
         where run_id = ? and attempt = ? and status in ('passed', 'skipped')`,
      )
      .bind(run.id, run.current_attempt)
      .all<{
        workflow_stage: string;
        evidence_type: string;
        revision: number;
      }>();
    const accepted = new Set(
      evidence.results
        .filter(
          (item) =>
            item.revision >=
            (revisionRequirements.get(item.workflow_stage) ?? 1),
        )
        .map((item) => `${item.workflow_stage}:${item.evidence_type}`),
    );
    const missingEvidence = requiredEvidence
      .filter((item) => !accepted.has(`${item.stage}:${item.type}`))
      .map((item) => `${item.stage}:${item.type}`);
    if (missingEvidence.length > 0) {
      throw new HuntTransitionError(
        `Run completion requires evidence: ${missingEvidence.join(", ")}`,
      );
    }
  }
  const resultSummary = input.resultSummary ?? run.result_summary;
  if (!resultSummary?.trim()) {
    throw new HuntTransitionError("Run completion requires a result summary");
  }
  const settings = await getProjectSettings(db, projectId);
  const trackerProvider = input.tracker?.provider ?? run.tracker_provider;
  const trackerState = input.tracker?.state ?? run.tracker_issue_state;
  if (
    settings?.linear_enabled === 1 &&
    trackerProvider === "linear" &&
    !isTerminalTrackerState(trackerState)
  ) {
    throw new HuntTransitionError(
      "Run completion requires a terminal Linear issue",
    );
  }
};

const assertStageTransition = async (
  _db: D1Database,
  run: HuntRunRow | null,
  input: HuntEventInput,
) => {
  if (!run || input.occurredAt < run.last_event_at) {
    return;
  }
  if (
    input.status === run.status &&
    (input.status !== "running" || input.workflowStage === run.workflow_stage)
  ) {
    return;
  }
  if (run.status === "completed" || run.status === "cancelled") {
    throw new HuntTransitionError(`Run is already ${run.status}`);
  }
  if (["blocked", "failed", "cancelled"].includes(input.status ?? "")) return;
  if (input.status !== "running" || !input.workflowStage) return;
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const nextRank = workflow.stages.findIndex(
    (stage) => stage.id === input.workflowStage,
  );
  if (nextRank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.workflowStage}`,
    );
  }
  if (nextRank > workflowStopIndex(workflow)) {
    throw new HuntTransitionError(
      `Workflow stops after stage: ${workflow.execution.stopAfterStage}`,
    );
  }
  const floorRank = run.workflow_stage
    ? workflow.stages.findIndex((stage) => stage.id === run.workflow_stage)
    : -1;
  if (nextRank < floorRank) {
    throw new HuntTransitionError(
      `Workflow cannot regress from rank ${floorRank} to ${nextRank}`,
    );
  }
};

const statusForDashboardStage = (stage: DashboardStage): AutoHuntRunStatus => {
  if (stage === "queued") return "queued";
  if (["blocked", "failed", "completed", "cancelled"].includes(stage)) {
    return stage as AutoHuntRunStatus;
  }
  return "running";
};

const workflowStageForDashboardStage = (
  stage: DashboardStage,
): AutoHuntWorkflowStageId | null => {
  if (
    [
      "analyzing",
      "implementing",
      "pr_open",
      "staging_qa",
      "production_qa",
    ].includes(stage)
  ) {
    return stage as AutoHuntWorkflowStageId;
  }
  return null;
};

const dashboardStageFor = (
  status: AutoHuntRunStatus,
  workflowStage: AutoHuntWorkflowStageId | null,
): DashboardStage => {
  if (status === "backlog") return "queued";
  if (status !== "running") return status;
  return workflowStage &&
    [
      "analyzing",
      "implementing",
      "pr_open",
      "staging_qa",
      "production_qa",
    ].includes(workflowStage)
    ? (workflowStage as DashboardStage)
    : "implementing";
};

export async function recordHuntEvent(
  db: D1Database,
  projectId: string,
  input: HuntEventInput,
) {
  const normalizedInput = {
    ...input,
    status: input.status ?? statusForDashboardStage(input.stage),
    workflowStage:
      input.workflowStage === undefined
        ? workflowStageForDashboardStage(input.stage)
        : input.workflowStage,
    pullRequestUrls: normalizedUrls(input.pullRequestUrls),
  };
  normalizedInput.stage = dashboardStageFor(
    normalizedInput.status,
    normalizedInput.workflowStage,
  );
  const existingRun = await loadRunForIdentity(db, projectId, normalizedInput);
  const workflowSnapshot = existingRun
    ? parseWorkflow(existingRun.workflow_snapshot_json)
    : parseWorkflow((await getProjectSettings(db, projectId))?.workflow_json);
  if (!existingRun && isRepositoryWorkflowPending(workflowSnapshot)) {
    throw new HuntTransitionError(
      "Repository workflow has not been generated for this project",
    );
  }
  if (
    normalizedInput.status === "running" &&
    (!normalizedInput.workflowStage ||
      !workflowSnapshot.stages.some(
        (stage) => stage.id === normalizedInput.workflowStage,
      ))
  ) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${normalizedInput.workflowStage ?? "none"}`,
    );
  }
  if (normalizedInput.status === "running" && normalizedInput.workflowStage) {
    const requestedRank = workflowSnapshot.stages.findIndex(
      (stage) => stage.id === normalizedInput.workflowStage,
    );
    if (requestedRank > workflowStopIndex(workflowSnapshot)) {
      throw new HuntTransitionError(
        `Workflow stops after stage: ${workflowSnapshot.execution.stopAfterStage}`,
      );
    }
  }
  const eventAttempt = existingRun?.current_attempt ?? 1;
  const eventRevision = existingRun?.current_revision ?? 1;
  const storedEventKey = await scopedRunKey(
    normalizedInput.eventKey,
    eventAttempt,
    eventRevision,
  );
  await assertStageTransition(db, existingRun, normalizedInput);
  await assertCompletionEligible(db, projectId, existingRun, normalizedInput);

  if (existingRun) {
    const existingEvent = await db
      .prepare(
        `select id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
                detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
                pull_request_urls, target_sha, occurred_at, recorded_at
         from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(existingRun.id, storedEventKey)
      .first<HuntEventRow>();
    if (existingEvent) {
      if (!sameEvent(existingEvent, normalizedInput)) {
        throw new EventKeyConflictError();
      }
      return existingRun.id;
    }
  }

  const runId =
    existingRun?.id ??
    (await digestRunId(
      projectId,
      normalizedInput.source,
      normalizedInput.sourceKey,
    ));
  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const completedAt = ["completed", "cancelled"].includes(
    normalizedInput.status,
  )
    ? normalizedInput.occurredAt
    : null;
  const mergedPullRequestUrls = normalizedUrls([
    ...parseUrls(existingRun?.pull_request_urls),
    ...normalizedInput.pullRequestUrls,
  ]);
  const qaStatus = normalizedInput.qaStatus;
  const stagingQaStatus =
    normalizedInput.stage === "staging_qa" && qaStatus === "pending"
      ? "pending"
      : null;
  const productionQaStatus =
    normalizedInput.stage === "production_qa" && qaStatus === "pending"
      ? "pending"
      : null;
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           workflow_stage, workflow_snapshot_json, detail, priority,
           repository, branch, commit_sha, tracker_provider,
           tracker_issue_id, tracker_issue_identifier, tracker_issue_url,
           tracker_issue_state, issue_description, result_summary,
           structured_result_json,
           pull_request_urls, target_sha, source_created_at,
           staging_qa_status, production_qa_status, staging_qa_detail,
           production_qa_detail, context_json, started_at, completed_at,
           last_event_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(project_id, source, source_key) do nothing`,
      )
      .bind(
        runId,
        projectId,
        normalizedInput.source,
        normalizedInput.sourceKey,
        normalizedInput.title,
        normalizedInput.stage,
        normalizedInput.status,
        normalizedInput.workflowStage,
        stableJson(workflowSnapshot),
        normalizedInput.detail,
        normalizedInput.priority,
        normalizedInput.repository,
        normalizedInput.branch,
        normalizedInput.commitSha,
        normalizedInput.tracker?.provider ?? null,
        normalizedInput.tracker?.issueId ?? null,
        normalizedInput.tracker?.identifier ?? null,
        normalizedInput.tracker?.url ?? null,
        normalizedInput.tracker?.state ?? null,
        normalizedInput.issueDescription,
        normalizedInput.resultSummary,
        normalizedInput.structuredResult
          ? stableJson(normalizedInput.structuredResult)
          : null,
        stableJson(mergedPullRequestUrls),
        normalizedInput.targetSha,
        normalizedInput.sourceCreatedAt,
        stagingQaStatus,
        productionQaStatus,
        normalizedInput.stagingQaDetail,
        normalizedInput.productionQaDetail,
        normalizedInput.context ? stableJson(normalizedInput.context) : null,
        normalizedInput.occurredAt,
        completedAt,
        normalizedInput.occurredAt,
        recordedAt,
        recordedAt,
      ),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
           detail, actor, branch, commit_sha,
           qa_status, tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        runId,
        storedEventKey,
        eventAttempt,
        eventRevision,
        normalizedInput.stage,
        normalizedInput.status,
        normalizedInput.workflowStage,
        normalizedInput.detail,
        normalizedInput.actor,
        normalizedInput.branch,
        normalizedInput.commitSha,
        qaStatus,
        normalizedInput.tracker?.state ?? null,
        stableJson(normalizedInput.pullRequestUrls),
        normalizedInput.targetSha,
        normalizedInput.occurredAt,
        recordedAt,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set title = case when ? >= last_event_at then ? else title end,
             stage = case
               when ? < last_event_at then stage
               when status = 'completed' and ? <> 'completed' then stage
               else ?
             end,
             status = case
               when ? < last_event_at then status
               when status = 'completed' and ? <> 'completed' then status
               else ?
             end,
             workflow_stage = case
               when ? >= last_event_at then coalesce(?, workflow_stage)
               else workflow_stage
             end,
             detail = case when ? >= last_event_at then ? else detail end,
             priority = case when ? >= last_event_at then coalesce(?, priority) else priority end,
             repository = case when ? >= last_event_at then ? else repository end,
             branch = case when ? >= last_event_at then coalesce(?, branch) else branch end,
             commit_sha = case when ? >= last_event_at then coalesce(?, commit_sha) else commit_sha end,
             tracker_provider = coalesce(?, tracker_provider),
             tracker_issue_id = coalesce(?, tracker_issue_id),
             tracker_issue_identifier = coalesce(?, tracker_issue_identifier),
             tracker_issue_url = coalesce(?, tracker_issue_url),
             tracker_issue_state = case when ? >= last_event_at then coalesce(?, tracker_issue_state) else tracker_issue_state end,
             issue_description = case when ? >= last_event_at then coalesce(?, issue_description) else issue_description end,
             result_summary = case when ? >= last_event_at then coalesce(?, result_summary) else result_summary end,
             structured_result_json = case when ? >= last_event_at then coalesce(?, structured_result_json) else structured_result_json end,
             pull_request_urls = ?,
             target_sha = case when ? >= last_event_at then coalesce(?, target_sha) else target_sha end,
             source_created_at = coalesce(source_created_at, ?),
             staging_qa_status = case
               when ? >= last_event_at and ? = 'staging_qa' and ? = 'pending' then 'pending'
               else staging_qa_status
             end,
             production_qa_status = case
               when ? >= last_event_at and ? = 'production_qa' and ? = 'pending' then 'pending'
               else production_qa_status
             end,
             staging_qa_detail = case when ? >= last_event_at then coalesce(?, staging_qa_detail) else staging_qa_detail end,
             production_qa_detail = case when ? >= last_event_at then coalesce(?, production_qa_detail) else production_qa_detail end,
             context_json = case when ? >= last_event_at then coalesce(?, context_json) else context_json end,
             completed_at = case
               when ? < last_event_at then completed_at
               when ? in ('completed', 'cancelled') then ?
               when status = 'completed' and ? <> 'completed' then completed_at
               else null
             end,
             last_event_at = max(last_event_at, ?),
             updated_at = ?
         where id = ?
           and current_attempt = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        normalizedInput.occurredAt,
        normalizedInput.title,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.stage,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.status,
        normalizedInput.occurredAt,
        normalizedInput.workflowStage,
        normalizedInput.occurredAt,
        normalizedInput.detail,
        normalizedInput.occurredAt,
        normalizedInput.priority,
        normalizedInput.occurredAt,
        normalizedInput.repository,
        normalizedInput.occurredAt,
        normalizedInput.branch,
        normalizedInput.occurredAt,
        normalizedInput.commitSha,
        normalizedInput.tracker?.provider ?? null,
        normalizedInput.tracker?.issueId ?? null,
        normalizedInput.tracker?.identifier ?? null,
        normalizedInput.tracker?.url ?? null,
        normalizedInput.occurredAt,
        normalizedInput.tracker?.state ?? null,
        normalizedInput.occurredAt,
        normalizedInput.issueDescription,
        normalizedInput.occurredAt,
        normalizedInput.resultSummary,
        normalizedInput.occurredAt,
        normalizedInput.structuredResult
          ? stableJson(normalizedInput.structuredResult)
          : null,
        stableJson(mergedPullRequestUrls),
        normalizedInput.occurredAt,
        normalizedInput.targetSha,
        normalizedInput.sourceCreatedAt,
        normalizedInput.occurredAt,
        normalizedInput.stage,
        qaStatus,
        normalizedInput.occurredAt,
        normalizedInput.stage,
        qaStatus,
        normalizedInput.occurredAt,
        normalizedInput.stagingQaDetail,
        normalizedInput.occurredAt,
        normalizedInput.productionQaDetail,
        normalizedInput.occurredAt,
        normalizedInput.context ? stableJson(normalizedInput.context) : null,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.occurredAt,
        normalizedInput.status,
        normalizedInput.occurredAt,
        recordedAt,
        runId,
        eventAttempt,
        eventId,
      ),
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) {
    const existingEvent = await db
      .prepare(
        `select id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
                detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
                pull_request_urls, target_sha, occurred_at, recorded_at
         from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(runId, storedEventKey)
      .first<HuntEventRow>();
    if (!existingEvent || !sameEvent(existingEvent, normalizedInput)) {
      throw new EventKeyConflictError();
    }
  }

  return runId;
}

export async function recordRunEvidence(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    evidenceKey: string;
    stage: string;
    type: string;
    status: RunEvidenceRow["status"];
    detail: string | null;
    command: string | null;
    url: string | null;
    metadata: Record<string, unknown> | null;
    actor: string;
    observedAt: string;
  },
) {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) return null;
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const evidenceStageRank = workflow.stages.findIndex(
    (stage) => stage.id === input.stage,
  );
  if (evidenceStageRank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.stage}`,
    );
  }
  if (evidenceStageRank > workflowStopIndex(workflow)) {
    throw new HuntTransitionError(
      `Workflow stops after stage: ${workflow.execution.stopAfterStage}`,
    );
  }
  const metadataJson = input.metadata ? stableJson(input.metadata) : null;
  const storedEvidenceKey = await scopedEvidenceKey(
    input.evidenceKey,
    run.current_revision,
  );
  const existing = await db
    .prepare(
      `select * from briar_run_evidence
       where run_id = ? and attempt = ? and evidence_key = ?`,
    )
    .bind(run.id, run.current_attempt, storedEvidenceKey)
    .first<RunEvidenceRow>();
  const linkPullRequest = async (url: string | null, recordedAt: string) => {
    if (input.type !== "pull_request" || !url) return;
    await db
      .prepare(
        `update briar_hunt_runs
         set pull_request_urls = json_insert(pull_request_urls, '$[#]', ?),
             updated_at = max(updated_at, ?)
         where id = ? and project_id = ?
           and not exists (
             select 1 from json_each(pull_request_urls)
             where value = ?
           )`,
      )
      .bind(url, recordedAt, run.id, projectId, url)
      .run();
  };
  if (existing) {
    const same =
      existing.workflow_stage === input.stage &&
      existing.evidence_type === input.type &&
      existing.status === input.status &&
      existing.detail === input.detail &&
      existing.command === input.command &&
      existing.url === input.url &&
      existing.metadata_json === metadataJson &&
      existing.actor === input.actor &&
      existing.observed_at === input.observedAt;
    if (!same) throw new EventKeyConflictError();
    await linkPullRequest(existing.url, existing.recorded_at);
    return existing;
  }
  const evidence: RunEvidenceRow = {
    id: crypto.randomUUID(),
    run_id: run.id,
    attempt: run.current_attempt,
    revision: run.current_revision,
    evidence_key: storedEvidenceKey,
    workflow_stage: input.stage,
    evidence_type: input.type,
    status: input.status,
    detail: input.detail,
    command: input.command,
    url: input.url,
    metadata_json: metadataJson,
    actor: input.actor,
    observed_at: input.observedAt,
    recorded_at: new Date().toISOString(),
  };
  await db
    .prepare(
      `insert into briar_run_evidence (
         id, project_id, run_id, attempt, revision, evidence_key, workflow_stage,
         evidence_type, status, detail, command, url, metadata_json,
         actor, observed_at, recorded_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      evidence.id,
      projectId,
      evidence.run_id,
      evidence.attempt,
      evidence.revision,
      evidence.evidence_key,
      evidence.workflow_stage,
      evidence.evidence_type,
      evidence.status,
      evidence.detail,
      evidence.command,
      evidence.url,
      evidence.metadata_json,
      evidence.actor,
      evidence.observed_at,
      evidence.recorded_at,
    )
    .run();
  await linkPullRequest(evidence.url, evidence.recorded_at);
  return evidence;
}

export async function listRunEvidence(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const result = await db
    .prepare(
      `select * from briar_run_evidence
       where project_id = ? and run_id = ? and attempt = ?
       order by observed_at, recorded_at, id`,
    )
    .bind(projectId, runId, run.current_attempt)
    .all<RunEvidenceRow>();
  return result.results ?? [];
}

export async function listRunEvidenceImages(
  db: D1Database,
  projectId: string,
  runId?: string,
) {
  if (!runId) {
    const result = await db
      .prepare(
        `select * from briar_run_evidence_images
         where project_id = ?
         order by run_id, evidence_id, position, id`,
      )
      .bind(projectId)
      .all<RunEvidenceImageRow>();
    return result.results ?? [];
  }
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const result = await db
    .prepare(
      `select image.*
       from briar_run_evidence_images image
       join briar_run_evidence evidence on evidence.id = image.evidence_id
       where image.project_id = ? and image.run_id = ?
         and evidence.attempt = ?
       order by evidence.observed_at, evidence.recorded_at, evidence.id,
                image.position, image.id`,
    )
    .bind(projectId, runId, run.current_attempt)
    .all<RunEvidenceImageRow>();
  return result.results ?? [];
}

export async function listAllRunEvidenceImages(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const result = await db
    .prepare(
      `select * from briar_run_evidence_images
       where project_id = ? and run_id = ?
       order by evidence_id, position, id`,
    )
    .bind(projectId, runId)
    .all<RunEvidenceImageRow>();
  return result.results ?? [];
}

export async function listEvidenceImagesForEvidence(
  db: D1Database,
  projectId: string,
  runId: string,
  evidenceId: string,
) {
  const result = await db
    .prepare(
      `select * from briar_run_evidence_images
       where project_id = ? and run_id = ? and evidence_id = ?
       order by position, id`,
    )
    .bind(projectId, runId, evidenceId)
    .all<RunEvidenceImageRow>();
  return result.results ?? [];
}

export async function createRunEvidenceImages(
  db: D1Database,
  projectId: string,
  runId: string,
  evidenceId: string,
  images: RunEvidenceImageInput[],
) {
  const evidence = await db
    .prepare(
      `select id from briar_run_evidence
       where id = ? and project_id = ? and run_id = ?`,
    )
    .bind(evidenceId, projectId, runId)
    .first<{ id: string }>();
  if (!evidence) return null;
  if (images.length === 0) return [];
  const createdAt = new Date().toISOString();
  await db.batch(
    images.map((image) =>
      db
        .prepare(
          `insert into briar_run_evidence_images (
             id, project_id, run_id, evidence_id, object_key, filename,
             content_type, byte_size, sha256, position, created_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          image.id,
          projectId,
          runId,
          evidenceId,
          image.object_key,
          image.filename,
          image.content_type,
          image.byte_size,
          image.sha256,
          image.position,
          createdAt,
        ),
    ),
  );
  return listEvidenceImagesForEvidence(db, projectId, runId, evidenceId);
}

export async function getRunEvidenceImage(
  db: D1Database,
  projectId: string,
  runId: string,
  imageId: string,
) {
  return db
    .prepare(
      `select * from briar_run_evidence_images
       where id = ? and project_id = ? and run_id = ?`,
    )
    .bind(imageId, projectId, runId)
    .first<RunEvidenceImageRow>();
}

export async function listRunStageRevisions(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const requirements = await loadStageRevisionRequirements(db, run);
  return {
    attempt: run.current_attempt,
    revision: run.current_revision,
    requirements,
  };
}

export type HuntReworkOutcome =
  | "reworked"
  | "already_reworked"
  | "not_found";

export async function reworkHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    workflowStage: AutoHuntWorkflowStageId;
    requestId: string;
    actor: string;
    reason: string;
    occurredAt: string;
  },
): Promise<{
  outcome: HuntReworkOutcome;
  attempt: number | null;
  revision: number | null;
  workflowStage: AutoHuntWorkflowStageId | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) {
    return {
      outcome: "not_found",
      attempt: null,
      revision: null,
      workflowStage: null,
    };
  }

  const eventKey = `workflow:rework:${input.requestId}`;
  const existingEvent = await db
    .prepare(
      `select attempt, revision, workflow_stage from briar_hunt_events
       where run_id = ? and event_key = ?`,
    )
    .bind(run.id, eventKey)
    .first<
      Pick<HuntEventRow, "attempt" | "revision" | "workflow_stage">
    >();
  if (existingEvent) {
    return {
      outcome: "already_reworked",
      attempt: existingEvent.attempt,
      revision: existingEvent.revision,
      workflowStage: existingEvent.workflow_stage,
    };
  }

  if (run.status !== "running" || !run.workflow_stage) {
    throw new HuntTransitionError("Only a running workflow stage can be reworked");
  }
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const currentRank = workflow.stages.findIndex(
    (stage) => stage.id === run.workflow_stage,
  );
  const targetRank = workflow.stages.findIndex(
    (stage) => stage.id === input.workflowStage,
  );
  if (targetRank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.workflowStage}`,
    );
  }
  if (targetRank > workflowStopIndex(workflow)) {
    throw new HuntTransitionError(
      `Workflow stops after stage: ${workflow.execution.stopAfterStage}`,
    );
  }
  if (currentRank < 0 || targetRank >= currentRank) {
    throw new HuntTransitionError(
      `Rework target ${input.workflowStage} must precede ${run.workflow_stage}`,
    );
  }

  const nextRevision = run.current_revision + 1;
  const targetDashboardStage = dashboardStageFor(
    "running",
    input.workflowStage,
  );
  const recordedAt = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const invalidatedStages = workflow.stages.slice(targetRank).map((stage) => stage.id);
  const results = await db.batch([
    db
      .prepare(
        `update briar_hunt_runs
         set stage = ?, status = 'running', workflow_stage = ?,
             detail = ?, current_revision = ?, commit_sha = null,
             target_sha = null, result_summary = null,
             structured_result_json = null,
             staging_qa_status = null, production_qa_status = null,
             staging_qa_detail = null, production_qa_detail = null,
             completed_at = null, last_event_at = ?, updated_at = ?
         where id = ? and project_id = ? and status = 'running'
           and current_attempt = ? and current_revision = ?
           and last_event_at = ?`,
      )
      .bind(
        targetDashboardStage,
        input.workflowStage,
        input.reason,
        nextRevision,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        run.current_revision,
        run.last_event_at,
      ),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status,
           workflow_stage, detail, actor, branch, commit_sha, qa_status,
           tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         )
         select ?, id, ?, current_attempt, current_revision, ?, 'running',
                ?, ?, ?, branch, null, null, tracker_issue_state,
                pull_request_urls, null, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and current_revision = ? and last_event_at = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        targetDashboardStage,
        input.workflowStage,
        input.reason,
        input.actor,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        nextRevision,
        input.occurredAt,
      ),
    ...invalidatedStages.map((stage) =>
      db
        .prepare(
          `insert into briar_run_stage_revisions (
             run_id, attempt, workflow_stage, required_revision
           )
           select id, current_attempt, ?, current_revision
           from briar_hunt_runs
           where id = ? and project_id = ? and current_attempt = ?
             and current_revision = ? and last_event_at = ?
           on conflict(run_id, attempt, workflow_stage)
           do update set required_revision = excluded.required_revision`,
        )
        .bind(
          stage,
          run.id,
          projectId,
          run.current_attempt,
          nextRevision,
          input.occurredAt,
        ),
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    const duplicate = await db
      .prepare(
        `select attempt, revision, workflow_stage from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<
        Pick<HuntEventRow, "attempt" | "revision" | "workflow_stage">
      >();
    if (duplicate) {
      return {
        outcome: "already_reworked",
        attempt: duplicate.attempt,
        revision: duplicate.revision,
        workflowStage: duplicate.workflow_stage,
      };
    }
    throw new HuntTransitionError(
      "Auto Hunt run changed while rework was being recorded",
    );
  }

  return {
    outcome: "reworked",
    attempt: run.current_attempt,
    revision: nextRevision,
    workflowStage: input.workflowStage,
  };
}

export type HuntRecoveryAction = "retry" | "cancel";
export type HuntRecoveryOutcome =
  | "retried"
  | "cancelled"
  | "already_retried"
  | "already_cancelled"
  | "ineligible"
  | "not_found";

export async function recoverHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    action: HuntRecoveryAction;
    requestId: string;
    actor: string;
    reason: string | null;
    occurredAt: string;
  },
): Promise<{
  outcome: HuntRecoveryOutcome;
  attempt: number | null;
  stage: DashboardStage | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) return { outcome: "not_found", attempt: null, stage: null };

  const eventKey = `admin:${input.action}:${input.requestId}`;
  const existingEvent = await db
    .prepare(
      `select attempt, stage from briar_hunt_events
       where run_id = ? and event_key = ?`,
    )
    .bind(run.id, eventKey)
    .first<Pick<HuntEventRow, "attempt" | "stage">>();
  if (existingEvent) {
    return {
      outcome:
        input.action === "retry" ? "already_retried" : "already_cancelled",
      attempt: existingEvent.attempt,
      stage: existingEvent.stage,
    };
  }

  const eligible =
    input.action === "retry"
      ? (["blocked", "failed"] as AutoHuntRunStatus[]).includes(run.status)
      : !(["completed", "cancelled"] as AutoHuntRunStatus[]).includes(run.status);
  if (!eligible) {
    return {
      outcome: "ineligible",
      attempt: run.current_attempt,
      stage: run.stage,
    };
  }

  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const nextAttempt =
    input.action === "retry" ? run.current_attempt + 1 : run.current_attempt;
  const nextStage: DashboardStage =
    input.action === "retry" ? "queued" : "cancelled";
  const detail =
    input.reason ??
    (input.action === "retry"
      ? `Auto Hunt ${nextAttempt}차 시도를 요청했습니다.`
      : "사용자가 Auto Hunt 작업을 취소했습니다.");

  const update =
    input.action === "retry"
      ? db
          .prepare(
            `update briar_hunt_runs
             set stage = 'queued', status = 'queued', workflow_stage = null,
                 detail = ?, current_attempt = ?, current_revision = 1,
                 branch = null, commit_sha = null, result_summary = null,
                 structured_result_json = null,
                 pull_request_urls = '[]',
                 target_sha = null, staging_qa_status = null,
                 production_qa_status = null, staging_qa_detail = null,
                 production_qa_detail = null, claim_token_hash = null,
                 claimed_by = null, claimed_at = null, lease_expires_at = null,
                 completed_at = null, last_event_at = ?, updated_at = ?
             where id = ? and project_id = ? and status in ('blocked', 'failed')
               and current_attempt = ? and last_event_at = ?`,
          )
          .bind(
            detail,
            nextAttempt,
            input.occurredAt,
            recordedAt,
            run.id,
            projectId,
            run.current_attempt,
            run.last_event_at,
          )
      : db
          .prepare(
            `update briar_hunt_runs
             set stage = 'cancelled', status = 'cancelled', detail = ?,
                 claim_token_hash = null,
                 claimed_by = null, claimed_at = null, lease_expires_at = null,
                 completed_at = ?, last_event_at = ?, updated_at = ?
             where id = ? and project_id = ?
               and status not in ('completed', 'cancelled')
               and current_attempt = ? and last_event_at = ?`,
          )
          .bind(
            detail,
            input.occurredAt,
            input.occurredAt,
            recordedAt,
            run.id,
            projectId,
            run.current_attempt,
            run.last_event_at,
          );

  const results = await db.batch([
    update,
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, stage, status, workflow_stage,
           detail, actor, branch,
           commit_sha, qa_status, tracker_issue_state, pull_request_urls,
           target_sha, occurred_at, recorded_at
         )
         select ?, id, ?, ?, ?, ?, null, ?, ?, null, null, null,
                tracker_issue_state, '[]', null, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and status = ? and last_event_at = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        nextAttempt,
        nextStage,
        nextStage,
        detail,
        input.actor,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        nextAttempt,
        nextStage,
        input.occurredAt,
      ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    const duplicate = await db
      .prepare(
        `select attempt, stage from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<Pick<HuntEventRow, "attempt" | "stage">>();
    if (duplicate) {
      return {
        outcome:
          input.action === "retry" ? "already_retried" : "already_cancelled",
        attempt: duplicate.attempt,
        stage: duplicate.stage,
      };
    }
    const current = await getHuntRunForProject(db, projectId, run.id);
    return {
      outcome: "ineligible",
      attempt: current?.current_attempt ?? null,
      stage: current?.stage ?? null,
    };
  }

  return {
    outcome: input.action === "retry" ? "retried" : "cancelled",
    attempt: nextAttempt,
    stage: nextStage,
  };
}

export type HuntMoveOutcome =
  "moved" | "unchanged" | "already_moved" | "not_found";

export async function moveHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    status: AutoHuntRunStatus;
    workflowStage: AutoHuntWorkflowStageId | null;
    requestId: string;
    actor: string;
    occurredAt: string;
  },
): Promise<{
  outcome: HuntMoveOutcome;
  status: AutoHuntRunStatus | null;
  workflowStage: AutoHuntWorkflowStageId | null;
}> {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) {
    return { outcome: "not_found", status: null, workflowStage: null };
  }

  const workflow = parseWorkflow(run.workflow_snapshot_json);
  if (input.status === "running") {
    const targetRank = workflow.stages.findIndex(
      (stage) => stage.id === input.workflowStage,
    );
    if (
      !input.workflowStage ||
      targetRank < 0
    ) {
      throw new HuntTransitionError(
        `Workflow stage is not configured for this run: ${input.workflowStage ?? "none"}`,
      );
    }
    if (targetRank > workflowStopIndex(workflow)) {
      throw new HuntTransitionError(
        `Workflow stops after stage: ${workflow.execution.stopAfterStage}`,
      );
    }
  } else if (input.workflowStage !== null) {
    throw new HuntTransitionError(
      "Only running status can select a workflow stage",
    );
  }

  const targetWorkflowStage =
    input.status === "backlog" || input.status === "queued"
      ? null
      : input.status === "running"
        ? input.workflowStage
        : run.workflow_stage;
  const eventKey = `admin:move:${input.requestId}`;
  const existingEvent = await db
    .prepare(
      `select status, workflow_stage from briar_hunt_events
       where run_id = ? and event_key = ?`,
    )
    .bind(run.id, eventKey)
    .first<Pick<HuntEventRow, "status" | "workflow_stage">>();
  if (existingEvent) {
    return {
      outcome: "already_moved",
      status: existingEvent.status,
      workflowStage: existingEvent.workflow_stage,
    };
  }
  if (
    run.status === input.status &&
    (input.status !== "running" || run.workflow_stage === targetWorkflowStage)
  ) {
    return {
      outcome: "unchanged",
      status: run.status,
      workflowStage: run.workflow_stage,
    };
  }

  const targetStage = dashboardStageFor(input.status, targetWorkflowStage);
  const currentRank = run.workflow_stage
    ? workflow.stages.findIndex((stage) => stage.id === run.workflow_stage)
    : -1;
  const targetRank = targetWorkflowStage
    ? workflow.stages.findIndex((stage) => stage.id === targetWorkflowStage)
    : -1;
  const isRegression =
    input.status === "running" &&
    currentRank >= 0 &&
    targetRank >= 0 &&
    targetRank < currentRank;
  const targetLabel =
    input.status === "running"
      ? workflow.stages.find((stage) => stage.id === targetWorkflowStage)?.label
      : {
          backlog: "백로그",
          queued: "대기",
          blocked: "차단",
          failed: "실패",
          completed: "완료",
          cancelled: "취소",
        }[input.status];
  const detail = `사용자가 작업을 ${targetLabel ?? input.status} 상태로 이동했습니다.`;
  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const targetAttempt =
    input.status === "queued" ? run.current_attempt + 1 : run.current_attempt;
  const targetRevision =
    input.status === "queued"
      ? 1
      : isRegression
        ? run.current_revision + 1
        : run.current_revision;
  const invalidatedStages = isRegression
    ? workflow.stages.slice(targetRank).map((stage) => stage.id)
    : [];
  const completedAt = ["completed", "cancelled"].includes(input.status)
    ? input.occurredAt
    : null;

  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
           detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
           pull_request_urls, target_sha, occurred_at, recorded_at
         )
         select ?, id, ?, ?, ?, ?, ?, ?, ?, ?, branch, commit_sha,
                null, tracker_issue_state, pull_request_urls, target_sha, ?, ?
         from briar_hunt_runs
         where id = ? and project_id = ? and current_attempt = ?
           and last_event_at = ?
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        eventKey,
        targetAttempt,
        targetRevision,
        targetStage,
        input.status,
        targetWorkflowStage,
        detail,
        input.actor,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        run.last_event_at,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set stage = ?, status = ?, workflow_stage = ?, detail = ?,
             current_attempt = ?, current_revision = ?,
             commit_sha = case when ? then null else commit_sha end,
             target_sha = case when ? then null else target_sha end,
             result_summary = case when ? then null else result_summary end,
             structured_result_json = case when ? then null else structured_result_json end,
             staging_qa_status = case when ? then null else staging_qa_status end,
             production_qa_status = case when ? then null else production_qa_status end,
             staging_qa_detail = case when ? then null else staging_qa_detail end,
             production_qa_detail = case when ? then null else production_qa_detail end,
             claim_token_hash = null, claimed_by = null, claimed_at = null,
             lease_expires_at = null, completed_at = ?, last_event_at = ?,
             updated_at = ?
         where id = ? and project_id = ? and current_attempt = ?
           and last_event_at = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        targetStage,
        input.status,
        targetWorkflowStage,
        detail,
        targetAttempt,
        targetRevision,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        isRegression ? 1 : 0,
        completedAt,
        input.occurredAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        run.last_event_at,
        eventId,
      ),
    ...invalidatedStages.map((stage) =>
      db
        .prepare(
          `insert into briar_run_stage_revisions (
             run_id, attempt, workflow_stage, required_revision
           )
           select id, current_attempt, ?, current_revision
           from briar_hunt_runs
           where id = ? and project_id = ? and current_attempt = ?
             and current_revision = ? and last_event_at = ?
           on conflict(run_id, attempt, workflow_stage)
           do update set required_revision = excluded.required_revision`,
        )
        .bind(
          stage,
          run.id,
          projectId,
          targetAttempt,
          targetRevision,
          input.occurredAt,
        ),
    ),
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) {
    const duplicate = await db
      .prepare(
        `select status, workflow_stage from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<Pick<HuntEventRow, "status" | "workflow_stage">>();
    if (duplicate) {
      return {
        outcome: "already_moved",
        status: duplicate.status,
        workflowStage: duplicate.workflow_stage,
      };
    }
    throw new HuntTransitionError(
      "Auto Hunt run changed while its status was being moved",
    );
  }

  return {
    outcome: "moved",
    status: input.status,
    workflowStage: targetWorkflowStage,
  };
}

export type LinearImportRunInput = {
  sourceKey: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: AutoHuntRunStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
  tracker: {
    provider: string;
    issueId: string;
    identifier: string | null;
    url: string | null;
    state: string | null;
  };
  sourceCreatedAt: string | null;
};

/**
 * One-time admin import of external tracker issues. Bypasses completion
 * eligibility so historical Linear issues can land directly as completed.
 */
export async function importLinearHuntRuns(
  db: D1Database,
  projectId: string,
  repository: string,
  inputs: LinearImportRunInput[],
): Promise<{ imported: number; skipped: number; failed: number }> {
  const settings = await getProjectSettings(db, projectId);
  const workflowSnapshot = parseWorkflow(settings?.workflow_json);
  if (isRepositoryWorkflowPending(workflowSnapshot)) {
    throw new HuntTransitionError(
      "Repository workflow has not been generated for this project",
    );
  }
  const workflowStageIds = new Set(
    workflowSnapshot.stages.map((stage) => stage.id),
  );

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const raw of inputs) {
    try {
      const title = raw.title.trim().slice(0, 300);
      if (!title) {
        failed += 1;
        continue;
      }
      const sourceKey = raw.sourceKey.trim().slice(0, 200);
      if (!sourceKey) {
        failed += 1;
        continue;
      }

      const existingBySource = await db
        .prepare(
          `select id from briar_hunt_runs
           where project_id = ? and source = 'issue' and source_key = ?
           limit 1`,
        )
        .bind(projectId, sourceKey)
        .first<{ id: string }>();
      if (existingBySource) {
        skipped += 1;
        continue;
      }

      const existingByTracker = await db
        .prepare(
          `select id from briar_hunt_runs
           where project_id = ? and tracker_provider = ? and tracker_issue_id = ?
           limit 1`,
        )
        .bind(projectId, raw.tracker.provider, raw.tracker.issueId)
        .first<{ id: string }>();
      if (existingByTracker) {
        skipped += 1;
        continue;
      }

      let status = raw.status;
      let workflowStage = status === "running" ? raw.workflowStage : null;
      if (
        status === "running" &&
        (!workflowStage || !workflowStageIds.has(workflowStage))
      ) {
        workflowStage = workflowSnapshot.stages[0]?.id ?? null;
        if (!workflowStage) {
          status = "queued";
          workflowStage = null;
        }
      }

      const stage = dashboardStageFor(status, workflowStage);
      const runId = await digestRunId(projectId, "issue", sourceKey);
      const eventId = crypto.randomUUID();
      const recordedAt = new Date().toISOString();
      const occurredAt = raw.sourceCreatedAt ?? recordedAt;
      const completedAt = ["completed", "cancelled"].includes(status)
        ? occurredAt
        : null;
      const detail =
        status === "queued"
          ? "Linear에서 가져온 이슈가 Auto Hunt 처리를 기다리고 있습니다."
          : `Linear에서 가져왔으며 ${status} 상태로 설정되었습니다.`;
      const resultSummary =
        status === "completed" ? "Imported from Linear as completed." : null;
      const priority =
        raw.priority != null && raw.priority >= 1 && raw.priority <= 4
          ? raw.priority
          : null;

      const results = await db.batch([
        db
          .prepare(
            `insert into briar_hunt_runs (
               id, project_id, source, source_key, title, stage, status,
               workflow_stage, workflow_snapshot_json, detail, priority,
               repository, branch, commit_sha, tracker_provider,
               tracker_issue_id, tracker_issue_identifier, tracker_issue_url,
               tracker_issue_state, issue_description, result_summary,
               structured_result_json,
               pull_request_urls, target_sha, source_created_at,
               staging_qa_status, production_qa_status, staging_qa_detail,
               production_qa_detail, context_json, started_at, completed_at,
               last_event_at, created_at, updated_at
             ) values (?, ?, 'issue', ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, ?, ?, ?, ?, ?, ?, null, '[]', null, ?, null, null, null, null, ?, ?, ?, ?, ?, ?)
             on conflict(project_id, source, source_key) do nothing`,
          )
          .bind(
            runId,
            projectId,
            sourceKey,
            title,
            stage,
            status,
            workflowStage,
            stableJson(workflowSnapshot),
            detail,
            priority,
            repository,
            raw.tracker.provider,
            raw.tracker.issueId,
            raw.tracker.identifier,
            raw.tracker.url,
            raw.tracker.state,
            raw.description?.slice(0, 100_000) ?? null,
            resultSummary,
            raw.sourceCreatedAt,
            stableJson({
              origin: "linear-import",
              linearIssueId: raw.tracker.issueId,
            }),
            occurredAt,
            completedAt,
            occurredAt,
            recordedAt,
            recordedAt,
          ),
        db
          .prepare(
            `insert into briar_hunt_events (
               id, run_id, event_key, attempt, stage, status, workflow_stage,
               detail, actor, branch, commit_sha, qa_status, tracker_issue_state,
               pull_request_urls, target_sha, occurred_at, recorded_at
             ) values (?, ?, ?, 1, ?, ?, ?, ?, 'briar-linear-import', null, null, null, ?, '[]', null, ?, ?)
             on conflict(run_id, event_key) do nothing`,
          )
          .bind(
            eventId,
            runId,
            `${sourceKey}:import`,
            stage,
            status,
            workflowStage,
            detail,
            raw.tracker.state,
            occurredAt,
            recordedAt,
          ),
      ]);

      if ((results[0]?.meta.changes ?? 0) === 0) {
        skipped += 1;
      } else {
        imported += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return { imported, skipped, failed };
}

export type QaActionOutcome =
  | "passed"
  | "already_passed"
  | "skipped"
  | "already_skipped"
  | "ineligible"
  | "not_found";

export async function recordQaResult(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    environment: AutoHuntQaEnvironment;
    result: "passed" | "skipped";
    actor: string;
    observedAt: string;
    detail: string | null;
  },
): Promise<QaActionOutcome> {
  const run = await db
    .prepare(`select * from briar_hunt_runs where id = ? and project_id = ?`)
    .bind(input.runId, projectId)
    .first<HuntRunRow>();
  if (!run) return "not_found";

  const statusColumn =
    input.environment === "staging"
      ? "staging_qa_status"
      : "production_qa_status";
  const expectedStage =
    input.environment === "staging" ? "staging_qa" : "production_qa";
  const currentStatus = run[statusColumn];
  if (currentStatus === input.result) return `already_${input.result}`;
  const eligible =
    input.result === "passed"
      ? run.stage === expectedStage && currentStatus === "pending"
      : currentStatus === "pending" &&
        [expectedStage, "blocked", "failed"].includes(run.stage);
  if (!eligible) return "ineligible";

  const eventId = crypto.randomUUID();
  const eventKey = `admin:qa-${input.result === "passed" ? "pass" : "skip"}:${input.environment}:attempt-${run.current_attempt}:revision-${run.current_revision}`;
  const detail =
    input.detail ??
    (input.result === "passed"
      ? `${input.environment === "staging" ? "Stage" : "Production"} QA를 완료했습니다.`
      : `${input.environment === "staging" ? "Stage" : "Production"} QA를 건너뛰었습니다.`);
  const recordedAt = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status, workflow_stage,
           detail, actor, branch, commit_sha,
           qa_status, tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         ) values (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        run.id,
        eventKey,
        run.current_attempt,
        run.current_revision,
        expectedStage,
        expectedStage,
        detail,
        input.actor,
        run.branch,
        run.commit_sha,
        input.result,
        run.tracker_issue_state,
        run.pull_request_urls,
        run.target_sha,
        input.observedAt,
        recordedAt,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set ${statusColumn} = ?, detail = ?, last_event_at = max(last_event_at, ?),
             updated_at = ?
         where id = ? and project_id = ? and current_attempt = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        input.result,
        detail,
        input.observedAt,
        recordedAt,
        run.id,
        projectId,
        run.current_attempt,
        eventId,
      ),
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) return "ineligible";

  if ((results[0]?.meta.changes ?? 0) === 0) {
    const existing = await db
      .prepare(
        `select qa_status from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<AutoHuntQaStatus>("qa_status");
    if (existing !== input.result) throw new EventKeyConflictError();
    return `already_${input.result}`;
  }
  return input.result;
}

export async function getHuntRunForProject(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  return db
    .prepare(`select * from briar_hunt_runs where id = ? and project_id = ?`)
    .bind(runId, projectId)
    .first<HuntRunRow>();
}

export async function updateIssue(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    title: string;
    description: string | null;
    priority: number | null;
    updatedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_hunt_runs
       set title = ?, issue_description = ?, priority = ?, updated_at = ?
       where id = ? and project_id = ?
       returning *`,
    )
    .bind(
      input.title,
      input.description,
      input.priority,
      input.updatedAt,
      runId,
      projectId,
    )
    .first<HuntRunRow>();
}

export async function updateIssueExecutionPreferences(
  db: D1Database,
  projectId: string,
  runId: string,
  input: {
    provider: ProjectAgentProvider | null;
    model: string | null;
    effort: ModelEffort | null;
    updatedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_hunt_runs
       set preferred_agent_provider = ?,
           preferred_agent_model = ?,
           preferred_agent_effort = ?,
           updated_at = ?
       where id = ? and project_id = ?
       returning *`,
    )
    .bind(
      input.provider,
      input.model,
      input.effort,
      input.updatedAt,
      runId,
      projectId,
    )
    .first<HuntRunRow>();
}

export async function deleteIssue(
  db: D1Database,
  projectId: string,
  runId: string,
  observedAt: string,
): Promise<"deleted" | "active" | "not_found"> {
  const deleted = await db
    .prepare(
      `delete from briar_hunt_runs
       where id = ? and project_id = ?
         and status <> 'running'
         and not (
           status = 'queued'
           and lease_expires_at is not null
           and lease_expires_at > ?
         )
       returning id`,
    )
    .bind(runId, projectId, observedAt)
    .first<{ id: string }>();
  if (deleted) return "deleted";
  const run = await db
    .prepare(
      `select id from briar_hunt_runs
       where id = ? and project_id = ?`,
    )
    .bind(runId, projectId)
    .first<{ id: string }>();
  return run ? "active" : "not_found";
}
