import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import {
  AgentService,
  AgentSkillApprovalPolicy as ProtoAgentSkillApprovalPolicy,
  AgentSkillExecutionMode as ProtoAgentSkillExecutionMode,
  AgentSkillKind as ProtoAgentSkillKind,
  ProjectAgentScheduleIntervalUnit as ProtoProjectAgentScheduleIntervalUnit,
  ProjectAgentScheduleNotificationLevel as ProtoProjectAgentScheduleNotificationLevel,
  ProjectAgentScheduleRecurrence as ProtoProjectAgentScheduleRecurrence,
  ProjectAgentScheduleRunStatus as ProtoProjectAgentScheduleRunStatus,
  ProjectAgentSessionEventType as ProtoProjectAgentSessionEventType,
  ProjectAgentSessionIssueOutcome as ProtoProjectAgentSessionIssueOutcome,
  ProjectAgentSessionStatus as ProtoProjectAgentSessionStatus,
  ProjectAgentSessionTrigger as ProtoProjectAgentSessionTrigger,
  ProjectAgentSessionType as ProtoProjectAgentSessionType,
  type OrganizationAgent as OrganizationAgentMessage,
  type ProjectAgent as ProjectAgentMessage,
  type ProjectAgentSchedule as ProjectAgentScheduleMessage,
  type ProjectAgentScheduleRun as ProjectAgentScheduleRunMessage,
  type ProjectAgentSession as ProjectAgentSessionMessage,
  type ProjectAgentSkill as ProjectAgentSkillMessage,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import { ComputerUsePolicy as ProtoComputerUsePolicy } from "@briar/contracts/gen/briar/types/v1/computer_use_pb";
import type { GetProjectAgentTranscriptRequest } from "@briar/contracts/gen/briar/app/v1/agent_transcript_pb";
import type {
  AutoHuntSession,
  AutoHuntSessionEventType,
  AutoHuntSessionIssueOutcome,
} from "../../hooks/useAutoHuntSessions";
import type { ChannelAgentSummary, ChannelAgentSkillInput } from "../channels-contract";
import type { AgentProvider } from "../agent-provider";
import type { ModelEffort } from "../agent-provider-contract";
import type { StructuredAgentResult } from "../agent-result";
import type {
  ClaimedProjectAgentScheduleRun,
  CreateProjectAgentInput,
  CreateProjectAgentScheduleInput,
  ProjectAgent,
  ProjectAgentSchedule,
  ProjectAgentScheduleRun,
  ProjectAgentSkill,
  ProjectAgentSkillApprovalPolicy,
  ProjectAgentSkillExecutionMode,
  ProjectAgentSkillKind,
  UpdateProjectAgentInput,
  UpdateProjectAgentScheduleInput,
} from "../../types";
import { isApiErrorStatus } from "../api/errors";
import { appCallOptions, appTransport } from "./core";
import {
  agentProviderFromProto,
  agentProviderToProto,
  optionalTimestamp,
  requiredMessage,
  requiredTimestamp,
  safeNumber,
  structuredResultFromProto,
  structuredResultToProto,
} from "./mappers";
import { workflowFromProto } from "./project-configuration-mappers";

const agentClient = appTransport ? createClient(AgentService, appTransport) : undefined;

const requireAgentClient = () => {
  if (!agentClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return agentClient;
};

const computerUsePolicyFromProto = (
  value: ProtoComputerUsePolicy,
): "disabled" | "unattended" =>
  value === ProtoComputerUsePolicy.UNATTENDED ? "unattended" : "disabled";

const computerUsePolicyToProto = (
  value: "disabled" | "unattended",
): ProtoComputerUsePolicy =>
  value === "unattended"
    ? ProtoComputerUsePolicy.UNATTENDED
    : ProtoComputerUsePolicy.DISABLED;

export const skillKindFromProto = (value: ProtoAgentSkillKind): ProjectAgentSkillKind => {
  switch (value) {
    case ProtoAgentSkillKind.ISSUE_PROCESSING:
      return "issue_processing";
    case ProtoAgentSkillKind.CUSTOM:
      return "custom";
    default:
      throw new Error(`Unknown Agent Skill kind: ${value}`);
  }
};

export const skillExecutionModeFromProto = (
  value: ProtoAgentSkillExecutionMode,
): ProjectAgentSkillExecutionMode => {
  switch (value) {
    case ProtoAgentSkillExecutionMode.CONVERSATION:
      return "conversation";
    case ProtoAgentSkillExecutionMode.TASK:
      return "task";
    default:
      throw new Error(`Unknown Agent Skill execution mode: ${value}`);
  }
};

export const skillApprovalPolicyFromProto = (
  value: ProtoAgentSkillApprovalPolicy,
): ProjectAgentSkillApprovalPolicy => {
  switch (value) {
    case ProtoAgentSkillApprovalPolicy.INVOKE_IS_CONSENT:
      return "invoke_is_consent";
    case ProtoAgentSkillApprovalPolicy.EXPLICIT:
      return "explicit";
    default:
      throw new Error(`Unknown Agent Skill approval policy: ${value}`);
  }
};

export const projectAgentSkillFromMessage = (
  skill: ProjectAgentSkillMessage,
): ProjectAgentSkill => ({
  id: skill.id,
  agentId: skill.agentId,
  name: skill.name,
  description: skill.description,
  body: skill.body,
  provider: agentProviderFromProto(skill.provider),
  model: skill.model ?? null,
  effort: skill.effort ?? null,
  kind: skillKindFromProto(skill.kind),
  executionMode: skillExecutionModeFromProto(skill.executionMode),
  approvalPolicy: skillApprovalPolicyFromProto(skill.approvalPolicy),
  position: skill.position,
  createdAt: requiredTimestamp(skill.createdAt, "agentSkill.createdAt"),
  updatedAt: requiredTimestamp(skill.updatedAt, "agentSkill.updatedAt"),
});

const codexPetSpriteVersion = (value: number | undefined): 1 | 2 => {
  switch (value) {
    case 1:
      return 1;
    case 2:
      return 2;
    default:
      throw new Error(`Unknown Codex Pet sprite version: ${value}`);
  }
};

export const projectAgentFromMessage = (agent: ProjectAgentMessage): ProjectAgent => ({
  id: agent.id,
  projectId: agent.projectId,
  name: agent.name,
  avatar: agent.avatar ?? null,
  codexPet:
    agent.codexPet === undefined
      ? null
      : {
          slug: agent.codexPet.slug,
          name: agent.codexPet.name,
          author: requiredMessage(agent.codexPet.author, "projectAgent.codexPet.author"),
          license: requiredMessage(agent.codexPet.license, "projectAgent.codexPet.license"),
          spriteVersion: codexPetSpriteVersion(agent.codexPet.spriteVersion),
          spriteSheetUrl: agent.codexPet.spriteSheetUrl ?? null,
        },
  provider: agentProviderFromProto(agent.provider),
  model: agent.model ?? null,
  effort: agent.effort ?? null,
  computerUsePolicy: computerUsePolicyFromProto(agent.computerUsePolicy),
  designatedWorkerId: agent.designatedWorkerId ?? null,
  designatedWorkerLabel: agent.designatedWorkerLabel ?? null,
  description: agent.description ?? "",
  responsibility: agent.responsibility,
  skill: agent.skill,
  skills: agent.skills.map(projectAgentSkillFromMessage),
  calendarColor: agent.calendarColor,
  createdAt: requiredTimestamp(agent.createdAt, "projectAgent.createdAt"),
  updatedAt: requiredTimestamp(agent.updatedAt, "projectAgent.updatedAt"),
});

export const organizationAgentFromMessage = (
  agent: OrganizationAgentMessage,
): ChannelAgentSummary => ({
  agentId: agent.agentId,
  name: agent.name,
  description: agent.description,
  avatar: agent.avatar ?? null,
  provider: agentProviderFromProto(agent.provider),
  model: agent.model ?? null,
  effort: agent.effort ?? null,
  computerUsePolicy: computerUsePolicyFromProto(agent.computerUsePolicy),
  projectId: agent.projectId ?? null,
  projectName: agent.projectName ?? null,
  responsibility: agent.responsibility,
  skills: agent.skills.map(projectAgentSkillFromMessage),
  createdAt: requiredTimestamp(agent.createdAt, "organizationAgent.createdAt"),
});

const sessionTypeFromProto = (
  value: ProtoProjectAgentSessionType,
): AutoHuntSession["sessionType"] => {
  switch (value) {
    case ProtoProjectAgentSessionType.TASK:
      return "task";
    case ProtoProjectAgentSessionType.DISPATCH:
      return "dispatch";
    default:
      throw new Error(`Unknown Agent session type: ${value}`);
  }
};

const sessionTriggerFromProto = (
  value: ProtoProjectAgentSessionTrigger | undefined,
): AutoHuntSession["trigger"] => {
  switch (value) {
    case undefined:
      return undefined;
    case ProtoProjectAgentSessionTrigger.MANUAL:
      return "manual";
    case ProtoProjectAgentSessionTrigger.SCHEDULED:
      return "scheduled";
    default:
      throw new Error(`Unknown Agent session trigger: ${value}`);
  }
};

const sessionStatusFromProto = (
  value: ProtoProjectAgentSessionStatus,
): AutoHuntSession["status"] => {
  switch (value) {
    case ProtoProjectAgentSessionStatus.RUNNING:
      return "running";
    case ProtoProjectAgentSessionStatus.COMPLETED:
      return "completed";
    case ProtoProjectAgentSessionStatus.FAILED:
      return "failed";
    case ProtoProjectAgentSessionStatus.SKIPPED:
      return "skipped";
    case ProtoProjectAgentSessionStatus.INTERRUPTED:
      return "interrupted";
    default:
      throw new Error(`Unknown Agent session status: ${value}`);
  }
};

const sessionIssueOutcomeFromProto = (
  value: ProtoProjectAgentSessionIssueOutcome,
): AutoHuntSessionIssueOutcome => {
  switch (value) {
    case ProtoProjectAgentSessionIssueOutcome.PENDING:
      return "pending";
    case ProtoProjectAgentSessionIssueOutcome.COMPLETED:
      return "completed";
    case ProtoProjectAgentSessionIssueOutcome.BLOCKED:
      return "blocked";
    case ProtoProjectAgentSessionIssueOutcome.FAILED:
      return "failed";
    case ProtoProjectAgentSessionIssueOutcome.SKIPPED:
      return "skipped";
    default:
      throw new Error(`Unknown Agent session issue outcome: ${value}`);
  }
};

const sessionEventTypeFromProto = (
  value: ProtoProjectAgentSessionEventType,
): AutoHuntSessionEventType => {
  switch (value) {
    case ProtoProjectAgentSessionEventType.STARTED:
      return "started";
    case ProtoProjectAgentSessionEventType.COMPLETED:
      return "completed";
    case ProtoProjectAgentSessionEventType.FAILED:
      return "failed";
    case ProtoProjectAgentSessionEventType.SKIPPED:
      return "skipped";
    case ProtoProjectAgentSessionEventType.INTERRUPTED:
      return "interrupted";
    case ProtoProjectAgentSessionEventType.STOPPED:
      return "stopped";
    default:
      throw new Error(`Unknown Agent session event type: ${value}`);
  }
};

export const projectAgentSessionFromMessage = (
  session: ProjectAgentSessionMessage,
  detailLoaded: boolean,
): AutoHuntSession => ({
  id: session.id,
  projectId: session.projectId,
  dispatchGroupId: session.dispatchGroupId,
  agentId: session.agentId,
  agentName: session.agentName ?? null,
  skillId: session.skillId ?? null,
  sessionType: sessionTypeFromProto(session.sessionType),
  trigger: sessionTriggerFromProto(session.trigger),
  scheduleId: session.scheduleId,
  scheduleRunId: session.scheduleRunId,
  parentSessionId: session.parentSessionId,
  request: session.request,
  followUps: session.followUps.map((followUp) => ({
    id: followUp.id,
    message: followUp.message,
    sentAt: requiredTimestamp(followUp.sentAt, "session.followUp.sentAt"),
  })),
  status: sessionStatusFromProto(session.status),
  issues: session.issues.map((issue) => ({
    runId: issue.runId,
    runNumber: issue.runNumber,
    sourceKey: issue.sourceKey,
    title: issue.title,
    outcome: sessionIssueOutcomeFromProto(issue.outcome),
    summary: issue.summary ?? null,
  })),
  startedAt: requiredTimestamp(session.startedAt, "session.startedAt"),
  completedAt: optionalTimestamp(session.completedAt),
  conversationId: session.conversationId ?? null,
  workspaceRoot: null,
  requestedWorkerId: session.requestedWorkerId ?? null,
  workerId: session.workerId ?? null,
  requestedByUserId: session.requestedByUserId ?? null,
  summary: session.summary ?? null,
  error: session.error ?? null,
  events: session.events.map((event) => ({
    id: event.id,
    type: sessionEventTypeFromProto(event.type),
    occurredAt: requiredTimestamp(event.occurredAt, "session.event.occurredAt"),
  })),
  dispatchEvents: [],
  workers: [],
  updatedAt: requiredTimestamp(session.updatedAt, "session.updatedAt"),
  localOwner: false,
  archived: session.archived,
  detailLoaded,
});

const timestampFromIso = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} is not a valid timestamp`);
  }
  return timestampFromDate(date);
};

const sessionTypeToProto = {
  task: ProtoProjectAgentSessionType.TASK,
  dispatch: ProtoProjectAgentSessionType.DISPATCH,
} as const satisfies Record<
  AutoHuntSession["sessionType"],
  ProtoProjectAgentSessionType
>;

const sessionTriggerToProto = {
  manual: ProtoProjectAgentSessionTrigger.MANUAL,
  scheduled: ProtoProjectAgentSessionTrigger.SCHEDULED,
} as const satisfies Record<
  NonNullable<AutoHuntSession["trigger"]>,
  ProtoProjectAgentSessionTrigger
>;

const sessionStatusToProto = {
  running: ProtoProjectAgentSessionStatus.RUNNING,
  completed: ProtoProjectAgentSessionStatus.COMPLETED,
  failed: ProtoProjectAgentSessionStatus.FAILED,
  skipped: ProtoProjectAgentSessionStatus.SKIPPED,
  interrupted: ProtoProjectAgentSessionStatus.INTERRUPTED,
} as const satisfies Record<AutoHuntSession["status"], ProtoProjectAgentSessionStatus>;

const sessionIssueOutcomeToProto = {
  pending: ProtoProjectAgentSessionIssueOutcome.PENDING,
  completed: ProtoProjectAgentSessionIssueOutcome.COMPLETED,
  blocked: ProtoProjectAgentSessionIssueOutcome.BLOCKED,
  failed: ProtoProjectAgentSessionIssueOutcome.FAILED,
  skipped: ProtoProjectAgentSessionIssueOutcome.SKIPPED,
} as const satisfies Record<AutoHuntSessionIssueOutcome, ProtoProjectAgentSessionIssueOutcome>;

const sessionEventTypeToProto = {
  started: ProtoProjectAgentSessionEventType.STARTED,
  completed: ProtoProjectAgentSessionEventType.COMPLETED,
  failed: ProtoProjectAgentSessionEventType.FAILED,
  skipped: ProtoProjectAgentSessionEventType.SKIPPED,
  interrupted: ProtoProjectAgentSessionEventType.INTERRUPTED,
  stopped: ProtoProjectAgentSessionEventType.STOPPED,
} as const satisfies Record<AutoHuntSessionEventType, ProtoProjectAgentSessionEventType>;

const cursorToProto = (value: number): bigint => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Agent session cursor is outside JavaScript's safe range");
  }
  return BigInt(value);
};

const skillKindToProto = {
  issue_processing: ProtoAgentSkillKind.ISSUE_PROCESSING,
  custom: ProtoAgentSkillKind.CUSTOM,
} as const;

const skillExecutionModeToProto = {
  conversation: ProtoAgentSkillExecutionMode.CONVERSATION,
  task: ProtoAgentSkillExecutionMode.TASK,
} as const;

const skillApprovalPolicyToProto = {
  invoke_is_consent: ProtoAgentSkillApprovalPolicy.INVOKE_IS_CONSENT,
  explicit: ProtoAgentSkillApprovalPolicy.EXPLICIT,
} as const;

const projectAgentSkillToMessage = (skill: {
  readonly id?: string;
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly provider: AgentProvider;
  readonly model: string | null;
  readonly effort: string | null;
  readonly kind: ProjectAgentSkillKind;
  readonly executionMode: ProjectAgentSkillExecutionMode;
  readonly approvalPolicy: ProjectAgentSkillApprovalPolicy;
  readonly position: number;
}) => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  body: skill.body,
  provider: agentProviderToProto(skill.provider),
  model: skill.model ?? undefined,
  effort: skill.effort ?? undefined,
  kind: skillKindToProto[skill.kind],
  executionMode: skillExecutionModeToProto[skill.executionMode],
  approvalPolicy: skillApprovalPolicyToProto[skill.approvalPolicy],
  position: skill.position,
});

const scheduleRecurrenceFromProto = (
  value: ProtoProjectAgentScheduleRecurrence,
): ProjectAgentSchedule["recurrence"] => {
  switch (value) {
    case ProtoProjectAgentScheduleRecurrence.DAILY:
      return "daily";
    case ProtoProjectAgentScheduleRecurrence.WEEKDAYS:
      return "weekdays";
    case ProtoProjectAgentScheduleRecurrence.WEEKLY:
      return "weekly";
    case ProtoProjectAgentScheduleRecurrence.INTERVAL:
      return "interval";
    case ProtoProjectAgentScheduleRecurrence.CUSTOM:
      return "custom";
    default:
      throw new Error(`Unknown Agent schedule recurrence: ${value}`);
  }
};

const scheduleIntervalUnitFromProto = (
  value: ProtoProjectAgentScheduleIntervalUnit,
): NonNullable<ProjectAgentSchedule["intervalUnit"]> => {
  switch (value) {
    case ProtoProjectAgentScheduleIntervalUnit.MINUTE:
      return "minute";
    case ProtoProjectAgentScheduleIntervalUnit.HOUR:
      return "hour";
    case ProtoProjectAgentScheduleIntervalUnit.DAY:
      return "day";
    case ProtoProjectAgentScheduleIntervalUnit.WEEK:
      return "week";
    default:
      throw new Error(`Unknown Agent schedule interval unit: ${value}`);
  }
};

const scheduleNotificationLevelFromProto = (
  value: ProtoProjectAgentScheduleNotificationLevel,
): NonNullable<ProjectAgentSchedule["notificationLevel"]> => {
  switch (value) {
    case ProtoProjectAgentScheduleNotificationLevel.IMPORTANT_UPDATES:
      return "important_updates";
    case ProtoProjectAgentScheduleNotificationLevel.NONE:
      return "none";
    default:
      throw new Error(`Unknown Agent schedule notification level: ${value}`);
  }
};

const scheduleRunStatusFromProto = (
  value: ProtoProjectAgentScheduleRunStatus,
): ProjectAgentScheduleRun["status"] => {
  switch (value) {
    case ProtoProjectAgentScheduleRunStatus.RUNNING:
      return "running";
    case ProtoProjectAgentScheduleRunStatus.COMPLETED:
      return "completed";
    case ProtoProjectAgentScheduleRunStatus.FAILED:
      return "failed";
    default:
      throw new Error(`Unknown Agent schedule run status: ${value}`);
  }
};

const scheduleRecurrenceToProto = {
  daily: ProtoProjectAgentScheduleRecurrence.DAILY,
  weekdays: ProtoProjectAgentScheduleRecurrence.WEEKDAYS,
  weekly: ProtoProjectAgentScheduleRecurrence.WEEKLY,
  interval: ProtoProjectAgentScheduleRecurrence.INTERVAL,
  custom: ProtoProjectAgentScheduleRecurrence.CUSTOM,
} as const;

const scheduleIntervalUnitToProto = {
  minute: ProtoProjectAgentScheduleIntervalUnit.MINUTE,
  hour: ProtoProjectAgentScheduleIntervalUnit.HOUR,
  day: ProtoProjectAgentScheduleIntervalUnit.DAY,
  week: ProtoProjectAgentScheduleIntervalUnit.WEEK,
} as const;

const scheduleNotificationLevelToProto = {
  important_updates: ProtoProjectAgentScheduleNotificationLevel.IMPORTANT_UPDATES,
  none: ProtoProjectAgentScheduleNotificationLevel.NONE,
} as const;

const projectAgentScheduleFromMessage = (
  schedule: ProjectAgentScheduleMessage,
): ProjectAgentSchedule => ({
  id: schedule.id,
  projectId: schedule.projectId,
  agentId: schedule.agentId,
  agentName: schedule.agentName,
  agentProvider: agentProviderFromProto(schedule.agentProvider),
  name: schedule.name,
  recurrence: scheduleRecurrenceFromProto(schedule.recurrence),
  timeOfDay: schedule.timeOfDay,
  dayOfWeek: schedule.dayOfWeek ?? null,
  intervalValue: schedule.intervalValue,
  intervalUnit: scheduleIntervalUnitFromProto(schedule.intervalUnit),
  daysOfWeek: schedule.daysOfWeek,
  notificationLevel: scheduleNotificationLevelFromProto(schedule.notificationLevel),
  timeZone: schedule.timeZone,
  enabled: schedule.enabled,
  createdAt: requiredTimestamp(schedule.createdAt, "agentSchedule.createdAt"),
  updatedAt: requiredTimestamp(schedule.updatedAt, "agentSchedule.updatedAt"),
});

const projectAgentScheduleRunFromMessage = (
  scheduleRun: ProjectAgentScheduleRunMessage,
): ProjectAgentScheduleRun => {
  const agent = requiredMessage(scheduleRun.agent, "agentScheduleRun.agent");
  return {
    id: scheduleRun.id,
    projectId: scheduleRun.projectId,
    scheduleId: scheduleRun.scheduleId,
    scheduleName: scheduleRun.scheduleName,
    agent: {
      id: agent.id,
      name: agent.name,
      provider: agentProviderFromProto(agent.provider),
      model: agent.model ?? null,
      effort: agent.effort ?? null,
      computerUsePolicy: computerUsePolicyFromProto(agent.computerUsePolicy),
      description: agent.description ?? "",
      responsibility: agent.responsibility,
      skill: agent.skill,
      skills: agent.skills.map(projectAgentSkillFromMessage),
    },
    workflow: workflowFromProto(requiredMessage(scheduleRun.workflow, "agentScheduleRun.workflow")),
    status: scheduleRunStatusFromProto(scheduleRun.status),
    scheduledFor: requiredTimestamp(scheduleRun.scheduledFor, "agentScheduleRun.scheduledFor"),
    leaseExpiresAt: optionalTimestamp(scheduleRun.leaseExpiresAt),
    startedAt: requiredTimestamp(scheduleRun.startedAt, "agentScheduleRun.startedAt"),
    completedAt: optionalTimestamp(scheduleRun.completedAt),
    resultSummary: scheduleRun.resultSummary ?? null,
    structuredResult: structuredResultFromProto(scheduleRun.structuredResult),
    error: scheduleRun.error ?? null,
  };
};

const projectAgentScheduleToMessage = (
  input: CreateProjectAgentScheduleInput | UpdateProjectAgentScheduleInput,
) => ({
  agentId: input.agentId,
  name: input.name,
  recurrence: scheduleRecurrenceToProto[input.recurrence],
  timeOfDay: input.timeOfDay,
  dayOfWeek: input.dayOfWeek ?? undefined,
  intervalValue: input.intervalValue,
  intervalUnit:
    input.intervalUnit === undefined ? undefined : scheduleIntervalUnitToProto[input.intervalUnit],
  daysOfWeek: input.daysOfWeek ?? [],
  notificationLevel:
    input.notificationLevel === undefined
      ? undefined
      : scheduleNotificationLevelToProto[input.notificationLevel],
  timeZone: input.timeZone,
});

export type ProjectAgentSessionSyncState = {
  cursor: number;
};

export type ProjectAgentSessionSyncResult = {
  state: ProjectAgentSessionSyncState;
  hasMore: boolean;
  reset: boolean;
  notModified: boolean;
  sessions: AutoHuntSession[];
  deletedSessionIds: string[];
};

export async function createOrganizationAgent(
  token: string,
  organizationId: string,
  input: {
    name: string;
    provider: AgentProvider;
    model: string | null;
    description?: string;
    responsibility: string;
    effort?: ModelEffort | null;
    computerUsePolicy?: "disabled" | "unattended";
    skills?: ChannelAgentSkillInput[];
  },
): Promise<{ agent: ChannelAgentSummary }> {
  const client = requireAgentClient();
  const response = await client.createOrganizationAgent(
    {
      organizationId,
      name: input.name,
      provider: agentProviderToProto(input.provider),
      model: input.model ?? undefined,
      description: input.description,
      responsibility: input.responsibility,
      effort: input.effort ?? undefined,
      computerUsePolicy: computerUsePolicyToProto(
        input.computerUsePolicy ?? "disabled",
      ),
      skills: (input.skills ?? []).map(projectAgentSkillToMessage),
    },
    appCallOptions(token),
  );
  return {
    agent: organizationAgentFromMessage(
      requiredMessage(response.agent, "createOrganizationAgent.agent"),
    ),
  };
}

export async function updateOrganizationAgent(
  token: string,
  organizationId: string,
  agentId: string,
  input: {
    name: string;
    provider: AgentProvider;
    model: string | null;
    description?: string;
    responsibility: string;
    effort?: ModelEffort | null;
    computerUsePolicy?: "disabled" | "unattended";
    skills: ChannelAgentSkillInput[];
  },
): Promise<{ agent: ChannelAgentSummary }> {
  const client = requireAgentClient();
  const response = await client.updateOrganizationAgent(
    {
      organizationId,
      agentId,
      name: input.name,
      provider: agentProviderToProto(input.provider),
      model: input.model ?? undefined,
      description: input.description,
      responsibility: input.responsibility,
      effort: input.effort ?? undefined,
      computerUsePolicy: input.computerUsePolicy === undefined
        ? undefined
        : computerUsePolicyToProto(input.computerUsePolicy),
      skills: input.skills.map(projectAgentSkillToMessage),
    },
    appCallOptions(token),
  );
  return {
    agent: organizationAgentFromMessage(
      requiredMessage(response.agent, "updateOrganizationAgent.agent"),
    ),
  };
}

export async function deleteOrganizationAgent(
  token: string,
  organizationId: string,
  agentId: string,
): Promise<{ deleted: boolean }> {
  const client = requireAgentClient();
  const response = await client.deleteOrganizationAgent(
    { organizationId, agentId },
    appCallOptions(token),
  );
  return { deleted: response.deleted };
}

export async function listOrganizationAgents(
  token: string,
  organizationId: string,
): Promise<{ agents: ChannelAgentSummary[]; canManage: boolean }> {
  const client = requireAgentClient();
  const response = await client.listOrganizationAgents({ organizationId }, appCallOptions(token));
  return {
    agents: response.agents.map(organizationAgentFromMessage),
    canManage: response.canManage,
  };
}

export async function loadProjectAgents(token: string, projectId: string): Promise<ProjectAgent[]> {
  const client = requireAgentClient();
  const response = await client.listProjectAgents({ projectId }, appCallOptions(token));
  return response.agents.map(projectAgentFromMessage);
}

export async function loadProjectAgentTranscript(
  token: string,
  projectId: string,
  selector: GetProjectAgentTranscriptRequest["selector"],
  signal?: AbortSignal,
) {
  const client = requireAgentClient();
  return client.getProjectAgentTranscript(
    { projectId, selector },
    appCallOptions(token, signal),
  );
}

export async function createProjectAgent(
  token: string,
  projectId: string,
  input: CreateProjectAgentInput,
): Promise<ProjectAgent> {
  if (input.codexPet) {
    throw new Error("Create the agent before selecting a Codex Pet avatar");
  }
  const client = requireAgentClient();
  const response = await client.createProjectAgent(
    {
      projectId,
      name: input.name ?? undefined,
      avatar: input.avatar ?? undefined,
      provider: agentProviderToProto(input.provider),
      model: input.model ?? undefined,
      effort: input.effort ?? undefined,
      computerUsePolicy: computerUsePolicyToProto(
        input.computerUsePolicy ?? "disabled",
      ),
      designatedWorkerId: input.designatedWorkerId ?? undefined,
      description: input.description,
      responsibility: input.responsibility,
      skills: (input.skills ?? []).map(projectAgentSkillToMessage),
      calendarColor: input.calendarColor,
    },
    appCallOptions(token),
  );
  return projectAgentFromMessage(requiredMessage(response.agent, "createProjectAgent.agent"));
}

export async function updateProjectAgent(
  token: string,
  projectId: string,
  agentId: string,
  input: UpdateProjectAgentInput,
): Promise<ProjectAgent> {
  const client = requireAgentClient();
  const response = await client.updateProjectAgent(
    {
      projectId,
      agentId,
      name: input.name ?? undefined,
      avatarUpdate:
        input.avatar === undefined
          ? { case: undefined }
          : input.avatar === null
            ? { case: "clearAvatar", value: {} }
            : { case: "avatar", value: input.avatar },
      codexPetUpdate:
        input.codexPet === undefined
          ? { case: undefined }
          : input.codexPet === null
            ? { case: "clearCodexPet", value: {} }
            : {
                case: "codexPet",
                value: { slug: input.codexPet.slug },
              },
      provider: agentProviderToProto(input.provider),
      model: input.model ?? undefined,
      effortUpdate:
        input.effort === undefined
          ? { case: undefined }
          : input.effort === null
            ? { case: "clearEffort", value: {} }
            : { case: "effort", value: input.effort },
      computerUsePolicy: input.computerUsePolicy === undefined
        ? undefined
        : computerUsePolicyToProto(input.computerUsePolicy),
      designatedWorkerUpdate:
        input.designatedWorkerId === undefined
          ? { case: undefined }
          : input.designatedWorkerId === null
            ? { case: "clearDesignatedWorker", value: {} }
            : {
                case: "designatedWorkerId",
                value: input.designatedWorkerId,
              },
      description: input.description,
      responsibility: input.responsibility,
      skills: input.skills.map(projectAgentSkillToMessage),
      calendarColor: input.calendarColor,
    },
    appCallOptions(token),
  );
  return projectAgentFromMessage(requiredMessage(response.agent, "updateProjectAgent.agent"));
}

export async function deleteProjectAgent(
  token: string,
  projectId: string,
  agentId: string,
): Promise<void> {
  const client = requireAgentClient();
  await client.deleteProjectAgent({ projectId, agentId }, appCallOptions(token));
}

export async function loadProjectAgentSchedules(
  token: string,
  projectId: string,
): Promise<ProjectAgentSchedule[]> {
  const client = requireAgentClient();
  const response = await client.listProjectAgentSchedules({ projectId }, appCallOptions(token));
  return response.schedules.map(projectAgentScheduleFromMessage);
}

export async function createProjectAgentSchedule(
  token: string,
  projectId: string,
  input: CreateProjectAgentScheduleInput,
): Promise<ProjectAgentSchedule> {
  const client = requireAgentClient();
  const response = await client.createProjectAgentSchedule(
    { projectId, schedule: projectAgentScheduleToMessage(input) },
    appCallOptions(token),
  );
  return projectAgentScheduleFromMessage(
    requiredMessage(response.schedule, "createProjectAgentSchedule.schedule"),
  );
}

export async function updateProjectAgentSchedule(
  token: string,
  projectId: string,
  scheduleId: string,
  input: UpdateProjectAgentScheduleInput,
): Promise<ProjectAgentSchedule> {
  const client = requireAgentClient();
  const response = await client.updateProjectAgentSchedule(
    {
      projectId,
      scheduleId,
      schedule: projectAgentScheduleToMessage(input),
    },
    appCallOptions(token),
  );
  return projectAgentScheduleFromMessage(
    requiredMessage(response.schedule, "updateProjectAgentSchedule.schedule"),
  );
}

export async function deleteProjectAgentSchedule(
  token: string,
  projectId: string,
  scheduleId: string,
): Promise<void> {
  const client = requireAgentClient();
  await client.deleteProjectAgentSchedule({ projectId, scheduleId }, appCallOptions(token));
}

export async function loadProjectAgentScheduleRuns(
  token: string,
  projectId: string,
): Promise<ProjectAgentScheduleRun[]> {
  const client = requireAgentClient();
  const response = await client.listProjectAgentScheduleRuns(
    { projectId },
    appCallOptions(token),
  );
  return response.runs.map(projectAgentScheduleRunFromMessage);
}

export async function claimProjectAgentScheduleRuns(
  token: string,
  projectIds: readonly string[],
): Promise<ClaimedProjectAgentScheduleRun | null> {
  const client = requireAgentClient();
  const uniqueProjectIds = [...new Set(projectIds)];
  for (let offset = 0; offset < uniqueProjectIds.length; offset += 100) {
    const response = await client.claimProjectAgentScheduleRun(
      { projectIds: uniqueProjectIds.slice(offset, offset + 100) },
      appCallOptions(token),
    );
    const claimed = response.claimedRun;
    if (!claimed) continue;
    const scheduleRun = projectAgentScheduleRunFromMessage(
      requiredMessage(claimed.run, "claimProjectAgentScheduleRun.run"),
    );
    if (scheduleRun.status !== "running") {
      throw new Error("Claimed Agent schedule run is not running");
    }
    return { ...scheduleRun, status: "running", claimToken: claimed.claimToken };
  }
  return null;
}

export async function completeProjectAgentScheduleRun(
  token: string,
  projectId: string,
  runId: string,
  input:
    | {
        claimToken: string;
        status: "completed";
        resultSummary: string;
        structuredResult: StructuredAgentResult;
      }
    | {
        claimToken: string;
        status: "failed";
        error: string;
        structuredResult: StructuredAgentResult;
      },
): Promise<ProjectAgentScheduleRun> {
  const client = requireAgentClient();
  const response = await client.completeProjectAgentScheduleRun(
    {
      projectId,
      runId,
      claimToken: input.claimToken,
      outcome:
        input.status === "completed"
          ? {
              case: "completed",
              value: {
                resultSummary: input.resultSummary,
                structuredResult: structuredResultToProto(input.structuredResult),
              },
            }
          : {
              case: "failed",
              value: {
                error: input.error,
                structuredResult: structuredResultToProto(input.structuredResult),
              },
            },
    },
    appCallOptions(token),
  );
  return projectAgentScheduleRunFromMessage(
    requiredMessage(response.run, "completeProjectAgentScheduleRun.run"),
  );
}

export async function renewProjectAgentScheduleRun(
  token: string,
  projectId: string,
  runId: string,
  claimToken: string,
): Promise<string> {
  const client = requireAgentClient();
  const response = await client.renewProjectAgentScheduleRun(
    { projectId, runId, claimToken },
    appCallOptions(token),
  );
  return requiredTimestamp(
    response.leaseExpiresAt,
    "renewProjectAgentScheduleRun.leaseExpiresAt",
  );
}

export async function loadProjectAgentSessionChanges(
  token: string,
  projectId: string,
  state: ProjectAgentSessionSyncState | null,
): Promise<ProjectAgentSessionSyncResult> {
  const client = requireAgentClient();
  try {
    const response = await client.syncProjectAgentSessions(
      {
        projectId,
        cursor: state === null ? undefined : cursorToProto(state.cursor),
      },
      appCallOptions(token),
    );
    return {
      state: {
        cursor: safeNumber(response.cursor, "agentSessionSync.cursor"),
      },
      hasMore: response.hasMore,
      reset: response.reset,
      notModified: false,
      sessions: response.sessions.map((session) => projectAgentSessionFromMessage(session, false)),
      deletedSessionIds: response.deletedSessionIds,
    };
  } catch (error) {
    if (state !== null && isApiErrorStatus(error, 410)) {
      return loadProjectAgentSessionChanges(token, projectId, null);
    }
    throw error;
  }
}

export async function loadProjectAgentSession(
  token: string,
  projectId: string,
  sessionId: string,
): Promise<AutoHuntSession> {
  const client = requireAgentClient();
  const response = await client.getProjectAgentSession(
    { projectId, sessionId },
    appCallOptions(token),
  );
  return projectAgentSessionFromMessage(
    requiredMessage(response.session, "projectAgentSession.session"),
    true,
  );
}

export async function runProjectAgentTaskOnWorker(
  token: string,
  projectId: string,
  input: {
    agentId: string;
    request: string;
    workerId: string;
    skillId: string;
  },
): Promise<AutoHuntSession> {
  const client = requireAgentClient();
  const response = await client.runProjectAgentTask(
    {
      projectId,
      agentId: input.agentId.toLowerCase(),
      skillId: input.skillId,
      request: input.request,
      workerId: input.workerId,
      requestId: crypto.randomUUID(),
    },
    appCallOptions(token),
  );
  return projectAgentSessionFromMessage(
    requiredMessage(response.session, "runProjectAgentTask.session"),
    true,
  );
}

export async function upsertProjectAgentSession(
  token: string,
  session: AutoHuntSession,
): Promise<AutoHuntSession> {
  const client = requireAgentClient();
  const response = await client.putProjectAgentSession(
    {
      projectId: session.projectId,
      sessionId: session.id,
      dispatchGroupId: session.dispatchGroupId,
      agentId: session.agentId,
      agentName: session.agentName ?? undefined,
      skillId: session.skillId ?? undefined,
      sessionType: sessionTypeToProto[session.sessionType],
      trigger: session.trigger === undefined ? undefined : sessionTriggerToProto[session.trigger],
      scheduleId: session.scheduleId,
      scheduleRunId: session.scheduleRunId,
      parentSessionId: session.parentSessionId,
      request: session.request,
      followUps: (session.followUps ?? []).map((followUp) => ({
        id: followUp.id,
        message: followUp.message,
        sentAt: timestampFromIso(followUp.sentAt, "session.followUp.sentAt"),
      })),
      status: sessionStatusToProto[session.status],
      issues: session.issues.map((issue) => ({
        runId: issue.runId,
        runNumber: issue.runNumber,
        sourceKey: issue.sourceKey,
        title: issue.title,
        outcome: sessionIssueOutcomeToProto[issue.outcome],
        summary: issue.summary ?? undefined,
      })),
      startedAt: timestampFromIso(session.startedAt, "session.startedAt"),
      completedAt:
        session.completedAt === null
          ? undefined
          : timestampFromIso(session.completedAt, "session.completedAt"),
      conversationId: session.conversationId ?? undefined,
      summary: session.summary ?? undefined,
      error: session.error ?? undefined,
      requestedWorkerId: session.requestedWorkerId ?? undefined,
      workerId: session.workerId ?? undefined,
      events: session.events.map((event) => ({
        id: event.id,
        type: sessionEventTypeToProto[event.type],
        occurredAt: timestampFromIso(event.occurredAt, "session.event.occurredAt"),
      })),
      updatedAt: timestampFromIso(session.updatedAt, "session.updatedAt"),
    },
    appCallOptions(token),
  );
  return {
    ...projectAgentSessionFromMessage(
      requiredMessage(response.session, "putProjectAgentSession.session"),
      true,
    ),
    localOwner: session.localOwner,
    workspaceRoot: session.workspaceRoot,
    dispatchEvents: session.dispatchEvents,
    workers: session.workers,
  };
}
