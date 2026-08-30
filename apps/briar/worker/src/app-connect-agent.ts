import {
  timestampDate,
  timestampFromDate,
  type Timestamp,
} from "@bufbuild/protobuf/wkt";
import {
  AgentService,
  AgentSkillApprovalPolicy,
  AgentSkillExecutionMode,
  AgentSkillKind,
  ProjectAgentSessionEventType,
  ProjectAgentSessionIssueOutcome,
  ProjectAgentSessionStatus,
  ProjectAgentSessionTrigger,
  ProjectAgentSessionType,
  type ProjectAgentSession,
  type PutProjectAgentSessionRequest,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import * as Schema from "effect/Schema";
import type { AgentProvider as DomainAgentProvider } from "../../src/lib/agent-provider";
import { getAgentSkill } from "./agent-skills";
import {
  backfillArchivedProjectAgentSessionSummaries,
  getArchivedProjectAgentSession,
  listArchivedProjectAgentSessions,
} from "./archive";
import type { BriarAuth } from "./auth";
import { HttpError } from "./http-response";
import { withConnectErrors } from "./app-connect-errors";
import { hasOrganizationCapability } from "./organization-access";
import {
  getOrganizationRole,
} from "./organization-repository";
import {
  listOrganizationAgents,
  organizationAgentJson,
} from "./organization-agents";
import { projectAgentJson } from "./project-agent-json";
import {
  getProjectAgent,
  listProjectAgents,
} from "./project-agent-repository";
import {
  getProjectAgentSession,
  getProjectAgentSessionSyncCursor,
  listProjectAgentSessionChanges,
  listProjectAgentSessions,
  listProjectAgentSessionSummaries,
  projectAgentSessionIsApprovalOwned,
  upsertProjectAgentSession,
} from "./project-agent-session-repository";
import { getProjectAgentScheduleCreatorId } from "./project-agent-schedule-repository";
import { projectAgentTaskSessionEvent } from "./project-agent-task-session";
import {
  createProjectAgentTaskJob,
  getProjectAgentTaskJobByRequest,
} from "./project-agent-task-repository";
import { getProject } from "./project-command-repository";
import {
  decodeProjectAgentSessionInput,
  decodeProjectAgentTaskInput,
} from "./project-request-contract";
import { decodeRequestSync } from "./request-schema";
import {
  scheduleProjectAgentSessionRealtimePublish,
} from "./realtime-scheduling";
import { requireSession } from "./session-auth";
import { UuidString } from "./schema-codecs";
import { agentSkillExecutionApprovalTablesAvailable } from "./execution-approval-schema-repository";
import {
  executionWorkerProviders,
  isExecutionWorkerAllowedForProject,
  workerStateAt,
} from "./workers";

export type AppConnectAgentInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
};

export type AppConnectAgentServices = {
  readonly requireSession: typeof requireSession;
  readonly getProject: typeof getProject;
  readonly backfillSessionSummaries:
    typeof backfillArchivedProjectAgentSessionSummaries;
  readonly getSessionCursor: typeof getProjectAgentSessionSyncCursor;
  readonly listSessionSummaries: typeof listProjectAgentSessionSummaries;
};

const appConnectAgentServices: AppConnectAgentServices = {
  requireSession,
  getProject,
  backfillSessionSummaries: backfillArchivedProjectAgentSessionSummaries,
  getSessionCursor: getProjectAgentSessionSyncCursor,
  listSessionSummaries: listProjectAgentSessionSummaries,
};

const run = withConnectErrors;

const requiredTimestamp = (value: string, field: string): Timestamp => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ConnectError(`Invalid ${field} timestamp`, Code.Internal);
  }
  return timestampFromDate(date);
};

const requiredIsoTimestamp = (
  value: Timestamp | undefined,
  field: string,
): string => {
  if (!value) {
    throw new ConnectError(`${field} is required`, Code.InvalidArgument);
  }
  const date = timestampDate(value);
  if (Number.isNaN(date.getTime())) {
    throw new ConnectError(`${field} is invalid`, Code.InvalidArgument);
  }
  return date.toISOString();
};

