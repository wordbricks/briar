import {
  type Timestamp,
  timestampDate,
  timestampFromDate,
} from "@bufbuild/protobuf/wkt";
import {
  type StructuredRunResult,
  StructuredRunResult_Impact,
  StructuredRunResult_Importance,
  StructuredRunResult_Outcome,
  StructuredRunResult_Urgency,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  AgentService,
  AgentSkillApprovalPolicy,
  AgentSkillExecutionMode,
  AgentSkillKind,
  type CreateOrganizationAgentRequest,
  type CreateProjectAgentRequest,
  ProjectAgentScheduleIntervalUnit as ProtoProjectAgentScheduleIntervalUnit,
  ProjectAgentScheduleNotificationLevel
    as ProtoProjectAgentScheduleNotificationLevel,
  ProjectAgentScheduleRecurrence as ProtoProjectAgentScheduleRecurrence,
  ProjectAgentScheduleRunStatus as ProtoProjectAgentScheduleRunStatus,
  type ProjectAgentScheduleWrite,
  type ProjectAgentSession,
  ProjectAgentSessionEventType,
  ProjectAgentSessionIssueOutcome,
  ProjectAgentSessionStatus,
  ProjectAgentSessionTrigger,
  ProjectAgentSessionType,
  type ProjectAgentSkillInput,
  type UpdateOrganizationAgentRequest,
  type UpdateProjectAgentRequest,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import {
  ProjectAgentWorkLogEntryStatus,
} from "@briar/contracts/gen/briar/app/v1/agent_transcript_pb";
import {
  AgentActivityKind,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import * as Schema from "effect/Schema";
import type { AgentProvider as DomainAgentProvider } from "../../src/lib/agent-provider";
import { getAgentSkill } from "./agent-skills";
import type { AgentWorkLogEntryRow } from "./agent-worklog";
import { getProjectAgentTranscriptApplication } from "./agent-transcript-application";
import {
  backfillArchivedProjectAgentSessionSummaries,
  getArchivedProjectAgentSession,
  listArchivedProjectAgentSessions,
} from "./archive";
import type { BriarAuth } from "./auth";
import { HttpError } from "./http-response";

import { appStructuredResult, appWorkflow } from "./app-connect-mappers";
import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import {
  createOrganizationAgent,
  deleteOrganizationAgent,
  listOrganizationAgents,
  updateOrganizationAgent,
} from "./organization-agents";
import { appOrganizationAgent } from "./app-connect-agent-mappers";
import {
  createProjectAgentApplication,
  deleteProjectAgentApplication,
  ProjectAgentApplicationError,
  updateProjectAgentApplication,
} from "./project-agent-application";
import { projectAgentJson } from "./project-agent-json";
import { getProjectAgent, listProjectAgents } from "./project-agent-repository";
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
import {
  claimProjectAgentScheduleRunApplication,
  completeProjectAgentScheduleRunApplication,
  createProjectAgentScheduleApplication,
  deleteProjectAgentScheduleApplication,
  listProjectAgentScheduleRunsApplication,
  listProjectAgentSchedulesApplication,
  ProjectAgentScheduleApplicationError,
  renewProjectAgentScheduleRunApplication,
  updateProjectAgentScheduleApplication,
} from "./project-agent-schedule-application";
import {
  projectAgentScheduleJson,
  projectAgentScheduleRunJson,
} from "./project-agent-schedule-json";
import { projectAgentTaskSessionEvent } from "./project-agent-task-session";
import {
  createProjectAgentTaskJob,
  getProjectAgentTaskJobByRequest,
} from "./project-agent-task-repository";
import { getProject } from "./project-command-repository";
import {
  decodeOrganizationAgentWrite,
  decodeProjectAgentInput,
  decodeProjectAgentScheduleInput,
  decodeProjectAgentSessionInput,
  decodeProjectAgentTaskInput,
} from "./project-request-contract";
import { decodeRequestSync } from "./request-schema";
import {
  scheduleProjectAgentSessionRealtimePublish,
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import { requireSession } from "./session-auth";
import { UuidString } from "./schema-codecs";
import { agentSkillExecutionApprovalTablesAvailable } from "./execution-approval-schema-repository";
import {
  executionWorkerProviders,
  isExecutionWorkerAllowedForProject,
  workerStateAt,
} from "./workers";
import {
  decodeProjectAgentScheduleRunCompletion,
  decodeProjectAgentScheduleRunRenew,
} from "./worker-request-contract";

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
  readonly getTranscript: typeof getProjectAgentTranscriptApplication;
};

const appConnectAgentServices: AppConnectAgentServices = {
  requireSession,
  getProject,
  backfillSessionSummaries: backfillArchivedProjectAgentSessionSummaries,
  getSessionCursor: getProjectAgentSessionSyncCursor,
  listSessionSummaries: listProjectAgentSessionSummaries,
  getTranscript: getProjectAgentTranscriptApplication,
};

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

const workLogEntryStatus = {
  writing: ProjectAgentWorkLogEntryStatus.WRITING,
  completed: ProjectAgentWorkLogEntryStatus.COMPLETED,
  failed: ProjectAgentWorkLogEntryStatus.FAILED,
  cancelled: ProjectAgentWorkLogEntryStatus.CANCELLED,
  interrupted: ProjectAgentWorkLogEntryStatus.INTERRUPTED,
} as const satisfies Record<
  AgentWorkLogEntryRow["status"],
  ProjectAgentWorkLogEntryStatus
>;

const workLogActivityKind = {
  command: AgentActivityKind.COMMAND,
  fileChange: AgentActivityKind.FILE_CHANGE,
  webSearch: AgentActivityKind.WEB_SEARCH,
  tool: AgentActivityKind.TOOL,
} as const satisfies Record<
  NonNullable<AgentWorkLogEntryRow["activity_kind"]>,
  AgentActivityKind
>;

const appWorkLogEntry = (entry: AgentWorkLogEntryRow) => ({
  entryId: entry.entry_id,
  sequence: BigInt(entry.sequence),
  updatedSequence: BigInt(entry.updated_sequence),
  status: workLogEntryStatus[entry.status],
  startedAt: requiredTimestamp(entry.started_at, "work-log startedAt"),
  updatedAt: requiredTimestamp(entry.updated_at, "work-log updatedAt"),
  completedAt: entry.completed_at
    ? requiredTimestamp(entry.completed_at, "work-log completedAt")
    : undefined,
  entry: entry.entry_type === "message"
    ? {
      case: "message" as const,
      value: {
        phase: entry.phase ?? undefined,
        text: entry.body,
      },
    }
    : {
      case: "activity" as const,
      value: {
        kind: workLogActivityKind[entry.activity_kind ?? "tool"],
        title: entry.title ?? "Use tool",
        text: entry.body,
      },
    },
});

const domainAgentProvider = (value: AgentProvider): DomainAgentProvider => {
  switch (value) {
    case AgentProvider.CODEX:
      return "codex";
    case AgentProvider.CLAUDE:
      return "claude";
    case AgentProvider.CURSOR:
      return "cursor";
    case AgentProvider.GROK:
      return "grok";
    case AgentProvider.AGY:
      return "agy";
    case AgentProvider.OPENCODE:
      return "opencode";
    case AgentProvider.OPENROUTER:
      return "openrouter";
    default:
      throw new ConnectError("provider is required", Code.InvalidArgument);
  }
};

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

const domainSkillKind = (value: AgentSkillKind) => {
  switch (value) {
    case AgentSkillKind.ISSUE_PROCESSING:
      return "issue_processing" as const;
    case AgentSkillKind.CUSTOM:
      return "custom" as const;
    default:
      throw new ConnectError("skill kind is required", Code.InvalidArgument);
  }
};

const domainExecutionMode = (value: AgentSkillExecutionMode | undefined) => {
  switch (value) {
    case undefined:
      return undefined;
    case AgentSkillExecutionMode.CONVERSATION:
      return "conversation" as const;
    case AgentSkillExecutionMode.TASK:
      return "task" as const;
    default:
      throw new ConnectError(
        "skill execution mode is invalid",
        Code.InvalidArgument,
      );
  }
};

const domainApprovalPolicy = (value: AgentSkillApprovalPolicy | undefined) => {
  switch (value) {
    case undefined:
      return undefined;
    case AgentSkillApprovalPolicy.INVOKE_IS_CONSENT:
      return "invoke_is_consent" as const;
    case AgentSkillApprovalPolicy.EXPLICIT:
      return "explicit" as const;
    default:
      throw new ConnectError(
        "skill approval policy is invalid",
        Code.InvalidArgument,
      );
  }
};

const domainSkillInput = (skill: ProjectAgentSkillInput) => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  body: skill.body,
  provider: domainAgentProvider(skill.provider),
  model: skill.model ?? null,
  effort: skill.effort ?? null,
  kind: domainSkillKind(skill.kind),
  executionMode: domainExecutionMode(skill.executionMode),
  approvalPolicy: domainApprovalPolicy(skill.approvalPolicy),
  position: skill.position,
});

