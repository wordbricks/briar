import * as Schema from "effect/Schema";
import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import { IsoDateTimeWithOffset } from "../../src/lib/date-time-schema";
import type { OrganizationAgentContextLookupRequest } from "../../src/lib/organization-agent-context-contract";
import { parseStructuredResult } from "./agent-result-json";
import {
  type ArchiveBucket,
  type ArchiveMetadataRow,
  readArchivedProjectAgentSession,
} from "./archive";
import {
  type TeamAgentSessionRow,
} from "./db";
import { hydrateAgentSkills } from "./agent-skills";
import type { OrganizationAgentRow } from "./organization-agents";
import { decodeStoredTeamAgentSessionPayload } from "./team-request-contract";

export const organizationAgentContextDefaultPageSize = 25;
export const organizationAgentContextMaxPageSize = 50;
export const organizationAgentContextMaxEncodedPageBytes = 1_500_000;

type ContextResource =
  | "agents"
  | "issues"
  | "agent-sessions";

type ContextPageInput = {
  organizationId: string;
  workId: string;
  snapshotAt: string;
  limit?: number;
  cursor?: string | null;
};

type ProjectContextPageInput = ContextPageInput & { projectId: string };

const cursorSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;
const strictCursor = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: cursorSchemaOptions });
const cursorUuid = Schema.String.check(Schema.isUUID());
const contextCursorBaseFields = {
  schemaVersion: Schema.Literal(1),
  organizationId: cursorUuid,
  workId: cursorUuid,
  snapshotAt: IsoDateTimeWithOffset,
} as const;

const agentCursorSchema = strictCursor(Schema.Struct({
  ...contextCursorBaseFields,
  resource: Schema.Literal("agents"),
  projectId: cursorUuid,
  createdAt: IsoDateTimeWithOffset,
  id: cursorUuid,
}));
type AgentCursor = typeof agentCursorSchema.Type;

const issueCursorSchema = strictCursor(Schema.Struct({
  ...contextCursorBaseFields,
  resource: Schema.Literal("issues"),
  projectId: cursorUuid,
  runNumber: Schema.Natural,
}));
type IssueCursor = typeof issueCursorSchema.Type;

const sessionCursorSchema = strictCursor(Schema.Struct({
  ...contextCursorBaseFields,
  resource: Schema.Literal("agent-sessions"),
  projectId: cursorUuid,
  id: Schema.String.check(Schema.isLengthBetween(1, 128)),
}));
type SessionCursor = typeof sessionCursorSchema.Type;

const contextCursorSchema = Schema.Union([
  agentCursorSchema,
  issueCursorSchema,
  sessionCursorSchema,
]);
type ContextCursor = typeof contextCursorSchema.Type;

const decodeContextCursor = Schema.decodeUnknownSync(
  contextCursorSchema,
  cursorSchemaOptions,
);

export class OrganizationAgentContextCursorError extends Error {
  constructor(message = "Invalid organization context cursor") {
    super(message);
    this.name = "OrganizationAgentContextCursorError";
  }
}

export class OrganizationAgentContextPageTooLargeError extends Error {
  constructor() {
    super("One organization context item exceeds the encoded page limit");
    this.name = "OrganizationAgentContextPageTooLargeError";
  }
}

const encodeCursor = (cursor: ContextCursor) =>
  btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

const decodeCursor = (
  encoded: string | null | undefined,
  expected: {
    organizationId: string;
    workId: string;
    snapshotAt: string;
    resource: ContextResource;
    projectId: string | null;
  },
): ContextCursor | null => {
  if (!encoded) return null;
  if (encoded.length > 4_096 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new OrganizationAgentContextCursorError();
  }
  try {
    const padded = encoded.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const cursor = decodeContextCursor(JSON.parse(atob(padded)));
    if (
      cursor.organizationId !== expected.organizationId ||
      cursor.workId !== expected.workId ||
      cursor.snapshotAt !== expected.snapshotAt ||
      cursor.resource !== expected.resource ||
      cursor.projectId !== expected.projectId
    ) {
      throw new OrganizationAgentContextCursorError(
        "Organization context cursor belongs to another claim or resource",
      );
    }
    return cursor;
  } catch (error) {
    if (error instanceof OrganizationAgentContextCursorError) throw error;
    throw new OrganizationAgentContextCursorError();
  }
};

