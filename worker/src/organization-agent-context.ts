import { z } from "zod";
import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import { structuredAgentResultSchema } from "../../src/lib/agent-result";
import {
  type ArchiveBucket,
  type ArchiveMetadataRow,
  readArchivedProjectAgentSession,
} from "./archive";
import {
  getProjectSettings,
  type ProjectAgentSessionRow,
} from "./db";
import { hydrateAgentSkills } from "./agent-skills";
import type { OrganizationAgentRow } from "./organization-agents";

export const organizationAgentContextDefaultPageSize = 25;
export const organizationAgentContextMaxPageSize = 50;
export const organizationAgentContextMaxEncodedPageBytes = 1_500_000;

type ContextResource =
  | "projects"
  | "agents"
  | "issues"
  | "issue-pull-requests"
  | "agent-sessions";

type ContextPageInput = {
  organizationId: string;
  workId: string;
  snapshotAt: string;
  limit?: number;
  cursor?: string | null;
};

type ProjectContextPageInput = ContextPageInput & { projectId: string };

type ProjectCursor = {
  schemaVersion: 1;
  organizationId: string;
  workId: string;
  snapshotAt: string;
  resource: "projects";
  projectId: null;
  createdAt: string;
  id: string;
};

type IssueCursor = {
  schemaVersion: 1;
  organizationId: string;
  workId: string;
  snapshotAt: string;
  resource: "issues";
  projectId: string;
  runNumber: number;
};

type AgentCursor = {
  schemaVersion: 1;
  organizationId: string;
  workId: string;
  snapshotAt: string;
  resource: "agents";
  projectId: string;
  createdAt: string;
  id: string;
};

type IssuePullRequestCursor = {
  schemaVersion: 1;
  organizationId: string;
  workId: string;
  snapshotAt: string;
  resource: "issue-pull-requests";
  projectId: string;
  runNumber: number;
  position: number;
};

type SessionCursor = {
  schemaVersion: 1;
  organizationId: string;
  workId: string;
  snapshotAt: string;
  resource: "agent-sessions";
  projectId: string;
  id: string;
};

type ContextCursor =
  | ProjectCursor
  | AgentCursor
  | IssueCursor
  | IssuePullRequestCursor
  | SessionCursor;

const contextCursorSchema = z.discriminatedUnion("resource", [
  z.object({
    schemaVersion: z.literal(1),
    organizationId: z.string().uuid(),
    workId: z.string().uuid(),
    snapshotAt: z.string().datetime({ offset: true }),
    resource: z.literal("agents"),
    projectId: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    organizationId: z.string().uuid(),
    workId: z.string().uuid(),
    snapshotAt: z.string().datetime({ offset: true }),
    resource: z.literal("issue-pull-requests"),
    projectId: z.string().uuid(),
    runNumber: z.number().int().nonnegative(),
    position: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    organizationId: z.string().uuid(),
    workId: z.string().uuid(),
    snapshotAt: z.string().datetime({ offset: true }),
    resource: z.literal("projects"),
    projectId: z.null(),
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    organizationId: z.string().uuid(),
    workId: z.string().uuid(),
    snapshotAt: z.string().datetime({ offset: true }),
    resource: z.literal("issues"),
    projectId: z.string().uuid(),
    runNumber: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    organizationId: z.string().uuid(),
    workId: z.string().uuid(),
    snapshotAt: z.string().datetime({ offset: true }),
    resource: z.literal("agent-sessions"),
    projectId: z.string().uuid(),
    id: z.string().min(1).max(128),
  }).strict(),
]);

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
    const cursor = contextCursorSchema.parse(JSON.parse(atob(padded)));
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

