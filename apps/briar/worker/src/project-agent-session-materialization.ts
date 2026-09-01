import { projectAgentTaskSessionEvent } from "./project-agent-task-session";
import { encodeStoredProjectAgentSessionPayload } from "./project-request-contract";

export const encodeApprovedProjectAgentTaskSession = (input: {
  sessionId: string;
  agentId: string;
  agentName: string;
  skillId: string;
  request: string;
  workerId: string;
  requestedByUserId: string;
  acceptedAt: string;
}) => encodeStoredProjectAgentSessionPayload({
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
  events: [projectAgentTaskSessionEvent("started", input.acceptedAt)],
  updatedAt: input.acceptedAt,
  requestedByUserId: input.requestedByUserId,
});