const optionalIsoTimestamp = (value: Timestamp | undefined): string | null =>
  value ? requiredIsoTimestamp(value, "timestamp") : null;

const agentProvider = {
  codex: AgentProvider.CODEX,
  claude: AgentProvider.CLAUDE,
  cursor: AgentProvider.CURSOR,
  grok: AgentProvider.GROK,
  agy: AgentProvider.AGY,
  opencode: AgentProvider.OPENCODE,
  openrouter: AgentProvider.OPENROUTER,
} as const satisfies Record<DomainAgentProvider, AgentProvider>;

const skillKind = {
  issue_processing: AgentSkillKind.ISSUE_PROCESSING,
  custom: AgentSkillKind.CUSTOM,
} as const;

const executionMode = {
  conversation: AgentSkillExecutionMode.CONVERSATION,
  task: AgentSkillExecutionMode.TASK,
} as const;

const approvalPolicy = {
  invoke_is_consent: AgentSkillApprovalPolicy.INVOKE_IS_CONSENT,
  explicit: AgentSkillApprovalPolicy.EXPLICIT,
} as const;

const sessionType = {
  task: ProjectAgentSessionType.TASK,
  dispatch: ProjectAgentSessionType.DISPATCH,
} as const;

const sessionTrigger = {
  manual: ProjectAgentSessionTrigger.MANUAL,
  scheduled: ProjectAgentSessionTrigger.SCHEDULED,
} as const;

const sessionStatus = {
  running: ProjectAgentSessionStatus.RUNNING,
  completed: ProjectAgentSessionStatus.COMPLETED,
  failed: ProjectAgentSessionStatus.FAILED,
  skipped: ProjectAgentSessionStatus.SKIPPED,
  interrupted: ProjectAgentSessionStatus.INTERRUPTED,
} as const;

const sessionIssueOutcome = {
  pending: ProjectAgentSessionIssueOutcome.PENDING,
  completed: ProjectAgentSessionIssueOutcome.COMPLETED,
  blocked: ProjectAgentSessionIssueOutcome.BLOCKED,
  failed: ProjectAgentSessionIssueOutcome.FAILED,
  skipped: ProjectAgentSessionIssueOutcome.SKIPPED,
} as const;

const sessionEventType = {
  started: ProjectAgentSessionEventType.STARTED,
  completed: ProjectAgentSessionEventType.COMPLETED,
  failed: ProjectAgentSessionEventType.FAILED,
  skipped: ProjectAgentSessionEventType.SKIPPED,
  interrupted: ProjectAgentSessionEventType.INTERRUPTED,
  stopped: ProjectAgentSessionEventType.STOPPED,
} as const;

const domainSessionType = (
  value: ProjectAgentSessionType,
): "task" | "dispatch" => {
  switch (value) {
    case ProjectAgentSessionType.TASK:
      return "task";
    case ProjectAgentSessionType.DISPATCH:
      return "dispatch";
    default:
      throw new ConnectError("session_type is required", Code.InvalidArgument);
  }
};

const domainSessionTrigger = (
  value: ProjectAgentSessionTrigger | undefined,
): "manual" | "scheduled" | null => {
  switch (value) {
    case undefined:
      return null;
    case ProjectAgentSessionTrigger.MANUAL:
      return "manual";
    case ProjectAgentSessionTrigger.SCHEDULED:
      return "scheduled";
    default:
      throw new ConnectError("trigger is invalid", Code.InvalidArgument);
  }
};

