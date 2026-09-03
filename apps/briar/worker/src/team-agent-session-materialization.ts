import { teamAgentTaskSessionEvent } from "./team-agent-task-session";
import { encodeStoredTeamAgentSessionPayload } from "./team-request-contract";

export const encodeApprovedTeamAgentTaskSession = (input: {
  sessionId: string;
  agentId: string;
  agentName: string;
  skillId: string;
  request: string;
  workerId: string;
  requestedByUserId: string;
  acceptedAt: string;
}) => encodeStoredTeamAgentSessionPayload({
  dispatchGroupId: input.sessionId,
  agentId: input.agentId,
  agentName: input.agentName,
  skillId: input.skillId,
  sessionType: "task",
  trigger: "manual",
  scheduleId: null,
  scheduleRunId: null,
  parentSessionId: null,
  request: input.request,
  followUps: [],
  status: "running",
  issues: [],
  startedAt: input.acceptedAt,
  completedAt: null,
  conversationId: null,
  summary: null,
  error: null,
  requestedWorkerId: input.workerId,
  workerId: input.workerId,
  events: [teamAgentTaskSessionEvent("started", input.acceptedAt)],
  updatedAt: input.acceptedAt,
  requestedByUserId: input.requestedByUserId,
});