const pageLimit = (limit: number | undefined) => {
  const value = limit ?? organizationAgentContextDefaultPageSize;
  if (
    !Number.isSafeInteger(value) || value < 1 ||
    value > organizationAgentContextMaxPageSize
  ) {
    throw new RangeError(
      `Organization context page size must be 1-${organizationAgentContextMaxPageSize}`,
    );
  }
  return value;
};

const fitPageToByteBudget = <
  TBase extends Record<string, unknown>,
  TItem,
>(input: {
  base: TBase;
  items: TItem[];
  hasMore: boolean;
  cursorForLast: (index: number) => string;
}) => {
  let included = input.items.length;
  while (true) {
    const hasNext = input.hasMore || included < input.items.length;
    const nextCursor = hasNext && included > 0
      ? input.cursorForLast(included - 1)
      : null;
    const page = {
      ...input.base,
      items: input.items.slice(0, included),
      nextCursor,
      complete: nextCursor === null,
    };
    if (
      new TextEncoder().encode(JSON.stringify(page)).byteLength <=
        organizationAgentContextMaxEncodedPageBytes
    ) {
      return page;
    }
    if (included <= 1) {
      throw new OrganizationAgentContextPageTooLargeError();
    }
    included -= 1;
  }
};

const parseJson = (value: string | null) => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
};

const projectAgentContextJson = (
  agent: OrganizationAgentRow & {
    skills: NonNullable<OrganizationAgentRow["skills"]>;
  },
  snapshotAt: string,
) => ({
  id: agent.id,
  name: agent.name,
  provider: agent.provider,
  model: agent.model,
  effort: agent.effort,
  description: agent.description,
  responsibility: agent.responsibility,
  skills: (agent.skills ?? [])
    .filter((skill) => skill.created_at <= snapshotAt)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      provider: skill.provider,
      model: skill.model,
      effort: skill.effort,
      kind: skill.kind,
      position: skill.position,
    })),
  createdAt: agent.created_at,
  updatedAt: agent.updated_at,
});

type ContextProjectRow = {
  id: string;
  name: string;
  issue_key_prefix: string;
  created_at: string;
  velen_org: string | null;
  data_source: string | null;
  linear_enabled: number | null;
  linear_source: string | null;
  linear_team_key: string | null;
  github_repository: string | null;
  workflow_json: string | null;
};

type ContextIssueRow = {
  id: string;
  project_id: string;
  run_number: number;
  source: "issue" | "error" | "feedback";
  source_key: string;
  title: string;
  status: string;
  paused_at: string | null;
  workflow_stage: string | null;
  detail: string | null;
  priority: number | null;
  assignee_user_id: string | null;
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
  target_sha: string | null;
  staging_qa_status: string | null;
  production_qa_status: string | null;
  staging_qa_detail: string | null;
  production_qa_detail: string | null;
  agent_id: string | null;
  preferred_agent_provider: string | null;
  preferred_agent_model: string | null;
  preferred_agent_effort: string | null;
  requested_agent_provider: string | null;
  requested_agent_model: string | null;
  requested_agent_effort: string | null;
  source_created_at: string | null;
  started_at: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  last_event_at: string;
  event_count: number;
  event_count_stable: number;
};

const contextIssueJson = (row: ContextIssueRow) => {
  const structuredResult = parseStructuredResult(row.structured_result_json);
  return {
    id: row.id,
    projectId: row.project_id,
    runNumber: row.run_number,
    source: row.source,
    sourceKey: row.source_key,
    title: row.title,
    status: row.paused_at ? "paused" : row.status,
    workflowStage: row.workflow_stage,
    detail: row.detail,
    priority: row.priority,
    assigneeUserId: row.assignee_user_id,
    repository: row.repository,
    branch: row.branch,
    commitSha: row.commit_sha,
    tracker: row.tracker_provider
      ? {
          provider: row.tracker_provider,
          issueId: row.tracker_issue_id,
          identifier: row.tracker_issue_identifier,
          url: row.tracker_issue_url,
          state: row.tracker_issue_state,
        }
      : null,
    issueDescription: row.issue_description,
    resultSummary: row.result_summary,
    structuredResult,
    targetSha: row.target_sha,
    stagingQaStatus: row.staging_qa_status,
    productionQaStatus: row.production_qa_status,
    stagingQaDetail: row.staging_qa_detail,
    productionQaDetail: row.production_qa_detail,
    agentId: row.agent_id,
    preferredProvider: row.preferred_agent_provider,
    preferredModel: row.preferred_agent_model,
    preferredEffort: row.preferred_agent_effort,
    requestedProvider: row.requested_agent_provider,
    requestedModel: row.requested_agent_model,
    requestedEffort: row.requested_agent_effort,
    sourceCreatedAt: row.source_created_at,
    startedAt: row.started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    lastEventAt: row.last_event_at,
    eventCount: row.event_count,
    eventCountStable: row.event_count_stable === 1,
  };
};

