import { describe, expect, it } from "vitest";
import {
  plannedUpdateContinuationMessage,
  recoveryAgent,
  type PlannedUpdateAgentRecovery,
} from "./planned-update-recovery";

const recovery: PlannedUpdateAgentRecovery = {
  version: 1,
  projectId: "project-1",
  startedAt: "2026-08-02T10:00:00.000Z",
  request: {
    sessionId: "session-1",
    agentId: "agent-1",
    agentName: "Provider-neutral agent",
    agentProvider: "grok",
    agentModel: "grok-4.5",
    responsibility: "Finish the task.",
    skill: "# Agent",
    message: "Fix the regression.",
    conversationId: "briar:grok:project-1:conversation-1",
    runs: [],
  },
};

describe("planned update recovery", () => {
  it("preserves the provider selected by the interrupted task", () => {
    expect(recoveryAgent(recovery)).toEqual({
      id: "agent-1",
      name: "Provider-neutral agent",
      provider: "grok",
      model: "grok-4.5",
      responsibility: "Finish the task.",
      skill: "# Agent",
    });
  });

  it("asks the provider to inspect durable state before continuing", () => {
    const message = plannedUpdateContinuationMessage("Fix the regression.");
    expect(message).toContain("Do not repeat side effects or completed work.");
    expect(message).toContain("Original request:\nFix the regression.");
  });
});
