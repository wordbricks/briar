import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ChannelReplySessionClaimReason } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { describe, expect, it } from "vitest";
import { claimedWorkFromProto } from "../../src-cli/worker-queue-contract";
import {
  workerClaimMessage,
  type WorkerQueueClaim,
} from "./worker-connect-mappers";

const claimedAt = "2026-08-31T00:00:00.000Z";
const leaseExpiresAt = "2026-08-31T00:15:00.000Z";

const common = {
  workId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  sourceKey: "test:claim",
  title: "Claim",
  claimToken: `briar_claim_${"a".repeat(64)}`,
  claimedAt,
  leaseExpiresAt,
  claimAttempts: 1,
  handoffContext: null,
};

const agent = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Agent",
  provider: "codex" as const,
  model: null,
  effort: null,
  responsibility: "Handle the work",
  skills: [],
};

const channelReply = {
  ...common,
  workType: "channelReply" as const,
  organizationId: "77777777-7777-4777-8777-777777777777",
  channelId: common.runId,
  projectId: "88888888-8888-4888-8888-888888888888",
  scope: {
    kind: "project" as const,
    organizationId: "77777777-7777-4777-8777-777777777777",
    projectId: "88888888-8888-4888-8888-888888888888",
  },
  triggerMessageId: "99999999-9999-4999-8999-999999999999",
  parentMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  provider: "codex" as const,
  model: "gpt-5",
  effort: "high",
  agent,
  activeSkill: null,
  skillExecutionTarget: null,
  activity: { token: "activity", expiresAt: leaseExpiresAt },
  organizationContext: null,
  delegation: null,
  delegationTargets: [],
  session: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    threadId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    conversationId: "conversation",
    retainedUntil: "2026-09-01T00:00:00.000Z",
    claimReason: "worker_reused_runtime_changed" as const,
  },
  triggerAttachments: [{
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    filename: "private-context.png",
    contentType: "image/png",
    byteSize: 42,
    url:
      "/organizations/77777777-7777-4777-8777-777777777777/channel-reply-claims/11111111-1111-4111-8111-111111111111/attachments/dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  }],
      memory: null,
      memoryLearningEnabled: false,
  snapshot: {
    channel: {
      id: common.runId,
      name: "Channel",
      slug: "channel",
      topic: null,
      defaultProjectId: "88888888-8888-4888-8888-888888888888",
    },
    agent: {
      id: agent.id,
      name: agent.name,
      responsibility: agent.responsibility,
      provider: agent.provider,
      model: agent.model,
      effort: agent.effort,
      projectId: "88888888-8888-4888-8888-888888888888",
    },
    project: {
      id: "88888888-8888-4888-8888-888888888888",
      name: "Briar",
    },
    projectTargets: [{
      id: "88888888-8888-4888-8888-888888888888",
      name: "Briar",
    }],
    executionTargets: [],
    messages: [],
  },
};

describe("Worker claim protobuf mapper", () => {
  it("preserves the typed channel scope, session reason, and timestamps", () => {
    const message = workerClaimMessage(channelReply as WorkerQueueClaim);
    expect(message.work.case).toBe("channelReply");
    if (message.work.case !== "channelReply") return;
    expect(message.work.value.scope?.scope.case).toBe("project");
    expect(message.work.value.session?.claimReason).toBe(
      ChannelReplySessionClaimReason.WORKER_REUSED_RUNTIME_CHANGED,
    );
    expect(timestampDate(message.work.value.claimedAt!).toISOString()).toBe(
      claimedAt,
    );

    const executionClaim = claimedWorkFromProto(message);
    expect(executionClaim).toMatchObject({
      workType: "channelReply",
      projectId: channelReply.projectId,
      scope: channelReply.scope,
      session: {
        claimReason: channelReply.session.claimReason,
        retainedUntil: channelReply.session.retainedUntil,
      },
      triggerAttachments: channelReply.triggerAttachments,
    });
  });
});