const domainSessionStatus = (
  value: ProjectAgentSessionStatus,
): "running" | "completed" | "failed" | "skipped" | "interrupted" => {
  switch (value) {
    case ProjectAgentSessionStatus.RUNNING:
      return "running";
    case ProjectAgentSessionStatus.COMPLETED:
      return "completed";
    case ProjectAgentSessionStatus.FAILED:
      return "failed";
    case ProjectAgentSessionStatus.SKIPPED:
      return "skipped";
    case ProjectAgentSessionStatus.INTERRUPTED:
      return "interrupted";
    default:
      throw new ConnectError("status is required", Code.InvalidArgument);
  }
};

const domainSessionIssueOutcome = (
  value: ProjectAgentSessionIssueOutcome,
): "pending" | "completed" | "blocked" | "failed" | "skipped" => {
  switch (value) {
    case ProjectAgentSessionIssueOutcome.PENDING:
      return "pending";
    case ProjectAgentSessionIssueOutcome.COMPLETED:
      return "completed";
    case ProjectAgentSessionIssueOutcome.BLOCKED:
      return "blocked";
    case ProjectAgentSessionIssueOutcome.FAILED:
      return "failed";
    case ProjectAgentSessionIssueOutcome.SKIPPED:
      return "skipped";
    default:
      throw new ConnectError("issue outcome is required", Code.InvalidArgument);
  }
};

const domainSessionEventType = (
  value: ProjectAgentSessionEventType,
): "started" | "completed" | "failed" | "skipped" | "interrupted" | "stopped" => {
  switch (value) {
    case ProjectAgentSessionEventType.STARTED:
      return "started";
    case ProjectAgentSessionEventType.COMPLETED:
      return "completed";
    case ProjectAgentSessionEventType.FAILED:
      return "failed";
    case ProjectAgentSessionEventType.SKIPPED:
      return "skipped";
    case ProjectAgentSessionEventType.INTERRUPTED:
      return "interrupted";
    case ProjectAgentSessionEventType.STOPPED:
      return "stopped";
    default:
      throw new ConnectError("event type is required", Code.InvalidArgument);
  }
};

const toSkill = (skill: ReturnType<typeof projectAgentJson>["skills"][number]) => ({
  id: skill.id,
  agentId: skill.agentId,
  name: skill.name,
  description: skill.description,
  body: skill.body,
  provider: agentProvider[skill.provider],
  model: skill.model ?? undefined,
  effort: skill.effort ?? undefined,
  kind: skillKind[skill.kind],
  executionMode: executionMode[skill.executionMode],
  approvalPolicy: approvalPolicy[skill.approvalPolicy],
  position: skill.position,
  createdAt: requiredTimestamp(skill.createdAt, "Agent Skill creation"),
  updatedAt: requiredTimestamp(skill.updatedAt, "Agent Skill update"),
});

const toProjectAgent = (row: Awaited<ReturnType<typeof listProjectAgents>>[number]) => {
  const agent = projectAgentJson(row);
  return {
    id: agent.id,
    projectId: agent.projectId,
    name: agent.name,
    avatar: agent.avatar ?? undefined,
    codexPet: agent.codexPet
      ? {
          slug: agent.codexPet.slug,
          name: agent.codexPet.name,
          author: agent.codexPet.author ?? undefined,
          license: agent.codexPet.license ?? undefined,
          spriteVersion: agent.codexPet.spriteVersion,
          spriteSheetUrl: agent.codexPet.spriteSheetUrl ?? undefined,
        }
      : undefined,
    provider: agentProvider[agent.provider],
    model: agent.model ?? undefined,
    effort: agent.effort ?? undefined,
    designatedWorkerId: agent.designatedWorkerId ?? undefined,
    designatedWorkerLabel: agent.designatedWorkerLabel ?? undefined,
    description: agent.description || undefined,
    responsibility: agent.responsibility,
    skills: agent.skills.map(toSkill),
    calendarColor: agent.calendarColor,
    createdAt: requiredTimestamp(agent.createdAt, "Project Agent creation"),
    updatedAt: requiredTimestamp(agent.updatedAt, "Project Agent update"),
    skill: agent.skill,
  };
};