type ContextIssuePullRequestRow = {
  issue_id: string;
  project_id: string;
  run_number: number;
  position: number;
  url: string;
};

const sessionContextJson = (row: TeamAgentSessionRow) => {
  const payload = { ...decodeStoredTeamAgentSessionPayload(row.payload_json) };
  delete payload.requestedByUserId;
  return {
    id: row.id,
    projectId: row.project_id,
    agentId: row.agent_id,
    status: row.status,
    sessionType: row.session_type,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    payload,
  };
};

const getContextSession = async (
  db: D1Database,
  archives: ArchiveBucket,
  input: {
    projectId: string;
    sessionId: string;
    snapshotAt: string;
  },
) => {
  const hot = await db.prepare(
    `select session.project_id, session.id, session.agent_id, session.status,
            session.requested_by_user_id, session.session_type,
            session.payload_json, session.started_at,
            session.completed_at, session.updated_at
     from briar_project_agent_sessions session
     join briar_project_agent_session_context_membership membership
       on membership.project_id = session.project_id
      and membership.session_id = session.id
     where session.project_id = ? and session.id = ?
       and membership.visible_at <= ?`,
  ).bind(
    input.projectId,
    input.sessionId,
    input.snapshotAt,
  ).first<TeamAgentSessionRow>();
  if (hot) return hot;
  const metadata = await db.prepare(
    `select * from briar_log_archives
     where project_id = ? and scope_id = ?
       and archive_kind = 'project_agent_sessions'
       and status in ('verified', 'complete')
       and exists (
         select 1
         from briar_project_agent_session_context_membership membership
         where membership.project_id = briar_log_archives.project_id
           and membership.session_id = briar_log_archives.scope_id
           and membership.visible_at <= ?
       )
     order by period_end desc,
              coalesce(completed_at, verified_at, created_at) desc, id desc
     limit 1`,
  ).bind(
    input.projectId,
    input.sessionId,
    input.snapshotAt,
  ).first<ArchiveMetadataRow>();
  if (!metadata) {
    throw new Error(
      `Organization context session disappeared while paging: ${input.sessionId}`,
    );
  }
  return readArchivedProjectAgentSession(archives, metadata);
};

type ContextManifestRow = {
  id: string;
  name: string;
  issue_key_prefix: string;
  created_at: string;
  updated_at: string;
  settings_revision: string | null;
  agent_count: number;
  agent_revision: string | null;
  issue_count: number;
  open_issue_count: number;
  pull_request_count: number;
  issue_revision: string | null;
  session_count: number;
  archived_session_count: number;
  session_revision: string | null;
};

const sha256Hex = async (value: string) => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * Returns a small, stable index in a fixed number of D1 queries. It deliberately
 * excludes settings, Skill instructions, issue bodies, and archived session
 * payloads; those are claim-scoped lookups performed only after the Agent asks.
 */
