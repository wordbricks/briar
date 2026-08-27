import { describe, expect, it } from "vitest";
import type {
  AgentSkillExecutionProposal,
  IssueMessage,
} from "../types";
import { mergeIssueMessages } from "./issue-message-merge";

const skill = (
  id: string,
  status: "pending" | "accepted",
): AgentSkillExecutionProposal => ({
  id,
  type: "request_agent_skill_execute",
  status,
  projectId: "11111111-1111-4111-8111-111111111111",
  agentId: "22222222-2222-4222-8222-222222222222",
  agentName: "Agent",
  skillId: "33333333-3333-4333-8333-333333333333",
  skillName: "Deploy",
  request: "Deploy",
  provider: "codex",
  model: null,
  effort: null,
  executionMode: "task",
  approvalPolicy: "explicit",
  executionStatus: status === "accepted" ? "running" : "waiting",
  createdAt: "2026-08-11T00:00:00.000Z",
  acceptedAt: status === "accepted" ? "2026-08-11T00:01:00.000Z" : null,
  requestedWorkerId: status === "accepted" ? "worker-1" : null,
  requestedWorkerLabel: status === "accepted" ? "Build Mac" : null,
  resultSessionId: status === "accepted" ? "session-1" : null,
  resultMessageId: null,
  error: null,
  delegatedByAgentId: null,
  delegatedByAgentName: null,
});

const message = (
  skillExecutionProposal: AgentSkillExecutionProposal | null,
): IssueMessage => ({
  id: "message-1",
  runId: "run-1",
  parentMessageId: null,
  body: "Deploy",
  author: { id: null, name: "Agent", image: null, provider: "codex" },
  replyCount: 0,
  proposedAction: null,
  executionProposal: null,
  skillExecutionProposal,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
});

describe("mergeIssueMessages", () => {
  it("keeps a pending local message until the snapshot includes it", () => {
    const optimistic = { ...message(null), optimistic: true };

    expect(mergeIssueMessages([optimistic], [])).toEqual([optimistic]);
  });

  it("replaces a pending local message with the authoritative same-id row", () => {
    const optimistic = { ...message(null), body: "Sending", optimistic: true };
    const authoritative = { ...message(null), body: "Sent" };

    expect(mergeIssueMessages([optimistic], [authoritative])).toEqual([
      authoritative,
    ]);
  });

  it("does not regress accepted Skill history to a delayed pending snapshot", () => {
    const accepted = skill("skill-1", "accepted");
    expect(mergeIssueMessages(
      [message(accepted)],
      [message(skill("skill-1", "pending"))],
    )[0]?.skillExecutionProposal).toEqual(accepted);
  });

  it("honors tombstones, replacements, and removed messages", () => {
    expect(mergeIssueMessages(
      [message(skill("skill-1", "accepted"))],
      [message(null)],
    )[0]?.skillExecutionProposal).toBeNull();
    expect(mergeIssueMessages(
      [message(skill("skill-1", "accepted"))],
      [message(skill("skill-2", "pending"))],
    )[0]?.skillExecutionProposal?.id).toBe("skill-2");
    expect(mergeIssueMessages([message(skill("skill-1", "accepted"))], []))
      .toEqual([]);
  });
});