const toOrganizationAgent = (
  row: Awaited<ReturnType<typeof listOrganizationAgents>>[number],
) => {
  const agent = organizationAgentJson(row);
  return {
    agentId: agent.agentId,
    name: agent.name,
    avatar: agent.avatar ?? undefined,
    provider: agentProvider[agent.provider],
    model: agent.model ?? undefined,
    effort: agent.effort ?? undefined,
    projectId: agent.projectId ?? undefined,
    projectName: agent.projectName ?? undefined,
    description: agent.description || undefined,
    responsibility: agent.responsibility,
    skills: agent.skills.map(toSkill),
    createdAt: requiredTimestamp(agent.createdAt, "Organization Agent creation"),
  };
};

type DecodedSession = ReturnType<typeof decodeProjectAgentSessionInput>;

const toProjectAgentSession = (input: {
  id: string;
  projectId: string;
  requestedByUserId: string | null;
  payload: DecodedSession;
  archived?: boolean;
}): ProjectAgentSession => ({
  $typeName: "briar.app.v1.ProjectAgentSession",
  id: input.id,
  projectId: input.projectId,
  dispatchGroupId: input.payload.dispatchGroupId || undefined,
  agentId: input.payload.agentId ?? undefined,
  agentName: input.payload.agentName ?? undefined,
  skillId: input.payload.skillId ?? undefined,
  sessionType: sessionType[input.payload.sessionType],
  trigger: input.payload.trigger
    ? sessionTrigger[input.payload.trigger]
    : undefined,
  scheduleId: input.payload.scheduleId ?? undefined,
  scheduleRunId: input.payload.scheduleRunId ?? undefined,
  parentSessionId: input.payload.parentSessionId ?? undefined,
  request: input.payload.request ?? undefined,
  followUps: input.payload.followUps.map((followUp) => ({
    $typeName: "briar.app.v1.ProjectAgentSessionFollowUp",
    id: followUp.id,
    message: followUp.message,
    sentAt: requiredTimestamp(followUp.sentAt, "Agent session follow-up"),
  })),
  status: sessionStatus[input.payload.status],
  issues: input.payload.issues.map((issue) => ({
    $typeName: "briar.app.v1.ProjectAgentSessionIssue",
    runId: issue.runId,
    runNumber: issue.runNumber,
    sourceKey: issue.sourceKey,
    title: issue.title,
    outcome: sessionIssueOutcome[issue.outcome],
    summary: issue.summary ?? undefined,
  })),
  startedAt: requiredTimestamp(input.payload.startedAt, "Agent session start"),
  completedAt: input.payload.completedAt
    ? requiredTimestamp(input.payload.completedAt, "Agent session completion")
    : undefined,
  conversationId: input.payload.conversationId ?? undefined,
  requestedWorkerId: input.payload.requestedWorkerId ?? undefined,
  workerId: input.payload.workerId ?? undefined,
  requestedByUserId: input.requestedByUserId ?? undefined,
  summary: input.payload.summary ?? undefined,
  error: input.payload.error ?? undefined,
  events: input.payload.events.map((event) => ({
    $typeName: "briar.app.v1.ProjectAgentSessionEvent",
    id: event.id,
    type: sessionEventType[event.type],
    occurredAt: requiredTimestamp(event.occurredAt, "Agent session event"),
  })),
  updatedAt: requiredTimestamp(input.payload.updatedAt, "Agent session update"),
  archived: input.archived ?? false,
});

const rowToProjectAgentSession = (
  row: Awaited<ReturnType<typeof getProjectAgentSession>> extends infer R
    ? Exclude<R, null>
    : never,
  options: { archived?: boolean } = {},
) => {
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  // Requester identity is a server-owned projection. Older server-created
  // task payloads also carried the value inside payload_json.
  delete payload.requestedByUserId;
  return toProjectAgentSession({
    id: row.id,
    projectId: row.project_id,
    requestedByUserId: row.requested_by_user_id,
    payload: decodeProjectAgentSessionInput(payload),
    archived: options.archived,
  });
};