const domainScheduleRecurrence = (
  value: ProtoProjectAgentScheduleRecurrence,
) => {
  switch (value) {
    case ProtoProjectAgentScheduleRecurrence.DAILY:
      return "daily" as const;
    case ProtoProjectAgentScheduleRecurrence.WEEKDAYS:
      return "weekdays" as const;
    case ProtoProjectAgentScheduleRecurrence.WEEKLY:
      return "weekly" as const;
    case ProtoProjectAgentScheduleRecurrence.INTERVAL:
      return "interval" as const;
    case ProtoProjectAgentScheduleRecurrence.CUSTOM:
      return "custom" as const;
    default:
      throw new ConnectError("recurrence is required", Code.InvalidArgument);
  }
};

const domainScheduleIntervalUnit = (
  value: ProtoProjectAgentScheduleIntervalUnit | undefined,
) => {
  switch (value) {
    case undefined:
      return undefined;
    case ProtoProjectAgentScheduleIntervalUnit.MINUTE:
      return "minute" as const;
    case ProtoProjectAgentScheduleIntervalUnit.HOUR:
      return "hour" as const;
    case ProtoProjectAgentScheduleIntervalUnit.DAY:
      return "day" as const;
    case ProtoProjectAgentScheduleIntervalUnit.WEEK:
      return "week" as const;
    default:
      throw new ConnectError("interval unit is invalid", Code.InvalidArgument);
  }
};

