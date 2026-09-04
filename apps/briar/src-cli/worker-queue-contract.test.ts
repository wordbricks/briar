import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { AgentProvider as ProtoAgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  ClaimedWorkSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { claimedWorkFromProto } from "./worker-queue-contract";

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