const summaryToProjectAgentSession = (
  row: Awaited<ReturnType<typeof listProjectAgentSessionSummaries>>[number],
) => {
  type StoredSessionSummary = {
    dispatchGroupId?: unknown;
    agentId?: unknown;
    agentName?: unknown;
    skillId?: unknown;
    sessionType?: unknown;
    trigger?: unknown;
    scheduleId?: unknown;
    scheduleRunId?: unknown;
    parentSessionId?: unknown;
    request?: unknown;
    status?: unknown;
    issues?: unknown;
    startedAt?: unknown;
    completedAt?: unknown;
    requestedWorkerId?: unknown;
    workerId?: unknown;
    updatedAt?: unknown;
    requestedByUserId?: unknown;
  };
  const stored = JSON.parse(row.summary_json) as StoredSessionSummary;
  // Apply the public summary defaults while passing only canonical session
  // input fields through strict decode.
  const payload = decodeProjectAgentSessionInput({
    dispatchGroupId: stored.dispatchGroupId,
    agentId: stored.agentId ?? null,
    agentName: stored.agentName ?? null,
    skillId: stored.skillId ?? null,
    sessionType: stored.sessionType,
    trigger: stored.trigger ?? null,
    scheduleId: stored.scheduleId ?? null,
    scheduleRunId: stored.scheduleRunId ?? null,
    parentSessionId: stored.parentSessionId ?? null,
    request: stored.request ?? null,
    followUps: [],
    status: stored.status,
    issues: stored.issues,
    startedAt: stored.startedAt,
    completedAt: stored.completedAt ?? null,
    conversationId: null,
    summary: null,
    error: null,
    requestedWorkerId: stored.requestedWorkerId ?? null,
    workerId: stored.workerId ?? null,
    events: [],
    updatedAt: stored.updatedAt,
  });
  return toProjectAgentSession({
    id: row.session_id,
    projectId: row.project_id,
    requestedByUserId: typeof stored.requestedByUserId === "string"
      ? stored.requestedByUserId
      : null,
    payload,
    archived: row.archived === 1,
  });
};

const requireProject = async (
  db: D1Database,
  projectId: string,
  userId: string,
  loadProject: typeof getProject,
) => {
  const project = await loadProject(
    db,
    decodeRequestSync(UuidString)(projectId),
    userId,
  );
  if (!project) throw new HttpError(404, "Project not found");
  return project;
};

const safeCursor = (cursor: bigint): number => {
  if (cursor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ConnectError(
      "Agent session cursor is outside the safe range",
      Code.InvalidArgument,
    );
  }
  return Number(cursor);
};

const decodeUuid = decodeRequestSync(UuidString);
const decodeSessionId = decodeRequestSync(
  Schema.String.check(
    Schema.isLengthBetween(1, 128),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/u),
  ),
);