const domainScheduleNotificationLevel = (
  value: ProtoProjectAgentScheduleNotificationLevel | undefined,
) => {
  switch (value) {
    case undefined:
      return undefined;
    case ProtoProjectAgentScheduleNotificationLevel.IMPORTANT_UPDATES:
      return "important_updates" as const;
    case ProtoProjectAgentScheduleNotificationLevel.NONE:
      return "none" as const;
    default:
      throw new ConnectError(
        "notification level is invalid",
        Code.InvalidArgument,
      );
  }
};

const domainScheduleWrite = (write: ProjectAgentScheduleWrite | undefined) => {
  if (!write) {
    throw new ConnectError("schedule is required", Code.InvalidArgument);
  }
  return decodeProjectAgentScheduleInput({
    agentId: write.agentId,
    name: write.name,
    recurrence: domainScheduleRecurrence(write.recurrence),
    timeOfDay: write.timeOfDay,
    dayOfWeek: write.dayOfWeek ?? null,
    intervalValue: write.intervalValue,
    intervalUnit: domainScheduleIntervalUnit(write.intervalUnit),
    daysOfWeek: write.daysOfWeek,
    notificationLevel: domainScheduleNotificationLevel(write.notificationLevel),
    timeZone: write.timeZone,
  });
};

const domainStructuredOutcome = (value: StructuredRunResult_Outcome) => {
  switch (value) {
    case StructuredRunResult_Outcome.COMPLETED:
      return "completed" as const;
    case StructuredRunResult_Outcome.PARTIAL:
      return "partial" as const;
    case StructuredRunResult_Outcome.BLOCKED:
      return "blocked" as const;
    case StructuredRunResult_Outcome.FAILED:
      return "failed" as const;
    default:
      throw new ConnectError(
        "structured result outcome is required",
        Code.InvalidArgument,
      );
  }
};

const domainStructuredImportance = (value: StructuredRunResult_Importance) => {
  switch (value) {
    case StructuredRunResult_Importance.ROUTINE:
      return "routine" as const;
    case StructuredRunResult_Importance.IMPORTANT:
      return "important" as const;
    case StructuredRunResult_Importance.CRITICAL:
      return "critical" as const;
    default:
      throw new ConnectError(
        "structured result importance is required",
        Code.InvalidArgument,
      );
  }
};

const domainStructuredUrgency = (value: StructuredRunResult_Urgency) => {
  switch (value) {
    case StructuredRunResult_Urgency.NORMAL:
      return "normal" as const;
    case StructuredRunResult_Urgency.TIME_SENSITIVE:
      return "time_sensitive" as const;
    case StructuredRunResult_Urgency.IMMEDIATE:
      return "immediate" as const;
    default:
      throw new ConnectError(
        "structured result urgency is required",
        Code.InvalidArgument,
      );
  }
};

const domainStructuredImpact = (value: StructuredRunResult_Impact) => {
  switch (value) {
    case StructuredRunResult_Impact.ISSUE:
      return "issue" as const;
    case StructuredRunResult_Impact.PROJECT:
      return "project" as const;
    case StructuredRunResult_Impact.ORGANIZATION:
      return "organization" as const;
    default:
      throw new ConnectError(
        "structured result impact is required",
        Code.InvalidArgument,
      );
  }
};

