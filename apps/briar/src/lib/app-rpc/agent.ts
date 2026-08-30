import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import {
  AgentService,
  AgentSkillApprovalPolicy as ProtoAgentSkillApprovalPolicy,
  AgentSkillExecutionMode as ProtoAgentSkillExecutionMode,
  AgentSkillKind as ProtoAgentSkillKind,
  ProjectAgentSessionEventType as ProtoProjectAgentSessionEventType,
  ProjectAgentSessionIssueOutcome as ProtoProjectAgentSessionIssueOutcome,
  ProjectAgentSessionStatus as ProtoProjectAgentSessionStatus,
  ProjectAgentSessionTrigger as ProtoProjectAgentSessionTrigger,
  ProjectAgentSessionType as ProtoProjectAgentSessionType,
  type OrganizationAgent as OrganizationAgentMessage,
  type ProjectAgent as ProjectAgentMessage,
  type ProjectAgentSession as ProjectAgentSessionMessage,
  type ProjectAgentSkill as ProjectAgentSkillMessage,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import type {
  AutoHuntSession,
  AutoHuntSessionEventType,
  AutoHuntSessionIssueOutcome,
} from "../../hooks/useAutoHuntSessions";
import type {
  ChannelAgentSummary,
} from "../channels-contract";
import type {
  ProjectAgent,
  ProjectAgentSkill,
  ProjectAgentSkillApprovalPolicy,
  ProjectAgentSkillExecutionMode,
  ProjectAgentSkillKind,
} from "../../types";
import { isApiErrorStatus } from "../api/errors";
import {
  appCallOptions,
  appRpc,
  appTransport,
} from "./core";
import {
  agentProviderFromProto,
  optionalTimestamp,
  requiredMessage,
  requiredTimestamp,
  safeNumber,
} from "./mappers";

const agentClient = appTransport
  ? createClient(AgentService, appTransport)
  : undefined;

const requireAgentClient = () => {
  if (!agentClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return agentClient;
};

export const skillKindFromProto = (
  value: ProtoAgentSkillKind,
): ProjectAgentSkillKind => {
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

export const projectAgentFromMessage = (
  agent: ProjectAgentMessage,
): ProjectAgent => ({
  id: agent.id,
  projectId: agent.projectId,
  name: agent.name,
  avatar: agent.avatar ?? null,
  codexPet: agent.codexPet === undefined
    ? null
    : {
        slug: agent.codexPet.slug,
        name: agent.codexPet.name,
        author: requiredMessage(
          agent.codexPet.author,
          "projectAgent.codexPet.author",
        ),
        license: requiredMessage(
          agent.codexPet.license,
          "projectAgent.codexPet.license",
        ),
        spriteVersion: codexPetSpriteVersion(agent.codexPet.spriteVersion),
        spriteSheetUrl: agent.codexPet.spriteSheetUrl ?? null,
      },
  provider: agentProviderFromProto(agent.provider),
  model: agent.model ?? null,
  effort: agent.effort ?? null,
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
  projectId: agent.projectId ?? null,
  projectName: agent.projectName ?? null,
  responsibility: agent.responsibility,
  skills: agent.skills.map(projectAgentSkillFromMessage),
  createdAt: requiredTimestamp(agent.createdAt, "organizationAgent.createdAt"),
});

const sessionTypeFromProto = (
  value: ProtoProjectAgentSessionType | undefined,
): NonNullable<AutoHuntSession["sessionType"]> => {
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
  dispatchGroupId: session.dispatchGroupId ?? session.id,
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
  NonNullable<AutoHuntSession["sessionType"]>,
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
} as const satisfies Record<
  AutoHuntSession["status"],
  ProtoProjectAgentSessionStatus
>;

const sessionIssueOutcomeToProto = {
  pending: ProtoProjectAgentSessionIssueOutcome.PENDING,
  completed: ProtoProjectAgentSessionIssueOutcome.COMPLETED,
  blocked: ProtoProjectAgentSessionIssueOutcome.BLOCKED,
  failed: ProtoProjectAgentSessionIssueOutcome.FAILED,
  skipped: ProtoProjectAgentSessionIssueOutcome.SKIPPED,
} as const satisfies Record<
  AutoHuntSessionIssueOutcome,
  ProtoProjectAgentSessionIssueOutcome
>;

const sessionEventTypeToProto = {
  started: ProtoProjectAgentSessionEventType.STARTED,
  completed: ProtoProjectAgentSessionEventType.COMPLETED,
  failed: ProtoProjectAgentSessionEventType.FAILED,
  skipped: ProtoProjectAgentSessionEventType.SKIPPED,
  interrupted: ProtoProjectAgentSessionEventType.INTERRUPTED,
  stopped: ProtoProjectAgentSessionEventType.STOPPED,
} as const satisfies Record<
  AutoHuntSessionEventType,
  ProtoProjectAgentSessionEventType
>;

const cursorToProto = (value: number): bigint => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Agent session cursor is outside JavaScript's safe range");
  }
  return BigInt(value);
};

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

export async function listOrganizationAgents(
  token: string,
  organizationId: string,
): Promise<{ agents: ChannelAgentSummary[]; canManage: boolean }> {
  const client = requireAgentClient();
  return appRpc(async () => {
    const response = await client.listOrganizationAgents(
      { organizationId },
      appCallOptions(token),
    );
    return {
      agents: response.agents.map(organizationAgentFromMessage),
      canManage: response.canManage,
    };
  });
}

export async function loadProjectAgents(
  token: string,
  projectId: string,
): Promise<ProjectAgent[]> {
  const client = requireAgentClient();
  return appRpc(async () => {
    const response = await client.listProjectAgents(
      { projectId },
      appCallOptions(token),
    );
    return response.agents.map(projectAgentFromMessage);
  });
}

export async function loadProjectAgentSessionChanges(
  token: string,
  projectId: string,
  state: ProjectAgentSessionSyncState | null,
): Promise<ProjectAgentSessionSyncResult> {
  const client = requireAgentClient();
  try {
    const response = await appRpc(async () =>
      client.syncProjectAgentSessions(
        {
          projectId,
          cursor: state === null ? undefined : cursorToProto(state.cursor),
        },
        appCallOptions(token),
      )
    );
    return {
      state: {
        cursor: safeNumber(response.cursor, "agentSessionSync.cursor"),
      },
      hasMore: response.hasMore,
      reset: response.reset,
      notModified: false,
      sessions: response.sessions.map((session) =>
        projectAgentSessionFromMessage(session, false)
      ),
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
  return appRpc(async () => {
    const response = await client.getProjectAgentSession(
      { projectId, sessionId },
      appCallOptions(token),
    );
    return projectAgentSessionFromMessage(
      requiredMessage(response.session, "projectAgentSession.session"),
      true,
    );
  });
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
  return appRpc(async () => {
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
  });
}

export async function upsertProjectAgentSession(
  token: string,
  session: AutoHuntSession,
): Promise<AutoHuntSession> {
  const client = requireAgentClient();
  return appRpc(async () => {
    const response = await client.putProjectAgentSession(
      {
        projectId: session.projectId,
        sessionId: session.id,
        dispatchGroupId: session.dispatchGroupId,
        agentId: session.agentId,
        agentName: session.agentName ?? undefined,
        skillId: session.skillId ?? undefined,
        sessionType: sessionTypeToProto[session.sessionType ?? "dispatch"],
        trigger: session.trigger === undefined
          ? undefined
          : sessionTriggerToProto[session.trigger],
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
        completedAt: session.completedAt === null
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
          occurredAt: timestampFromIso(
            event.occurredAt,
            "session.event.occurredAt",
          ),
        })),
        updatedAt: timestampFromIso(
          session.updatedAt ?? session.completedAt ?? session.startedAt,
          "session.updatedAt",
        ),
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
  });
}