export async function organizationAgentContextManifest(
  db: D1Database,
  input: ContextPageInput,
) {
  const result = await db.prepare(
    `with agent_stats as (
       select agent.project_id, count(distinct agent.id) as agent_count,
              max(coalesce(skill.updated_at, agent.updated_at)) as revision
       from briar_project_agents agent
       left join briar_agent_skills skill
         on skill.agent_id = agent.id and skill.created_at <= ?
       where agent.created_at <= ?
       group by agent.project_id
     ), issue_stats as (
       select run.project_id, count(*) as issue_count,
              sum(case when run.status not in ('completed', 'cancelled')
                       then 1 else 0 end) as open_issue_count,
              coalesce(sum(json_array_length(run.pull_request_urls)), 0)
                as pull_request_count,
              max(run.updated_at) as revision
       from briar_hunt_runs run
       where run.created_at <= ?
       group by run.project_id
     ), session_candidates as (
       select session.project_id, session.id, session.updated_at as revision,
              0 as archived
       from briar_project_agent_sessions session
       join briar_project_agent_session_context_membership membership
         on membership.project_id = session.project_id
        and membership.session_id = session.id
       where membership.visible_at <= ?
       union all
       select archive.project_id, archive.scope_id as id,
              coalesce(archive.completed_at, archive.verified_at,
                       archive.created_at) as revision,
              1 as archived
       from briar_log_archives archive
       join briar_project_agent_session_context_membership membership
         on membership.project_id = archive.project_id
        and membership.session_id = archive.scope_id
       where archive.archive_kind = 'project_agent_sessions'
         and archive.status in ('verified', 'complete')
         and membership.visible_at <= ?
     ), sessions as (
       select project_id, id, max(revision) as revision, min(archived) as archived
       from session_candidates group by project_id, id
     ), session_stats as (
       select project_id, count(*) as session_count,
              sum(archived) as archived_session_count,
              max(revision) as revision
       from sessions group by project_id
     )
     select project.id, project.name, project.issue_key_prefix,
            project.created_at, project.updated_at,
            settings.updated_at as settings_revision,
            coalesce(agent_stats.agent_count, 0) as agent_count,
            agent_stats.revision as agent_revision,
            coalesce(issue_stats.issue_count, 0) as issue_count,
            coalesce(issue_stats.open_issue_count, 0) as open_issue_count,
            coalesce(issue_stats.pull_request_count, 0) as pull_request_count,
            issue_stats.revision as issue_revision,
            coalesce(session_stats.session_count, 0) as session_count,
            coalesce(session_stats.archived_session_count, 0)
              as archived_session_count,
            session_stats.revision as session_revision
     from briar_projects project
     left join briar_project_settings settings on settings.project_id = project.id
     left join agent_stats on agent_stats.project_id = project.id
     left join issue_stats on issue_stats.project_id = project.id
     left join session_stats on session_stats.project_id = project.id
     where project.organization_id = ? and project.created_at <= ?
     order by project.created_at, project.id`,
  ).bind(
    input.snapshotAt,
    input.snapshotAt,
    input.snapshotAt,
    input.snapshotAt,
    input.snapshotAt,
    input.organizationId,
    input.snapshotAt,
  ).all<ContextManifestRow>();
  const projects = result.results.map((row) => ({
    id: row.id,
    name: row.name,
    issueKeyPrefix: row.issue_key_prefix,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resources: {
      settings: { revision: row.settings_revision },
      agents: { count: row.agent_count, revision: row.agent_revision },
      issues: {
        count: row.issue_count,
        openCount: row.open_issue_count,
        pullRequestCount: row.pull_request_count,
        revision: row.issue_revision,
      },
      sessions: {
        count: row.session_count,
        archivedCount: row.archived_session_count,
        revision: row.session_revision,
      },
    },
  }));
  const revision = await sha256Hex(JSON.stringify(projects));
  return {
    schemaVersion: 2 as const,
    organizationId: input.organizationId,
    workId: input.workId,
    snapshotAt: input.snapshotAt,
    revision,
    projects,
    loadedQueries: [],
  };
}

const sqlPlaceholders = (values: readonly unknown[]) =>
  values.map(() => "?").join(", ");