const parseJson = (value: string | null): unknown => {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const parseJsonObject = (value: string | null) => {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
};

const projectAgentContextJson = (
  agent: OrganizationAgentRow & {
    skills: NonNullable<OrganizationAgentRow["skills"]>;
  },
  snapshotAt: string,
) => ({
  id: agent.id,
  handle: agent.handle,
  name: agent.name,
  provider: agent.provider,
  model: agent.model,
  effort: agent.effort,
  responsibility: agent.responsibility,
  skills: (agent.skills ?? [])
    .filter((skill) => skill.created_at <= snapshotAt)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      instructions: skill.instructions,
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
};

export async function listOrganizationAgentContextProjectsPage(
  db: D1Database,
  input: ContextPageInput,
) {
  const limit = pageLimit(input.limit);
  const cursor = decodeCursor(input.cursor, {
    organizationId: input.organizationId,
    workId: input.workId,
    snapshotAt: input.snapshotAt,
    resource: "projects",
    projectId: null,
  }) as ProjectCursor | null;
  const [count, result] = await Promise.all([
    db.prepare(
      `select count(*) as count
       from briar_projects
       where organization_id = ? and created_at <= ?`,
    ).bind(input.organizationId, input.snapshotAt).first<{ count: number }>(),
    db.prepare(
      `select id, name, issue_key_prefix, created_at
       from briar_projects
       where organization_id = ? and created_at <= ?
         and (
           ? is null or created_at > ?
           or (created_at = ? and id > ?)
         )
       order by created_at, id
       limit ?`,
    ).bind(
      input.organizationId,
      input.snapshotAt,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ).all<ContextProjectRow>(),
  ]);
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const items = await Promise.all(rows.map(async (row) => {
    const settings = await getProjectSettings(db, row.id);
    return {
      id: row.id,
      name: row.name,
      issueKeyPrefix: row.issue_key_prefix,
      createdAt: row.created_at,
      settings: {
        velenOrg: settings?.velen_org ?? null,
        dataSource: settings?.data_source ?? null,
        linear: {
          enabled: settings?.linear_enabled === 1,
          source: settings?.linear_source ?? null,
          teamKey: settings?.linear_team_key ?? null,
        },
        githubRepository: settings?.github_repository ?? null,
        workflow: settings?.workflow_json
          ? normalizeAutoHuntWorkflow(JSON.parse(settings.workflow_json))
          : null,
      },
    };
  }));
  return fitPageToByteBudget({
    base: {
      schemaVersion: 1 as const,
      organizationId: input.organizationId,
      workId: input.workId,
      resource: "projects" as const,
      projectId: null,
      snapshotAt: input.snapshotAt,
      total: count?.count ?? 0,
    },
    items,
    hasMore,
    cursorForLast: (index) => {
      const row = rows[index];
      return encodeCursor({
        schemaVersion: 1,
        organizationId: input.organizationId,
        workId: input.workId,
        snapshotAt: input.snapshotAt,
        resource: "projects",
        projectId: null,
        createdAt: row.created_at,
        id: row.id,
      });
    },
  });
}

export async function listOrganizationAgentContextAgentsPage(
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
       where agent.organization_id = ? and agent.project_id = ?
         and project.organization_id = ? and agent.created_at <= ?`,
    ).bind(
      input.organizationId,
      input.projectId,
      input.organizationId,
      input.snapshotAt,
    ).first<{ count: number }>(),
    db.prepare(
      `select agent.id, agent.organization_id, agent.project_id,
              project.name as project_name, agent.handle, agent.name,
              null as avatar, agent.provider, agent.model,
              agent.responsibility, null as skill_markdown, agent.effort,
              agent.created_at, agent.updated_at
       from briar_project_agents agent
       join briar_projects project on project.id = agent.project_id
       where agent.organization_id = ? and agent.project_id = ?
         and project.organization_id = ? and agent.created_at <= ?
         and (
           ? is null or agent.created_at > ?
           or (agent.created_at = ? and agent.id > ?)
         )
       order by agent.created_at, agent.id
       limit ?`,
    ).bind(
      input.organizationId,
      input.projectId,
      input.organizationId,
      input.snapshotAt,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ).all<OrganizationAgentRow>(),
  ]);
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const hydrated = await hydrateAgentSkills(db, rows);
  const items = hydrated.map((agent) =>
    projectAgentContextJson(agent, input.snapshotAt)
  );
  return fitPageToByteBudget({
    base: {
      schemaVersion: 1 as const,
      organizationId: input.organizationId,
      workId: input.workId,
      resource: "agents" as const,
      projectId: input.projectId,
      snapshotAt: input.snapshotAt,
      total: count?.count ?? 0,
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
  const structuredResult = structuredAgentResultSchema.safeParse(
    parseJson(row.structured_result_json),
  );
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
    structuredResult: structuredResult.success ? structuredResult.data : null,
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

export async function listOrganizationAgentContextIssuesPage(
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
              run.source_created_at,
              run.started_at, run.created_at, run.updated_at, run.completed_at,
              run.last_event_at,
              run.event_count + coalesce((
                select sum(archive.row_count)
                from briar_log_archives archive
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
         and run.created_at <= ? and run.run_number > ?
       order by run.run_number
       limit ?`,
    ).bind(
      input.projectId,
      input.organizationId,
      input.snapshotAt,
      cursor?.runNumber ?? -1,
      limit + 1,
    ).all<ContextIssueRow>(),
  ]);
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const items = rows.map(contextIssueJson);
  return fitPageToByteBudget({
    base: {
      schemaVersion: 1 as const,
      organizationId: input.organizationId,
      workId: input.workId,
      resource: "issues" as const,
      projectId: input.projectId,
      snapshotAt: input.snapshotAt,
      total: count?.count ?? 0,
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

type ContextIssuePullRequestRow = {
  issue_id: string;
  project_id: string;
  run_number: number;
  position: number;
  url: string;
};

export async function listOrganizationAgentContextIssuePullRequestsPage(
  db: D1Database,
  input: ProjectContextPageInput,
) {
  const limit = pageLimit(input.limit);
  const cursor = decodeCursor(input.cursor, {
    organizationId: input.organizationId,
    workId: input.workId,
    snapshotAt: input.snapshotAt,
    resource: "issue-pull-requests",
    projectId: input.projectId,
  }) as IssuePullRequestCursor | null;
  const [count, result] = await Promise.all([
    db.prepare(
      `select coalesce(sum(json_array_length(run.pull_request_urls)), 0) as count
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
      `select run.id as issue_id, run.project_id,
              run.run_number, cast(link.key as integer) as position,
              cast(link.value as text) as url
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       join json_each(run.pull_request_urls) link
       where run.project_id = ? and project.organization_id = ?
         and run.created_at <= ?
         and (
           run.run_number > ?
           or (run.run_number = ? and cast(link.key as integer) > ?)
         )
       order by run.run_number, cast(link.key as integer)
       limit ?`,
    ).bind(
      input.projectId,
      input.organizationId,
      input.snapshotAt,
      cursor?.runNumber ?? -1,
      cursor?.runNumber ?? -1,
      cursor?.position ?? -1,
      limit + 1,
    ).all<ContextIssuePullRequestRow>(),
  ]);
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const items = rows.map((row) => ({
    issueId: row.issue_id,
    projectId: row.project_id,
    runNumber: row.run_number,
    position: row.position,
    url: row.url,
  }));
  return fitPageToByteBudget({
    base: {
      schemaVersion: 1 as const,
      organizationId: input.organizationId,
      workId: input.workId,
      resource: "issue-pull-requests" as const,
      projectId: input.projectId,
      snapshotAt: input.snapshotAt,
      total: count?.count ?? 0,
    },
    items,
    hasMore,
    cursorForLast: (index) => encodeCursor({
      schemaVersion: 1,
      organizationId: input.organizationId,
      workId: input.workId,
      snapshotAt: input.snapshotAt,
      resource: "issue-pull-requests",
      projectId: input.projectId,
      runNumber: rows[index].run_number,
      position: rows[index].position,
    }),
  });
}

type SessionKeyRow = { id: string };

const sessionPayloadKeys = [
  "dispatchGroupId",
  "agentId",
  "agentName",
  "skillId",
  "sessionType",
  "trigger",
  "scheduleId",
  "scheduleRunId",
  "parentSessionId",
  "request",
  "followUps",
  "status",
  "issues",
  "startedAt",
  "completedAt",
  "conversationId",
  "summary",
  "error",
  "requestedWorkerId",
  "workerId",
  "events",
  "updatedAt",
] as const;

const sessionContextJson = (row: ProjectAgentSessionRow) => {
  const raw = parseJsonObject(row.payload_json) ?? {};
  const payload: Record<string, unknown> = {};
  for (const key of sessionPayloadKeys) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) payload[key] = raw[key];
  }
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
            session.session_type, session.payload_json, session.started_at,
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
  ).first<ProjectAgentSessionRow>();
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

export async function listOrganizationAgentContextSessionsPage(
  db: D1Database,
  archives: ArchiveBucket,
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
    select session.id
    from briar_project_agent_sessions session
    join briar_project_agent_session_context_membership membership
      on membership.project_id = session.project_id
     and membership.session_id = session.id
    where session.project_id = ? and membership.visible_at <= ?
      and exists (
        select 1 from briar_projects project
        where project.id = session.project_id and project.organization_id = ?
      )
    union
    select archive.scope_id as id
    from briar_log_archives archive
    join briar_project_agent_session_context_membership membership
      on membership.project_id = archive.project_id
     and membership.session_id = archive.scope_id
    where archive.project_id = ?
      and archive.archive_kind = 'project_agent_sessions'
      and archive.status in ('verified', 'complete')
      and membership.visible_at <= ?
      and exists (
        select 1 from briar_projects project
        where project.id = archive.project_id and project.organization_id = ?
      )`;
  const [count, result] = await Promise.all([
    db.prepare(
      `select count(*) as count from (${candidateSql}) candidates`,
    ).bind(
      input.projectId,
      input.snapshotAt,
      input.organizationId,
      input.projectId,
      input.snapshotAt,
      input.organizationId,
    ).first<{ count: number }>(),
    db.prepare(
      `select id from (${candidateSql}) candidates
       where id > ? order by id limit ?`,
    ).bind(
      input.projectId,
      input.snapshotAt,
      input.organizationId,
      input.projectId,
      input.snapshotAt,
      input.organizationId,
      cursor?.id ?? "",
      limit + 1,
    ).all<SessionKeyRow>(),
  ]);
  const hasMore = result.results.length > limit;
  const keys = result.results.slice(0, limit);
  const rows = await Promise.all(keys.map((key) =>
    getContextSession(db, archives, {
      projectId: input.projectId,
      sessionId: key.id,
      snapshotAt: input.snapshotAt,
    })
  ));
  const items = rows.map(sessionContextJson);
  return fitPageToByteBudget({
    base: {
      schemaVersion: 1 as const,
      organizationId: input.organizationId,
      workId: input.workId,
      resource: "agent-sessions" as const,
      projectId: input.projectId,
      snapshotAt: input.snapshotAt,
      total: count?.count ?? 0,
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
      id: keys[index].id,
    }),
  });
}