const domainStructuredResult = (value: StructuredRunResult | undefined) => {
  if (!value) {
    throw new ConnectError(
      "structured result is required",
      Code.InvalidArgument,
    );
  }
  return {
    summary: value.summary,
    outcome: domainStructuredOutcome(value.outcome),
    importance: domainStructuredImportance(value.importance),
    urgency: domainStructuredUrgency(value.urgency),
    impact: domainStructuredImpact(value.impact),
    humanActionRequired: value.humanActionRequired,
    nextAction: value.nextAction ?? null,
    dueAt: optionalIsoTimestamp(value.dueAt),
  };
};

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
):
  | "started"
  | "completed"
  | "failed"
  | "skipped"
  | "interrupted"
  | "stopped" => {
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

const toSkill = (
  skill: ReturnType<typeof projectAgentJson>["skills"][number],
) => ({
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

const toProjectAgent = (row: Parameters<typeof projectAgentJson>[0]) => {
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

const scheduleRecurrence = {
  daily: ProtoProjectAgentScheduleRecurrence.DAILY,
  weekdays: ProtoProjectAgentScheduleRecurrence.WEEKDAYS,
  weekly: ProtoProjectAgentScheduleRecurrence.WEEKLY,
  interval: ProtoProjectAgentScheduleRecurrence.INTERVAL,
  custom: ProtoProjectAgentScheduleRecurrence.CUSTOM,
} as const;

const scheduleIntervalUnit = {
  minute: ProtoProjectAgentScheduleIntervalUnit.MINUTE,
  hour: ProtoProjectAgentScheduleIntervalUnit.HOUR,
  day: ProtoProjectAgentScheduleIntervalUnit.DAY,
  week: ProtoProjectAgentScheduleIntervalUnit.WEEK,
} as const;

const scheduleNotificationLevel = {
  important_updates:
    ProtoProjectAgentScheduleNotificationLevel.IMPORTANT_UPDATES,
  none: ProtoProjectAgentScheduleNotificationLevel.NONE,
} as const;

const scheduleRunStatus = {
  running: ProtoProjectAgentScheduleRunStatus.RUNNING,
  completed: ProtoProjectAgentScheduleRunStatus.COMPLETED,
  failed: ProtoProjectAgentScheduleRunStatus.FAILED,
} as const;

const toProjectAgentSchedule = (
  row: Awaited<ReturnType<typeof listProjectAgentSchedulesApplication>>[number],
) => {
  const schedule = projectAgentScheduleJson(row);
  return {
    id: schedule.id,
    projectId: schedule.projectId,
    agentId: schedule.agentId,
    agentName: schedule.agentName,
    agentProvider: agentProvider[schedule.agentProvider],
    name: schedule.name,
    recurrence: scheduleRecurrence[schedule.recurrence],
    timeOfDay: schedule.timeOfDay,
    dayOfWeek: schedule.dayOfWeek ?? undefined,
    intervalValue: schedule.intervalValue,
    intervalUnit: scheduleIntervalUnit[schedule.intervalUnit],
    daysOfWeek: schedule.daysOfWeek,
    notificationLevel: scheduleNotificationLevel[schedule.notificationLevel],
    timeZone: schedule.timeZone,
    enabled: schedule.enabled,
    createdAt: requiredTimestamp(schedule.createdAt, "Agent schedule creation"),
    updatedAt: requiredTimestamp(schedule.updatedAt, "Agent schedule update"),
  };
};

const toProjectAgentScheduleRun = (
  row: Awaited<
    ReturnType<typeof listProjectAgentScheduleRunsApplication>
  >[number],
) => {
  const scheduleRun = projectAgentScheduleRunJson(row);
  return {
    id: scheduleRun.id,
    projectId: scheduleRun.projectId,
    scheduleId: scheduleRun.scheduleId,
    scheduleName: scheduleRun.scheduleName,
    agent: {
      id: scheduleRun.agent.id,
      name: scheduleRun.agent.name,
      provider: agentProvider[scheduleRun.agent.provider],
      model: scheduleRun.agent.model ?? undefined,
      effort: scheduleRun.agent.effort ?? undefined,
      description: scheduleRun.agent.description || undefined,
      responsibility: scheduleRun.agent.responsibility,
      skill: scheduleRun.agent.skill,
      skills: scheduleRun.agent.skills.map(toSkill),
    },
    workflow: appWorkflow(scheduleRun.workflow),
    status: scheduleRunStatus[scheduleRun.status],
    scheduledFor: requiredTimestamp(
      scheduleRun.scheduledFor,
      "Agent schedule run",
    ),
    leaseExpiresAt: scheduleRun.leaseExpiresAt
      ? requiredTimestamp(
        scheduleRun.leaseExpiresAt,
        "Agent schedule run lease",
      )
      : undefined,
    startedAt: requiredTimestamp(
      scheduleRun.startedAt,
      "Agent schedule run start",
    ),
    completedAt: scheduleRun.completedAt
      ? requiredTimestamp(
        scheduleRun.completedAt,
        "Agent schedule run completion",
      )
      : undefined,
    resultSummary: scheduleRun.resultSummary ?? undefined,
    structuredResult: scheduleRun.structuredResult
      ? appStructuredResult(scheduleRun.structuredResult)
      : undefined,
    error: scheduleRun.error ?? undefined,
  };
};

const projectWrite = (input: CreateProjectAgentRequest) =>
  decodeProjectAgentInput({
    name: input.name ?? null,
    avatar: input.avatar ?? null,
    provider: domainAgentProvider(input.provider),
    model: input.model ?? null,
    effort: input.effort ?? null,
    designatedWorkerId: input.designatedWorkerId ?? null,
    description: input.description,
    responsibility: input.responsibility,
    skills: input.skills.map(domainSkillInput),
    calendarColor: input.calendarColor,
  });

const updateProjectWrite = (input: UpdateProjectAgentRequest) =>
  decodeProjectAgentInput({
    name: input.name ?? null,
    avatar: input.avatarUpdate.case === "avatar"
      ? input.avatarUpdate.value
      : input.avatarUpdate.case === "clearAvatar"
      ? null
      : undefined,
    codexPet: input.codexPetUpdate.case === "codexPet"
      ? { slug: input.codexPetUpdate.value.slug }
      : input.codexPetUpdate.case === "clearCodexPet"
      ? null
      : undefined,
    provider: domainAgentProvider(input.provider),
    model: input.model ?? null,
    effort: input.effortUpdate.case === "effort"
      ? input.effortUpdate.value
      : input.effortUpdate.case === "clearEffort"
      ? null
      : undefined,
    designatedWorkerId:
      input.designatedWorkerUpdate.case === "designatedWorkerId"
        ? input.designatedWorkerUpdate.value
        : input.designatedWorkerUpdate.case === "clearDesignatedWorker"
        ? null
        : undefined,
    description: input.description,
    responsibility: input.responsibility,
    skills: input.skills.map(domainSkillInput),
    calendarColor: input.calendarColor,
  });

const organizationWrite = (
  input: CreateOrganizationAgentRequest | UpdateOrganizationAgentRequest,
) =>
  decodeOrganizationAgentWrite({
    name: input.name,
    provider: domainAgentProvider(input.provider),
    model: input.model ?? null,
    description: input.description,
    responsibility: input.responsibility,
    effort: input.effort ?? null,
    skills: input.skills.map(domainSkillInput),
  });

const throwProjectAgentApplicationError = (error: unknown): never => {
  if (!(error instanceof ProjectAgentApplicationError)) throw error;
  switch (error.reason) {
    case "agent_not_found":
      throw new HttpError(404, error.message);
    case "designated_worker_invalid":
      throw new HttpError(400, error.message);
    case "agent_run_active":
    case "designated_worker_unavailable":
      throw new HttpError(409, error.message);
    case "codex_pet_download_failed":
      throw new HttpError(502, error.message);
  }
};

const throwScheduleApplicationError = (error: unknown): never => {
  if (!(error instanceof ProjectAgentScheduleApplicationError)) throw error;
  switch (error.reason) {
    case "agent_not_found":
    case "schedule_not_found":
      throw new HttpError(404, error.message);
    case "claim_inactive":
    case "schedule_run_active":
      throw new HttpError(409, error.message);
  }
};

const withProjectAgentApplicationErrors = async <A>(promise: Promise<A>) => {
  try {
    return await promise;
  } catch (error) {
    return throwProjectAgentApplicationError(error);
  }
};

const withScheduleApplicationErrors = async <A>(promise: Promise<A>) => {
  try {
    return await promise;
  } catch (error) {
    return throwScheduleApplicationError(error);
  }
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
const decodeScheduleClaimProjectIds = decodeRequestSync(
  Schema.mutable(Schema.Array(UuidString)).check(
    Schema.isLengthBetween(1, 100),
  ),
);
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
): ServiceImpl<typeof AgentService> => ({
  createOrganizationAgent: async (input) => {
    const session = await services.requireSession(auth, request);
    const organizationId = decodeUuid(input.organizationId);
    const role = await getOrganizationRole(
      db,
      organizationId,
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const write = organizationWrite(input);
    const agent = await createOrganizationAgent(db, {
      id: crypto.randomUUID(),
      organizationId,
      name: write.name,
      provider: write.provider,
      model: write.model,
      description: write.description ?? "",
      responsibility: write.responsibility,
      effort: write.effort,
      skills: write.skills ?? [],
      createdAt: new Date().toISOString(),
    });
    if (!agent) throw new HttpError(500, "Agent was not created");
    return { agent: appOrganizationAgent(agent) };
  },

  updateOrganizationAgent: async (input) => {
    const session = await services.requireSession(auth, request);
    const organizationId = decodeUuid(input.organizationId);
    const role = await getOrganizationRole(
      db,
      organizationId,
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const write = organizationWrite(input);
    const agent = await updateOrganizationAgent(db, {
      organizationId,
      agentId: decodeUuid(input.agentId),
      name: write.name,
      provider: write.provider,
      model: write.model,
      description: write.description,
      responsibility: write.responsibility,
      effort: write.effort,
      skills: write.skills,
      updatedAt: new Date().toISOString(),
    });
    if (!agent) throw new HttpError(404, "Organization agent not found");
    return { agent: appOrganizationAgent(agent) };
  },

  deleteOrganizationAgent: async (input) => {
    const session = await services.requireSession(auth, request);
    const organizationId = decodeUuid(input.organizationId);
    const role = await getOrganizationRole(
      db,
      organizationId,
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    const deleted = await deleteOrganizationAgent(
      db,
      organizationId,
      decodeUuid(input.agentId),
    );
    if (!deleted) throw new HttpError(404, "Organization agent not found");
    return { deleted: true };
  },

  listOrganizationAgents: async (input) => {
    const session = await services.requireSession(auth, request);
    const organizationId = decodeUuid(input.organizationId);
    const role = await getOrganizationRole(
      db,
      organizationId,
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    return {
      agents: (await listOrganizationAgents(db, organizationId)).map(
        appOrganizationAgent,
      ),
      canManage: hasOrganizationCapability(role, "development:manage"),
    };
  },

  createProjectAgent: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (
      !hasOrganizationCapability(project.member_role, "development:manage")
    ) {
      throw new HttpError(403, "Development management permission required");
    }
    const agent = await withProjectAgentApplicationErrors(
      createProjectAgentApplication({
        db,
        project,
        write: projectWrite(input),
      }),
    );
    scheduleProjectRealtimePublish(env, db, project.id, context);
    return { agent: toProjectAgent(agent) };
  },

  updateProjectAgent: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (
      !hasOrganizationCapability(project.member_role, "development:manage")
    ) {
      throw new HttpError(403, "Development management permission required");
    }
    const agent = await withProjectAgentApplicationErrors(
      updateProjectAgentApplication({
        db,
        attachmentsBucket: env.ATTACHMENTS,
        project,
        agentId: decodeUuid(input.agentId),
        write: updateProjectWrite(input),
      }),
    );
    scheduleProjectRealtimePublish(env, db, project.id, context);
    return { agent: toProjectAgent(agent) };
  },

  deleteProjectAgent: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (
      !hasOrganizationCapability(project.member_role, "development:manage")
    ) {
      throw new HttpError(403, "Development management permission required");
    }
    await withProjectAgentApplicationErrors(
      deleteProjectAgentApplication({
        db,
        attachmentsBucket: env.ATTACHMENTS,
        projectId: project.id,
        agentId: decodeUuid(input.agentId),
      }),
    );
    scheduleProjectRealtimePublish(env, db, project.id, context);
    return { deleted: true };
  },

  listProjectAgents: async (input) => {
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
  },

  listProjectAgentSchedules: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    return {
      schedules: (await listProjectAgentSchedulesApplication(db, project.id))
        .map(
          toProjectAgentSchedule,
        ),
    };
  },

  createProjectAgentSchedule: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (
      !hasOrganizationCapability(project.member_role, "development:manage")
    ) {
      throw new HttpError(403, "Development management permission required");
    }
    const schedule = await withScheduleApplicationErrors(
      createProjectAgentScheduleApplication({
        db,
        projectId: project.id,
        userId: session.user.id,
        write: domainScheduleWrite(input.schedule),
      }),
    );
    scheduleProjectRealtimePublish(env, db, project.id, context);
    return { schedule: toProjectAgentSchedule(schedule) };
  },

  updateProjectAgentSchedule: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (
      !hasOrganizationCapability(project.member_role, "development:manage")
    ) {
      throw new HttpError(403, "Development management permission required");
    }
    const schedule = await withScheduleApplicationErrors(
      updateProjectAgentScheduleApplication({
        db,
        projectId: project.id,
        scheduleId: decodeUuid(input.scheduleId),
        write: domainScheduleWrite(input.schedule),
      }),
    );
    scheduleProjectRealtimePublish(env, db, project.id, context);
    return { schedule: toProjectAgentSchedule(schedule) };
  },

  deleteProjectAgentSchedule: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (
      !hasOrganizationCapability(project.member_role, "development:manage")
    ) {
      throw new HttpError(403, "Development management permission required");
    }
    const deleted = await withScheduleApplicationErrors(
      deleteProjectAgentScheduleApplication({
        db,
        projectId: project.id,
        scheduleId: decodeUuid(input.scheduleId),
      }),
    );
    if (deleted) scheduleProjectRealtimePublish(env, db, project.id, context);
    return { deleted };
  },

  listProjectAgentScheduleRuns: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    return {
      runs: (await listProjectAgentScheduleRunsApplication(db, project.id))
        .map(
          toProjectAgentScheduleRun,
        ),
    };
  },

  claimProjectAgentScheduleRun: async (input) => {
    const session = await services.requireSession(auth, request);
    const projectIds = decodeScheduleClaimProjectIds(input.projectIds);
    const claimed = await claimProjectAgentScheduleRunApplication({
      db,
      userId: session.user.id,
      projectIds,
    });
    if (claimed) {
      scheduleProjectRealtimePublish(
        env,
        db,
        claimed.run.project_id,
        context,
      );
    }
    return {
      claimedRun: claimed
        ? {
          run: toProjectAgentScheduleRun(claimed.run),
          claimToken: claimed.claimToken,
        }
        : undefined,
    };
  },

  completeProjectAgentScheduleRun: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (
      !hasOrganizationCapability(project.member_role, "development:manage")
    ) {
      throw new HttpError(403, "Development management permission required");
    }
    const completion = input.outcome.case === "completed"
      ? decodeProjectAgentScheduleRunCompletion({
        claimToken: input.claimToken,
        status: "completed",
        resultSummary: input.outcome.value.resultSummary,
        structuredResult: domainStructuredResult(
          input.outcome.value.structuredResult,
        ),
        error: null,
      })
      : input.outcome.case === "failed"
      ? decodeProjectAgentScheduleRunCompletion({
        claimToken: input.claimToken,
        status: "failed",
        resultSummary: null,
        structuredResult: domainStructuredResult(
          input.outcome.value.structuredResult,
        ),
        error: input.outcome.value.error,
      })
      : (() => {
        throw new ConnectError("outcome is required", Code.InvalidArgument);
      })();
    const scheduleRun = await withScheduleApplicationErrors(
      completeProjectAgentScheduleRunApplication({
        db,
        projectId: project.id,
        runId: decodeUuid(input.runId),
        completion,
      }),
    );
    scheduleProjectRealtimePublish(env, db, project.id, context);
    return { run: toProjectAgentScheduleRun(scheduleRun) };
  },

  renewProjectAgentScheduleRun: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (
      !hasOrganizationCapability(project.member_role, "development:manage")
    ) {
      throw new HttpError(403, "Development management permission required");
    }
    const renew = decodeProjectAgentScheduleRunRenew({
      claimToken: input.claimToken,
    });
    const scheduleRun = await withScheduleApplicationErrors(
      renewProjectAgentScheduleRunApplication({
        db,
        projectId: project.id,
        runId: decodeUuid(input.runId),
        claimToken: renew.claimToken,
      }),
    );
    scheduleProjectRealtimePublish(env, db, project.id, context);
    return {
      leaseExpiresAt: requiredTimestamp(
        scheduleRun.lease_expires_at,
        "Agent schedule run lease",
      ),
    };
  },

  listProjectAgentSessions: async (input) => {
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
      .map((row) =>
        rowToProjectAgentSession(row, {
          archived: archivedSessions.some((archived) =>
            archived.id === row.id
          ) &&
            !hotSessions.some((hot) => hot.id === row.id),
        })
      );
    return { sessions };
  },

  syncProjectAgentSessions: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (input.cursor === undefined) {
      await services.backfillSessionSummaries(db, env.ARCHIVES, project.id);
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
    const changedSessionIds = [
      ...new Set(page.changes.map((change) => change.session_id)),
    ];
    const summaries = await services.listSessionSummaries(
      db,
      project.id,
      changedSessionIds,
    );
    const existingIds = new Set(
      summaries.map((summary) => summary.session_id),
    );
    return {
      cursor: BigInt(page.nextCursor),
      hasMore: page.hasMore,
      reset: false,
      sessions: summaries.map(summaryToProjectAgentSession),
      deletedSessionIds: changedSessionIds.filter((id) =>
        !existingIds.has(id)
      ),
    };
  },

  getProjectAgentSession: async (input) => {
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
  },

  getProjectAgentTranscript: async (input) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    const selector = input.selector.case === "sessionId"
      ? { sessionId: decodeSessionId(input.selector.value) }
      : input.selector.case === "latestForRunId"
        ? { latestForRunId: decodeUuid(input.selector.value) }
        : (() => {
          throw new ConnectError(
            "transcript selector is required",
            Code.InvalidArgument,
          );
        })();
    const workLog = await services.getTranscript({
      db,
      archives: env.ARCHIVES,
      projectId: project.id,
      selector,
    });
    return {
      session: {
        sessionId: workLog.session.session_id,
        runId: workLog.session.run_id ?? undefined,
        workerId: workLog.session.worker_id ?? undefined,
        agentProvider: agentProvider[workLog.session.agent_provider],
        startedAt: requiredTimestamp(
          workLog.session.started_at,
          "transcript startedAt",
        ),
        lastEventAt: requiredTimestamp(
          workLog.session.last_event_at,
          "transcript lastEventAt",
        ),
      },
      entries: workLog.entries.map(appWorkLogEntry),
    };
  },

  putProjectAgentSession: async (input) => {
    const sessionId = decodeSessionId(input.sessionId);
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      input.projectId,
      session.user.id,
      services.getProject,
    );
    if (
      !hasOrganizationCapability(project.member_role, "development:manage")
    ) {
      throw new HttpError(403, "Development management permission required");
    }
    if (
      (await agentSkillExecutionApprovalTablesAvailable(db)) &&
      (await projectAgentSessionIsApprovalOwned(db, project.id, sessionId))
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
        occurredAt: requiredIsoTimestamp(
          event.occurredAt,
          "events.occurred_at",
        ),
      })),
      updatedAt: requiredIsoTimestamp(input.updatedAt, "updated_at"),
    });
    const observedAt = new Date().toISOString();
    const existing =
      (await getProjectAgentSession(db, project.id, sessionId)) ??
        (await getArchivedProjectAgentSession(
          db,
          env.ARCHIVES,
          project.id,
          sessionId,
        ));
    let requestedByUserId: string | null;
    if (existing) {
      requestedByUserId = existing.requested_by_user_id;
    } else if (payload.parentSessionId) {
      const parent = (await getProjectAgentSession(
        db,
        project.id,
        payload.parentSessionId,
      )) ??
        (await getArchivedProjectAgentSession(
          db,
          env.ARCHIVES,
          project.id,
          payload.parentSessionId,
        ));
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
    const row = await upsertProjectAgentSession(
      db,
      {
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
      },
      observedAt,
    );
    if (!row) {
      throw new HttpError(409, "Agent session could not be synchronized");
    }
    scheduleProjectAgentSessionRealtimePublish(env, db, project.id, context);
    return { session: rowToProjectAgentSession(row) };
  },

  runProjectAgentTask: async (rawInput) => {
    const session = await services.requireSession(auth, request);
    const project = await requireProject(
      db,
      rawInput.projectId,
      session.user.id,
      services.getProject,
    );
    if (
      !hasOrganizationCapability(project.member_role, "development:manage")
    ) {
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
      if (!existingSession) {
        throw new HttpError(409, "Agent task session is missing");
      }
      return { session: rowToProjectAgentSession(existingSession) };
    }

    const agent = await getProjectAgent(db, project.id, input.agentId);
    if (!agent) {
      throw new HttpError(404, "Agent not found for this project");
    }
    const selectedSkill = await getAgentSkill(
      db,
      agent.id,
      input.skillId ?? null,
    );
    if (!selectedSkill) {
      throw new HttpError(404, "Agent Skill not found for this Agent");
    }
    const worker = await db
      .prepare(
        `select worker.*, device.max_concurrent_sessions
     from briar_execution_workers worker
     join briar_execution_worker_devices device on device.id = worker.device_id
     where worker.id = ? and worker.project_id = ?
       and device.organization_id = ?`,
      )
      .bind(input.workerId, project.id, project.organization_id)
      .first<{
        id: string;
        agent_provider: DomainAgentProvider;
        capabilities_json: string;
        state: "online" | "stale" | "disabled";
        accepting_work: number;
        readiness_state: "ready" | "busy" | "needs_attention";
        last_heartbeat_at: string;
        max_concurrent_sessions: number;
      }>();
    if (!worker) {
      throw new HttpError(404, "Worker not found for this project");
    }
    const observedAt = new Date().toISOString();
    if (
      workerStateAt(worker.last_heartbeat_at, observedAt, worker.state) !==
        "online" ||
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
    if (
      !(await isExecutionWorkerAllowedForProject(db, project.id, worker.id))
    ) {
      throw new HttpError(
        409,
        "Worker is not allowed by this project's execution policy",
      );
    }
    const active = await db
      .prepare(
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
      )
      .bind(worker.id, observedAt, worker.id, observedAt)
      .first<{ count: number }>();
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
      const message = error instanceof Error
        ? error.message.toLowerCase()
        : "";
      if (!message.includes("unique")) throw error;
      job = await getProjectAgentTaskJobByRequest(
        db,
        project.id,
        input.requestId,
      );
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
    const createdSession = await upsertProjectAgentSession(
      db,
      {
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
      },
      observedAt,
    );
    if (!createdSession) {
      throw new HttpError(409, "Agent task session could not be created");
    }
    scheduleProjectAgentSessionRealtimePublish(env, db, project.id, context);
    return { session: rowToProjectAgentSession(createdSession) };
  },
});

export function registerAppAgentService(
  router: ConnectRouter,
  input: AppConnectAgentInput,
  services: AppConnectAgentServices = appConnectAgentServices,
) {
  router.service(AgentService, createAppAgentService(input, services));
}

export { AgentService };
