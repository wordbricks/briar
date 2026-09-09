import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { AgentProvider as ProtoAgentProvider} from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  ClaimedWorkSchema} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { claimedWorkFromProto } from "./worker-queue-contract";

const organizationId = "77777777-7777-4777-8777-777777777777";
const projectId = "88888888-8888-4888-8888-888888888888";

const projectAgentTaskClaim = (resumeCount?: number) =>
  create(ClaimedWorkSchema, {
    work: {
      case: "projectAgentTask",
      value: {
        workId: "11111111-1111-4111-8111-111111111111",
        runId: "22222222-2222-4222-8222-222222222222",
        sourceKey: "agent-task:test",
        title: "Run release Skill",
        claimToken: "briar_agent_task_claim_test",
        claimAttempts: 1,
        claimedAt: timestampFromDate(new Date("2026-08-22T08:00:00.000Z")),
        leaseExpiresAt: timestampFromDate(new Date("2026-08-22T08:15:00.000Z")),
        request: "Run the saved release Skill",
        agent: {
          id: "agent-1",
          name: "Release Agent",
          provider: ProtoAgentProvider.CODEX,
          responsibility: "Release the project",
        },
        ...(resumeCount === undefined ? {} : { resumeCount }),
      },
    },
  });

const decodeProjectAgentTask = (resumeCount?: number) => {
  const claim = claimedWorkFromProto(projectAgentTaskClaim(resumeCount));
  if (claim.workType !== "projectAgentTask") {
    throw new Error("Decoded claim is not a project Agent task");
  }
  return claim;
};

const channelReplyClaim = (overrides: {
  scope: "organization" | "project";
  delegationTargets?: boolean;
  agentMessageTargets?: boolean;
}) =>
  create(ClaimedWorkSchema, {
    work: {
      case: "channelReply",
      value: {
        workId: "33333333-3333-4333-8333-333333333333",
        channelId: "44444444-4444-4444-8444-444444444444",
        scope: {
          scope: overrides.scope === "organization"
            ? {
                case: "workspace",
                value: { workspaceId: organizationId },
              }
            : {
                case: "project",
                value: { workspaceId: organizationId, projectId },
              },
        },
        runId: "55555555-5555-4555-8555-555555555555",
        sourceKey: "channel-reply:test",
        title: "Answer the direct message",
        triggerMessageId: "66666666-6666-4666-8666-666666666666",
        parentMessageId: "66666666-6666-4666-8666-666666666666",
        provider: ProtoAgentProvider.CODEX,
        agent: {
          id: "agent-a",
          name: "Assistant",
          provider: ProtoAgentProvider.CODEX,
          responsibility: "Help the user",
        },
        claimToken: "briar_channel_claim_test",
        claimedAt: timestampFromDate(new Date("2026-09-06T08:00:00.000Z")),
        leaseExpiresAt: timestampFromDate(new Date("2026-09-06T08:15:00.000Z")),
        // Only an organization claim carries the manifest, and the decoder
        // requires it for that scope.
        ...(overrides.scope === "organization"
          ? {
              workspaceContextSnapshotAt: timestampFromDate(
                new Date("2026-09-06T07:59:00.000Z"),
              ),
            }
          : {}),
        snapshot: { fields: {} },
        delegationTargets: overrides.delegationTargets
          ? [{
              agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              agentName: "Repository Guide",
              projectId,
              projectName: "Briar",
              responsibility: "Answer repository questions",
              skills: [],
            }]
          : [],
        agentMessageTargets: overrides.agentMessageTargets
          ? [{
              agentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              agentName: "Ticker Watcher",
              responsibility: "Watch the ticker feed",
              skills: [],
            }]
          : [],
        agentMessageHop: 0,
      },
    },
  });

const decodeChannelReply = (
  overrides: Parameters<typeof channelReplyClaim>[0],
) => {
  const claim = claimedWorkFromProto(channelReplyClaim(overrides));
  if (claim.workType !== "channelReply") {
    throw new Error("Decoded claim is not a channel reply");
  }
  return claim;
};

describe("claimed channel reply Agent message decoding", () => {
  it("accepts Agent message targets in both reply scopes", () => {
    // Agent messages start in a DM, so a Project Agent claim carries targets
    // even though delegation stays an Organization Agent path.
    for (const scope of ["organization", "project"] as const) {
      const claim = decodeChannelReply({ scope, agentMessageTargets: true });
      expect(claim.agentMessageTargets).toEqual([{
        agentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        agentName: "Ticker Watcher",
        projectId: null,
        projectName: null,
        responsibility: "Watch the ticker feed",
        skills: [],
      }]);
      expect(claim.agentMessageHop).toBe(0);
      expect(claim.inboundAgentMessage).toBeNull();
    }
  });

  it("keeps delegation targets out of a project reply", () => {
    expect(() => decodeChannelReply({ scope: "project", delegationTargets: true }))
      .toThrow("project reply has inconsistent scope data");
  });

  it("rejects a claim offering both delegation and Agent message targets", () => {
    expect(() =>
      decodeChannelReply({
        scope: "organization",
        delegationTargets: true,
        agentMessageTargets: true,
      })
    ).toThrow("conflicting Agent target lists");
  });
});

describe("claimed project Agent task decoding", () => {
  it("carries the planned-update resume count into the execution domain", () => {
    const claim = decodeProjectAgentTask(3);
    expect(claim.resumeCount).toBe(3);
    expect(claim.claimAttempts).toBe(1);
  });

  it("defaults the resume count for a Worker that never resumed the claim", () => {
    expect(decodeProjectAgentTask().resumeCount).toBe(0);
  });
});