const orderedByRequestedIds = <T extends { id: string }>(
  items: T[],
  ids: readonly string[],
) => {
  const positions = new Map(ids.map((id, index) => [id, index]));
  return items.sort(
    (left, right) =>
      (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
};

async function organizationAgentContextProjectSettings(
  db: D1Database,
  input: ProjectContextPageInput,
) {
  const row = await db.prepare(
    `select project.id, project.name, project.issue_key_prefix,
            project.created_at, settings.velen_org, settings.data_source,
            settings.linear_enabled, settings.linear_source,
            settings.linear_team_key, settings.github_repository,
            settings.workflow_json
     from briar_projects project
     left join briar_project_settings settings on settings.project_id = project.id
     where project.id = ? and project.organization_id = ?
       and project.created_at <= ?`,
  ).bind(
    input.projectId,
    input.organizationId,
    input.snapshotAt,
  ).first<ContextProjectRow>();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    issueKeyPrefix: row.issue_key_prefix,
    createdAt: row.created_at,
    settings: {
      velenOrg: row.velen_org,
      dataSource: row.data_source,
      linear: {
        enabled: row.linear_enabled === 1,
        source: row.linear_source,
        teamKey: row.linear_team_key,
      },
      githubRepository: row.github_repository,
      workflow: row.workflow_json
        ? normalizeAutoHuntWorkflow(JSON.parse(row.workflow_json))
        : null,
    },
  };
}

async function organizationAgentContextAgentSummaries(
  db: D1Database,
  input: ProjectContextPageInput,
) {
  const limit = pageLimit(input.limit);
  const cursor = decodeCursor(input.cursor, {
    organizationId: input.organizationId,
    workId: input.workId,
    snapshotAt: input.snapshotAt,
    resource: "agents",
    projectId: input.projectId,
  }) as AgentCursor | null;
  const [count, result] = await Promise.all([
    db.prepare(
      `select count(*) as count
       from briar_project_agents agent
       join briar_projects project on project.id = agent.project_id
       where agent.project_id = ? and project.organization_id = ?
         and agent.created_at <= ?`,
    ).bind(
      input.projectId,
      input.organizationId,
      input.snapshotAt,
    ).first<{ count: number }>(),
    db.prepare(
      `select agent.id, agent.name, agent.provider, agent.model,
              agent.effort, agent.description, agent.responsibility,
              agent.created_at,
              agent.updated_at
       from briar_project_agents agent
       join briar_projects project on project.id = agent.project_id
       where agent.project_id = ? and project.organization_id = ?
         and agent.created_at <= ?
         and (? is null or agent.created_at > ?
              or (agent.created_at = ? and agent.id > ?))
       order by agent.created_at, agent.id limit ?`,
    ).bind(
      input.projectId,
      input.organizationId,
      input.snapshotAt,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ).all<{
      id: string;
      name: string;
      provider: string;
      model: string | null;
      effort: string | null;
      description: string;
      responsibility: string;
      created_at: string;
      updated_at: string;
    }>(),
  ]);
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const skills = rows.length === 0
    ? []
    : (await db.prepare(
      `select skill.id, skill.agent_id, skill.name, skill.kind,
              skill.position, skill.updated_at
       from briar_agent_skills skill
       where skill.agent_id in (${sqlPlaceholders(rows)})
         and skill.created_at <= ?
       order by skill.agent_id, skill.position, skill.created_at, skill.id`,
    ).bind(...rows.map((row) => row.id), input.snapshotAt).all<{
      id: string;
      agent_id: string;
      name: string;
      kind: string;
      position: number;
      updated_at: string;
    }>()).results;
  const skillsByAgent = new Map<string, typeof skills>();
  for (const skill of skills) {
    const current = skillsByAgent.get(skill.agent_id) ?? [];
    current.push(skill);
    skillsByAgent.set(skill.agent_id, current);
  }
  const items = rows.map((row) => ({
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    effort: row.effort,
    description: row.description,
    responsibility: row.responsibility,
    skills: (skillsByAgent.get(row.id) ?? []).map((skill) => ({
      id: skill.id,
      name: skill.name,
      kind: skill.kind,
      position: skill.position,
      updatedAt: skill.updated_at,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  return fitPageToByteBudget({
    base: {
      schemaVersion: 2 as const,
      resource: "agents" as const,
      projectId: input.projectId,
      total: count?.count ?? 0,
      detail: "summary" as const,
    },
    items,
    hasMore,
    cursorForLast: (index) => encodeCursor({
      schemaVersion: 1,
      organizationId: input.organizationId,
      workId: input.workId,
      snapshotAt: input.snapshotAt,
      resource: "agents",
      projectId: input.projectId,
      createdAt: rows[index].created_at,
      id: rows[index].id,
    }),
  });
}

async function organizationAgentContextAgentDetails(
  db: D1Database,
  input: ProjectContextPageInput & { ids: string[] },
) {
  const result = await db.prepare(
    `select agent.id, agent.organization_id, agent.project_id,
            project.name as project_name, agent.name,
            null as avatar, agent.provider, agent.model,
            agent.description, agent.responsibility,
            null as skill_markdown, agent.effort,
            agent.computer_use_policy,
            agent.created_at, agent.updated_at
     from briar_project_agents agent
     join briar_projects project on project.id = agent.project_id
     where agent.project_id = ? and project.organization_id = ?
       and agent.created_at <= ?
       and agent.id in (${sqlPlaceholders(input.ids)})`,
  ).bind(
    input.projectId,
    input.organizationId,
    input.snapshotAt,
    ...input.ids,
  ).all<OrganizationAgentRow>();
  const hydrated = await hydrateAgentSkills(db, result.results);
  return orderedByRequestedIds(
    hydrated.map((agent) => projectAgentContextJson(agent, input.snapshotAt)),
    input.ids,
  );
}

async function organizationAgentContextSkillDetails(
  db: D1Database,
  input: ProjectContextPageInput & { ids: string[] },
) {
  const result = await db.prepare(
    `select skill.id, skill.name, skill.description, skill.body, skill.provider,
            skill.model, skill.effort, skill.kind, skill.position,
            skill.updated_at
     from briar_agent_skills skill
     join briar_project_agents agent on agent.id = skill.agent_id
     join briar_projects project on project.id = agent.project_id
     where agent.project_id = ? and project.organization_id = ?
       and skill.created_at <= ?
       and skill.id in (${sqlPlaceholders(input.ids)})`,
  ).bind(
    input.projectId,
    input.organizationId,
    input.snapshotAt,
    ...input.ids,
  ).all<{
    id: string;
    name: string;
    description: string;
    body: string;
    provider: string;
    model: string | null;
    effort: string | null;
    kind: string;
    position: number;
    updated_at: string;
  }>();
  return orderedByRequestedIds(
    result.results.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      provider: skill.provider,
      model: skill.model,
      effort: skill.effort,
      kind: skill.kind,
      position: skill.position,
      updatedAt: skill.updated_at,
    })),
    input.ids,
  );
}

async function organizationAgentContextIssueSummaries(
  db: D1Database,
  input: ProjectContextPageInput,
) {
  const limit = pageLimit(input.limit);
  const cursor = decodeCursor(input.cursor, {
    organizationId: input.organizationId,
    workId: input.workId,
    snapshotAt: input.snapshotAt,
    resource: "issues",
    projectId: input.projectId,
  }) as IssueCursor | null;
  const [count, result] = await Promise.all([
    db.prepare(
      `select count(*) as count
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       where run.project_id = ? and project.organization_id = ?
         and run.created_at <= ?`,
    ).bind(
      input.projectId,
      input.organizationId,
      input.snapshotAt,
    ).first<{ count: number }>(),
    db.prepare(
      `select run.id, run.run_number, run.source, run.source_key, run.title,
              run.status, run.paused_at, run.workflow_stage, run.priority,
              run.assignee_user_id, run.agent_id, run.repository,
              run.updated_at, run.completed_at, run.last_event_at,
              json_array_length(run.pull_request_urls) as pull_request_count
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       where run.project_id = ? and project.organization_id = ?
         and run.created_at <= ? and run.run_number > ?
       order by run.run_number limit ?`,
    ).bind(
      input.projectId,
      input.organizationId,
      input.snapshotAt,
      cursor?.runNumber ?? -1,
      limit + 1,
    ).all<{
      id: string;
      run_number: number;
      source: string;
      source_key: string;
      title: string;
      status: string;
      paused_at: string | null;
      workflow_stage: string | null;
      priority: number | null;
      assignee_user_id: string | null;
      agent_id: string | null;
      repository: string;
      updated_at: string;
      completed_at: string | null;
      last_event_at: string;
      pull_request_count: number;
    }>(),
  ]);
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const items = rows.map((row) => ({
    id: row.id,
    projectId: input.projectId,
    runNumber: row.run_number,
    source: row.source,
    sourceKey: row.source_key,
    title: row.title,
    status: row.paused_at ? "paused" : row.status,
    workflowStage: row.workflow_stage,
    priority: row.priority,
    assigneeUserId: row.assignee_user_id,
    agentId: row.agent_id,
    repository: row.repository,
    pullRequestCount: row.pull_request_count,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    lastEventAt: row.last_event_at,
  }));
  return fitPageToByteBudget({
    base: {
      schemaVersion: 2 as const,
      resource: "issues" as const,
      projectId: input.projectId,
      total: count?.count ?? 0,
      detail: "summary" as const,
    },
    items,
    hasMore,
    cursorForLast: (index) => encodeCursor({
      schemaVersion: 1,
      organizationId: input.organizationId,
      workId: input.workId,
      snapshotAt: input.snapshotAt,
      resource: "issues",
      projectId: input.projectId,
      runNumber: rows[index].run_number,
    }),
  });
}

async function organizationAgentContextIssueDetails(
  db: D1Database,
  input: ProjectContextPageInput & { ids: string[] },
) {
  const result = await db.prepare(
    `select run.id, run.project_id, run.run_number, run.source,
            run.source_key, run.title, run.status, run.paused_at,
            run.workflow_stage, run.detail, run.priority,
            run.assignee_user_id, run.repository, run.branch, run.commit_sha,
            run.tracker_provider, run.tracker_issue_id,
            run.tracker_issue_identifier, run.tracker_issue_url,
            run.tracker_issue_state, run.issue_description,
            run.result_summary, run.structured_result_json,
            run.target_sha, run.staging_qa_status,
            run.production_qa_status, run.staging_qa_detail,
            run.production_qa_detail, run.agent_id,
            run.preferred_agent_provider, run.preferred_agent_model,
            run.preferred_agent_effort, run.requested_agent_provider,
            run.requested_agent_model, run.requested_agent_effort,
            run.source_created_at, run.started_at, run.created_at,
            run.updated_at, run.completed_at, run.last_event_at,
            run.event_count + coalesce((
              select sum(archive.row_count) from briar_log_archives archive
              where archive.run_id = run.id
                and archive.archive_kind = 'run_events'
                and archive.status = 'complete'
            ), 0) as event_count,
            not exists (
              select 1 from briar_log_archives archive
              where archive.run_id = run.id
                and archive.archive_kind = 'run_events'
                and archive.status = 'verified'
            ) as event_count_stable
     from briar_hunt_runs run
     join briar_projects project on project.id = run.project_id
     where run.project_id = ? and project.organization_id = ?
       and run.created_at <= ?
       and run.id in (${sqlPlaceholders(input.ids)})`,
  ).bind(
    input.projectId,
    input.organizationId,
    input.snapshotAt,
    ...input.ids,
  ).all<ContextIssueRow>();
  return orderedByRequestedIds(
    result.results.map(contextIssueJson),
    input.ids,
  );
}

async function organizationAgentContextIssuePullRequests(
  db: D1Database,
  input: ProjectContextPageInput & { issueIds: string[] },
) {
  const result = await db.prepare(
    `select run.id as issue_id, run.project_id, run.run_number,
            cast(link.key as integer) as position, cast(link.value as text) as url
     from briar_hunt_runs run
     join briar_projects project on project.id = run.project_id
     join json_each(run.pull_request_urls) link
     where run.project_id = ? and project.organization_id = ?
       and run.created_at <= ?
       and run.id in (${sqlPlaceholders(input.issueIds)})
     order by run.run_number, cast(link.key as integer)`,
  ).bind(
    input.projectId,
    input.organizationId,
    input.snapshotAt,
    ...input.issueIds,
  ).all<ContextIssuePullRequestRow>();
  return result.results.map((row) => ({
    issueId: row.issue_id,
    projectId: row.project_id,
    runNumber: row.run_number,
    position: row.position,
    url: row.url,
  }));
}

type ContextSessionSummaryRow = {
  id: string;
  agent_id: string | null;
  status: string | null;
  session_type: string | null;
  payload_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  archived: number;
};

async function organizationAgentContextSessionSummaries(
  db: D1Database,
  input: ProjectContextPageInput,
) {
  const limit = pageLimit(input.limit);
  const cursor = decodeCursor(input.cursor, {
    organizationId: input.organizationId,
    workId: input.workId,
    snapshotAt: input.snapshotAt,
    resource: "agent-sessions",
    projectId: input.projectId,
  }) as SessionCursor | null;
  const candidateSql = `
    select session.id, session.agent_id, session.status, session.session_type,
           session.payload_json,
           session.started_at, session.completed_at, session.updated_at,
           0 as archived
    from briar_project_agent_sessions session
    join briar_project_agent_session_context_membership membership
      on membership.project_id = session.project_id
     and membership.session_id = session.id
    where session.project_id = ? and membership.visible_at <= ?
    union all
    select archive.scope_id as id, null as agent_id, null as status,
           null as session_type, null as payload_json,
           archive.period_start as started_at,
           archive.period_end as completed_at,
           coalesce(archive.completed_at, archive.verified_at,
                    archive.created_at) as updated_at,
           1 as archived
    from briar_log_archives archive
    join briar_project_agent_session_context_membership membership
      on membership.project_id = archive.project_id
     and membership.session_id = archive.scope_id
    where archive.project_id = ?
      and archive.archive_kind = 'project_agent_sessions'
      and archive.status in ('verified', 'complete')
      and membership.visible_at <= ?`;
  const [count, result] = await Promise.all([
    db.prepare(
      `select count(distinct id) as count from (${candidateSql}) candidates`,
    ).bind(
      input.projectId,
      input.snapshotAt,
      input.projectId,
      input.snapshotAt,
    ).first<{ count: number }>(),
    db.prepare(
      `select candidate.* from (${candidateSql}) candidate
       where candidate.id > ?
         and (candidate.archived = 0 or not exists (
           select 1 from briar_project_agent_sessions hot
           where hot.project_id = ? and hot.id = candidate.id
         ))
       order by candidate.id limit ?`,
    ).bind(
      input.projectId,
      input.snapshotAt,
      input.projectId,
      input.snapshotAt,
      cursor?.id ?? "",
      input.projectId,
      limit + 1,
    ).all<ContextSessionSummaryRow>(),
  ]);
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const items = rows.map((row) => ({
    id: row.id,
    projectId: input.projectId,
    agentId: row.agent_id,
    status: row.status,
    sessionType: row.session_type,
    summary: row.payload_json === null
      ? null
      : decodeStoredTeamAgentSessionPayload(row.payload_json).summary,
    archived: row.archived === 1,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  }));
  return fitPageToByteBudget({
    base: {
      schemaVersion: 2 as const,
      resource: "agent-sessions" as const,
      projectId: input.projectId,
      total: count?.count ?? 0,
      detail: "summary" as const,
    },
    items,
    hasMore,
    cursorForLast: (index) => encodeCursor({
      schemaVersion: 1,
      organizationId: input.organizationId,
      workId: input.workId,
      snapshotAt: input.snapshotAt,
      resource: "agent-sessions",
      projectId: input.projectId,
      id: rows[index].id,
    }),
  });
}

async function organizationAgentContextSessionDetails(
  db: D1Database,
  archives: ArchiveBucket,
  input: ProjectContextPageInput & { ids: string[] },
) {
  const rows = await Promise.all(input.ids.map(async (sessionId) => {
    try {
      return await getContextSession(db, archives, {
        projectId: input.projectId,
        sessionId,
        snapshotAt: input.snapshotAt,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith(
          "Organization context session disappeared while paging:",
        )
      ) {
        return null;
      }
      throw error;
    }
  }));
  return rows.filter((row): row is TeamAgentSessionRow => row !== null)
    .map(sessionContextJson);
}

export async function lookupOrganizationAgentContext(
  db: D1Database,
  archives: ArchiveBucket,
  input: ContextPageInput & {
    requests: OrganizationAgentContextLookupRequest[];
  },
) {
  const results = [];
  for (const request of input.requests) {
    const scoped = {
      organizationId: input.organizationId,
      workId: input.workId,
      snapshotAt: input.snapshotAt,
      projectId: request.projectId,
    };
    let data: unknown;
    if (request.resource === "project-settings") {
      data = await organizationAgentContextProjectSettings(db, scoped);
    } else if (request.resource === "skills") {
      data = await organizationAgentContextSkillDetails(db, {
        ...scoped,
        ids: request.ids,
      });
    } else if (request.resource === "issue-pull-requests") {
      data = await organizationAgentContextIssuePullRequests(db, {
        ...scoped,
        issueIds: request.issueIds,
      });
    } else if (request.resource === "agents") {
      data = request.detail === "summary"
        ? await organizationAgentContextAgentSummaries(db, {
            ...scoped,
            limit: request.limit,
            cursor: request.cursor,
          })
        : await organizationAgentContextAgentDetails(db, {
            ...scoped,
            ids: request.ids,
          });
    } else if (request.resource === "issues") {
      data = request.detail === "summary"
        ? await organizationAgentContextIssueSummaries(db, {
            ...scoped,
            limit: request.limit,
            cursor: request.cursor,
          })
        : await organizationAgentContextIssueDetails(db, {
            ...scoped,
            ids: request.ids,
          });
    } else {
      data = request.detail === "summary"
        ? await organizationAgentContextSessionSummaries(db, {
            ...scoped,
            limit: request.limit,
            cursor: request.cursor,
          })
        : await organizationAgentContextSessionDetails(db, archives, {
            ...scoped,
            ids: request.ids,
          });
    }
    results.push({ request, data });
  }
  return {
    schemaVersion: 2 as const,
    organizationId: input.organizationId,
    workId: input.workId,
    snapshotAt: input.snapshotAt,
    results,
  };
}
