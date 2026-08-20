import { describe, expect, it } from "vitest";
import {
  decodeClaimedChannelReply,
  decodeClaimedProjectAgentTask,
} from "./worker-claim-contract";

const workId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const channelId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const triggerMessageId = "55555555-5555-4555-8555-555555555555";
const parentMessageId = "66666666-6666-4666-8666-666666666666";
const projectId = "77777777-7777-4777-8777-777777777777";
const claimedAt = "2026-08-20T08:00:00+00:00";

const channelReply = {
  workType: "channelReply",
  workId,
  organizationId,
  channelId,
  projectId: null,
  runId,
  sourceKey: "channel:reply",
  title: "Reply",
  triggerMessageId,
  parentMessageId,
  provider: "codex",
  model: null,
  claimToken: "briar_channel_claim_test",
  claimedAt,
  leaseExpiresAt: "2026-08-20T08:15:00+00:00",
  organizationContext: {
    schemaVersion: 1,
    snapshotAt: claimedAt,
  },
  snapshot: {},
};

describe("CLI Worker claim contracts", () => {
  it("normalizes legacy organization scope and mutable defaults", () => {
    const reply = decodeClaimedChannelReply({
      ...channelReply,
      ignored: true,
    });

    expect(reply).toMatchObject({
      scope: { kind: "organization", organizationId },
      skillExecutionTarget: null,
      activity: null,
      delegation: null,
      delegationTargets: [],
    });
    expect(reply).not.toHaveProperty("ignored");
    reply.delegationTargets.push({
      agentId: triggerMessageId,
      agentName: "Agent",
      projectId,
      projectName: "Project",
      responsibility: "Review",
      skills: [],
    });
    expect(reply.delegationTargets).toHaveLength(1);
  });

  it("rejects channel scope and context mismatches", () => {
    expect(() =>
      decodeClaimedChannelReply({
        ...channelReply,
        scope: { kind: "project", organizationId, projectId },
      })
    ).toThrow("Project reply scope does not match its project");

    expect(() =>
      decodeClaimedChannelReply({
        ...channelReply,
        organizationContext: {
          schemaVersion: 1,
          snapshotAt: "2026-08-20T08:01:00+00:00",
        },
      })
    ).toThrow("Organization context snapshot does not match its claim");
  });

  it("applies detached Agent defaults and canonical effort trimming", () => {
    const task = decodeClaimedProjectAgentTask({
      workType: "projectAgentTask",
      workId,
      runId,
      sourceKey: "agent-task:test",
      title: "Task",
      claimToken: "briar_agent_task_claim_test",
      claimAttempts: 1,
      claimedAt,
      leaseExpiresAt: "2026-08-20T08:15:00+00:00",
      request: "Review this",
      agent: {
        id: "agent-1",
        name: "Reviewer",
        provider: "codex",
        model: null,
        effort: "  high  ",
        responsibility: "Review",
      },
    });

    expect(task.agent).toMatchObject({
      effort: "high",
      skill: "",
      skills: [],
    });
    task.agent.skills.push({
      id: "skill-1",
      name: "Review",
      instructions: "Review",
      provider: "codex",
      model: null,
      effort: null,
      kind: "custom",
      position: 0,
    });
    expect(task.agent.skills).toHaveLength(1);
  });
});
