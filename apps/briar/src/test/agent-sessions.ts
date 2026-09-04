import type { AutoHuntSession } from "../types";

/**
 * A minimal agent session, for the tests that care about three of its fields
 * and have to fill in twenty. Overrides are applied last, so a case says only
 * what it is about.
 */
export function testAgentSession(
  id: string,
  overrides: Partial<AutoHuntSession> = {},
): AutoHuntSession {
  return {
    id,
    dispatchGroupId: id,
    projectId: "project-1",
    agentId: "agent-1",
    sessionType: "task",
    trigger: "manual",
    request: "Audit the repository",
    followUps: [],
    status: "running",
    issues: [],
    startedAt: "2026-07-28T01:00:00.000Z",
    completedAt: null,
    conversationId: null,
    workspaceRoot: null,
    summary: null,
    error: null,
    events: [],
    dispatchEvents: [],
    workers: [],
    updatedAt: "2026-07-28T01:00:00.000Z",
    localOwner: true,
    ...overrides,
  };
}