/** Generated Connect implementation for the app AgentService. */
export const createAppAgentService = (
  { request, auth, db, env, context }: AppConnectAgentInput,
  services: AppConnectAgentServices = appConnectAgentServices,
) => ({
  listOrganizationAgents: (input: { organizationId: string }) => run(async () => {
    const session = await services.requireSession(auth, request);
    const organizationId = decodeUuid(input.organizationId);
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    return {
      agents: (await listOrganizationAgents(db, organizationId)).map(
        toOrganizationAgent,
      ),
      canManage: hasOrganizationCapability(role, "development:manage"),
    };
  }),

  listProjectAgents: (input: { projectId: string }) => run(async () => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    return {
      agents: (await listProjectAgents(db, project.id)).map(toProjectAgent),
    };
  }),

  listProjectAgentSessions: (input: { projectId: string }) => run(async () => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    const [hotSessions, archivedSessions] = await Promise.all([
      listProjectAgentSessions(db, project.id),
      listArchivedProjectAgentSessions(db, env.ARCHIVES, project.id),
    ]);
    const sessions = [
      ...new Map(
        [...archivedSessions, ...hotSessions].map((item) => [item.id, item]),
      ).values(),
    ]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 200)
      .map((row) => rowToProjectAgentSession(row, {
        archived: archivedSessions.some((archived) => archived.id === row.id) &&
          !hotSessions.some((hot) => hot.id === row.id),
      }));
    return { sessions };
  }),

  syncProjectAgentSessions: (input: {
    projectId: string;
    cursor?: bigint;
  }) => run(async () => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (input.cursor === undefined) {
      await services.backfillSessionSummaries(
        db,
        env.ARCHIVES,
        project.id,
      );
      const [cursor, summaries] = await Promise.all([
        services.getSessionCursor(db, project.id),
        services.listSessionSummaries(db, project.id),
      ]);
      return {
        cursor: BigInt(cursor),
        hasMore: false,
        reset: true,
        sessions: summaries.map(summaryToProjectAgentSession),
        deletedSessionIds: [],
      };
    }

    const page = await listProjectAgentSessionChanges(
      db,
      project.id,
      safeCursor(input.cursor),
    );
    if (page.expired) {
      throw new ConnectError(
        "Agent session cursor expired; reload the summary snapshot",
        Code.OutOfRange,
      );
    }
    const changedSessionIds = [...new Set(
      page.changes.map((change) => change.session_id),
    )];
    const summaries = await services.listSessionSummaries(
      db,
      project.id,
      changedSessionIds,
    );
    const existingIds = new Set(summaries.map((summary) => summary.session_id));
    return {
      cursor: BigInt(page.nextCursor),
      hasMore: page.hasMore,
      reset: false,
      sessions: summaries.map(summaryToProjectAgentSession),
      deletedSessionIds: changedSessionIds.filter((id) => !existingIds.has(id)),
    };
  }),

  getProjectAgentSession: (input: {
    projectId: string;
    sessionId: string;
  }) => run(async () => {
    const sessionId = decodeSessionId(input.sessionId);
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    const hot = await getProjectAgentSession(db, project.id, sessionId);
    if (hot) return { session: rowToProjectAgentSession(hot) };
    const archived = await getArchivedProjectAgentSession(
      db,
      env.ARCHIVES,
      project.id,
      sessionId,
    );
    if (!archived) throw new HttpError(404, "Agent session not found");
    return {
      session: rowToProjectAgentSession(archived, { archived: true }),
    };
  }),

  putProjectAgentSession: (input: PutProjectAgentSessionRequest) => run(async () => {
    const sessionId = decodeSessionId(input.sessionId);
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    if (
      await agentSkillExecutionApprovalTablesAvailable(db) &&
      await projectAgentSessionIsApprovalOwned(db, project.id, sessionId)
    ) {
      throw new HttpError(
        409,
        "Approved Agent Skill execution sessions are updated by their assigned Worker",
        "AGENT_SKILL_EXECUTION_SESSION_SERVER_OWNED",
      );
    }

    const payload = decodeProjectAgentSessionInput({
      dispatchGroupId: input.dispatchGroupId,
      agentId: input.agentId ?? null,
      agentName: input.agentName ?? null,
      skillId: input.skillId ?? null,
      sessionType: domainSessionType(input.sessionType),
      trigger: domainSessionTrigger(input.trigger),
      scheduleId: input.scheduleId ?? null,
      scheduleRunId: input.scheduleRunId ?? null,
      parentSessionId: input.parentSessionId ?? null,
      request: input.request ?? null,
      followUps: input.followUps.map((followUp) => ({
        id: followUp.id,
        message: followUp.message,
        sentAt: requiredIsoTimestamp(followUp.sentAt, "follow_ups.sent_at"),
      })),
      status: domainSessionStatus(input.status),
      issues: input.issues.map((issue) => ({
        runId: issue.runId,
        runNumber: issue.runNumber,
        sourceKey: issue.sourceKey,
        title: issue.title,
        outcome: domainSessionIssueOutcome(issue.outcome),
        summary: issue.summary ?? null,
      })),
      startedAt: requiredIsoTimestamp(input.startedAt, "started_at"),
      completedAt: optionalIsoTimestamp(input.completedAt),
      conversationId: input.conversationId ?? null,
      summary: input.summary ?? null,
      error: input.error ?? null,
      requestedWorkerId: input.requestedWorkerId ?? null,
      workerId: input.workerId ?? null,
      events: input.events.map((event) => ({
        id: event.id,
        type: domainSessionEventType(event.type),
        occurredAt: requiredIsoTimestamp(event.occurredAt, "events.occurred_at"),
      })),
      updatedAt: requiredIsoTimestamp(input.updatedAt, "updated_at"),
    });
    const observedAt = new Date().toISOString();
    const existing = await getProjectAgentSession(db, project.id, sessionId) ??
      await getArchivedProjectAgentSession(
        db,
        env.ARCHIVES,
        project.id,
        sessionId,
      );
    let requestedByUserId: string | null;
    if (existing) {
      requestedByUserId = existing.requested_by_user_id;
    } else if (payload.parentSessionId) {
      const parent = await getProjectAgentSession(
        db,
        project.id,
        payload.parentSessionId,
      ) ?? await getArchivedProjectAgentSession(
        db,
        env.ARCHIVES,
        project.id,
        payload.parentSessionId,
      );
      requestedByUserId = parent?.requested_by_user_id ?? null;
    } else if (payload.trigger === "scheduled" && payload.scheduleId) {
      requestedByUserId = await getProjectAgentScheduleCreatorId(
        db,
        project.id,
        payload.scheduleId,
      );
    } else {
      requestedByUserId = session.user.id;
    }
    const row = await upsertProjectAgentSession(db, {
      project_id: project.id,
      id: sessionId,
      agent_id: payload.agentId,
      requested_by_user_id: requestedByUserId,
      status: payload.status,
      session_type: payload.sessionType,
      payload_json: JSON.stringify(payload),
      started_at: payload.startedAt,
      completed_at: payload.completedAt,
      updated_at: payload.updatedAt,
    }, observedAt);
    if (!row) throw new HttpError(409, "Agent session could not be synchronized");
    scheduleProjectAgentSessionRealtimePublish(env, db, project.id, context);
    return { session: rowToProjectAgentSession(row) };
  }),

  runProjectAgentTask: (rawInput: {
    projectId: string;
    agentId: string;
    skillId: string;
    request: string;
    workerId: string;
    requestId: string;
  }) => run(async () => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      rawInput.projectId,
      session.user.id,
      services.getProject,
    );
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const input = decodeProjectAgentTaskInput({
      agentId: rawInput.agentId,
      skillId: rawInput.skillId || null,
      request: rawInput.request,
      workerId: rawInput.workerId,
      requestId: rawInput.requestId,
    });
    const existingJob = await getProjectAgentTaskJobByRequest(
      db,
      project.id,
      input.requestId,
    );
    if (existingJob) {
      const existingSession = await getProjectAgentSession(
        db,
        project.id,
        existingJob.id,
      );
      if (!existingSession) throw new HttpError(409, "Agent task session is missing");
      return { session: rowToProjectAgentSession(existingSession) };
    }

    const agent = await getProjectAgent(db, project.id, input.agentId);
    if (!agent) throw new HttpError(404, "Agent not found for this project");
    const selectedSkill = await getAgentSkill(db, agent.id, input.skillId ?? null);
    if (!selectedSkill) throw new HttpError(404, "Agent Skill not found for this Agent");
    const worker = await db.prepare(
      `select worker.*, device.max_concurrent_sessions
       from briar_execution_workers worker
       join briar_execution_worker_devices device on device.id = worker.device_id
       where worker.id = ? and worker.project_id = ?
         and device.organization_id = ?`,
    ).bind(input.workerId, project.id, project.organization_id).first<{
      id: string;
      agent_provider: DomainAgentProvider;
      capabilities_json: string;
      state: "online" | "stale" | "disabled";
      accepting_work: number;
      readiness_state: "ready" | "busy" | "needs_attention";
      last_heartbeat_at: string;
      max_concurrent_sessions: number;
    }>();
    if (!worker) throw new HttpError(404, "Worker not found for this project");
    const observedAt = new Date().toISOString();
    if (
      workerStateAt(worker.last_heartbeat_at, observedAt, worker.state) !== "online" ||
      worker.accepting_work !== 1 ||
      worker.readiness_state === "needs_attention"
    ) {
      throw new HttpError(409, "Worker is not ready to accept agent tasks");
    }
    if (!executionWorkerProviders(worker).includes(selectedSkill.provider)) {
      throw new HttpError(
        409,
        `Worker does not support the ${selectedSkill.provider} provider`,
      );
    }
    if (!(await isExecutionWorkerAllowedForProject(db, project.id, worker.id))) {
      throw new HttpError(
        409,
        "Worker is not allowed by this project's execution policy",
      );
    }
    const active = await db.prepare(
      `select
         (select count(*)
          from briar_hunt_runs run
          where run.worker_id = ? and run.claim_token_hash is not null
            and run.lease_expires_at > ?
            and run.status not in ('backlog', 'completed', 'cancelled', 'blocked', 'failed'))
         +
         (select count(*)
          from briar_project_agent_task_jobs task
          where task.claimed_worker_id = ? and task.status = 'running'
            and task.lease_expires_at > ?) as count`,
    ).bind(worker.id, observedAt, worker.id, observedAt).first<{ count: number }>();
    if ((active?.count ?? 0) >= worker.max_concurrent_sessions) {
      throw new HttpError(409, "Worker has no available execution slot");
    }

    const taskId = crypto.randomUUID();
    let job;
    try {
      job = await createProjectAgentTaskJob(db, {
        id: taskId,
        projectId: project.id,
        agentId: agent.id,
        skill: selectedSkill,
        request: input.request,
        requestId: input.requestId,
        workerId: worker.id,
        createdAt: observedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (!message.includes("unique")) throw error;
      job = await getProjectAgentTaskJobByRequest(db, project.id, input.requestId);
    }
    if (!job) throw new HttpError(409, "Agent task could not be queued");
    const payload = decodeProjectAgentSessionInput({
      dispatchGroupId: taskId,
      agentId: agent.id,
      agentName: agent.name,
      skillId: selectedSkill.id,
      sessionType: "task",
      trigger: "manual",
      scheduleId: null,
      scheduleRunId: null,
      parentSessionId: null,
      request: input.request,
      followUps: [],
      status: "running",
      issues: [],
      startedAt: observedAt,
      completedAt: null,
      conversationId: null,
      requestedWorkerId: worker.id,
      workerId: worker.id,
      summary: null,
      error: null,
      events: [projectAgentTaskSessionEvent("started", observedAt)],
      updatedAt: observedAt,
    });
    const createdSession = await upsertProjectAgentSession(db, {
      project_id: project.id,
      id: taskId,
      agent_id: agent.id,
      requested_by_user_id: session.user.id,
      status: "running",
      session_type: "task",
      payload_json: JSON.stringify(payload),
      started_at: observedAt,
      completed_at: null,
      updated_at: observedAt,
    }, observedAt);
    if (!createdSession) {
      throw new HttpError(409, "Agent task session could not be created");
    }
    scheduleProjectAgentSessionRealtimePublish(env, db, project.id, context);
    return { session: rowToProjectAgentSession(createdSession) };
  }),
});

export function registerAppAgentService(
  router: ConnectRouter,
  input: AppConnectAgentInput,
  services: AppConnectAgentServices = appConnectAgentServices,
) {
  router.service(AgentService, createAppAgentService(input, services));
}

export { AgentService };
