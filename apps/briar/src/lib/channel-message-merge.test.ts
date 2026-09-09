import { describe, expect, it } from "vitest";
import type {
  ChannelExecutionProposal,
  ChannelMessage,
} from "./channels-contract";
import type { AgentSkillExecutionProposal } from "../types";
import {
  mergeChannelMessages,
  mergeChannelMessageSnapshot,
  sortChannelMessagesForDisplay,
} from "./channel-message-merge";

const execution = (
  id: string,
  status: "pending" | "accepted",
): ChannelExecutionProposal => ({
  id,
  type: "request_issue_execute",
  status,
  projectId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  title: "Approval",
  createdAt: "2026-08-11T00:00:00.000Z",
  acceptedAt: status === "accepted" ? "2026-08-11T00:01:00.000Z" : null,
  requestedProvider: status === "accepted" ? "codex" : null,
  requestedModel: null,
  requestedEffort: null,
  requestedWorkerId: null,
  delegatedByAgentId: null,
  delegatedByAgentName: null,
});

const message = (
  executionProposal: ChannelExecutionProposal | null,
  skillExecutionProposal: AgentSkillExecutionProposal | null = null,
  id = "33333333-3333-4333-8333-333333333333",
): ChannelMessage => ({
  id,
  channelId: "44444444-4444-4444-8444-444444444444",
  parentMessageId: null,
  author: {
    type: "user",
    id: "user-1",
    name: "Jay",
    email: "jay@example.com",
    image: null,
  },
  body: "Approve it",
  blocks: [],
  mentionedUserIds: [],
  mentionedAgentIds: [],
  attachments: [],
  reactions: [],
  replyCount: 0,
  lastReplyAt: null,
  replyAuthors: [],
  subscribers: [],
  document: null,
  proposal: null,
  executionProposal,
  skillExecutionProposal,
  relay: null,
  createdAt: "2026-08-11T00:00:00.000Z",
});

const skillExecution = (
  id: string,
  status: "pending" | "accepted",
): AgentSkillExecutionProposal => ({
  id,
  type: "request_agent_skill_execute",
  status,
  projectId: "11111111-1111-4111-8111-111111111111",
  agentId: "55555555-5555-4555-8555-555555555555",
  agentName: "Release Agent",
  skillId: "66666666-6666-4666-8666-666666666666",
  skillName: "Deploy",
  request: "Deploy the app",
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

describe("mergeChannelMessages", () => {
  it("uses the server conversation sequence inside a durable DM span", () => {
    const author = {
      type: "agent",
      id: "agent-1",
      name: "Builder",
      provider: "codex",
      image: null,
    } as const;
    const second = {
      ...message(null, null, "message-2"),
      author,
      createdAt: "2026-08-11T00:00:01.000Z",
      dmMetadata: {
        batchId: "batch-1",
        partIndex: 1,
        conversationSequence: 2,
        purpose: "progress",
      } as const,
    };
    const first = {
      ...message(null, null, "message-1"),
      author,
      createdAt: "2026-08-11T00:00:02.000Z",
      dmMetadata: {
        batchId: "batch-1",
        partIndex: 0,
        conversationSequence: 1,
        purpose: "acknowledgement",
      } as const,
    };

    expect(sortChannelMessagesForDisplay([second, first]).map(({ id }) => id))
      .toEqual(["message-1", "message-2"]);
  });

  it("does not move durable DM parts across a legacy message", () => {
    const durable = (id: string, sequence: number, createdAt: string) => ({
      ...message(null, null, id),
      createdAt,
      dmMetadata: {
        batchId: "batch-1",
        partIndex: sequence - 1,
        conversationSequence: sequence,
        purpose: "progress",
      } as const,
    });
    const laterSequence = durable(
      "durable-2",
      2,
      "2026-08-11T00:00:01.000Z",
    );
    const legacy = {
      ...message(null, null, "legacy"),
      createdAt: "2026-08-11T00:00:02.000Z",
    };
    const earlierSequence = durable(
      "durable-1",
      1,
      "2026-08-11T00:00:03.000Z",
    );

    expect(
      sortChannelMessagesForDisplay([
        earlierSequence,
        legacy,
        laterSequence,
      ]).map(({ id }) => id),
    ).toEqual(["durable-2", "legacy", "durable-1"]);
  });

  it("keeps a pending local message until the snapshot includes it", () => {
    const optimistic = { ...message(null), optimistic: true };

    expect(mergeChannelMessageSnapshot([optimistic], [])).toEqual([optimistic]);
  });

  it("replaces a pending local message with the authoritative same-id row", () => {
    const optimistic = { ...message(null), body: "Sending", optimistic: true };
    const authoritative = { ...message(null), body: "Sent" };

    expect(mergeChannelMessageSnapshot([optimistic], [authoritative])).toEqual([
      authoritative,
    ]);
  });

  it("keeps accepted UI over a delayed pending snapshot of the same proposal", () => {
    const accepted = execution("execution-1", "accepted");
    expect(mergeChannelMessages(
      [message(accepted)],
      [message(execution("execution-1", "pending"))],
      [],
    )[0]?.executionProposal).toEqual(accepted);
  });

  it("honors authoritative removal after unassign or transfer", () => {
    expect(mergeChannelMessages(
      [message(execution("execution-1", "accepted"))],
      [message(null)],
      [],
    )[0]?.executionProposal).toBeNull();
  });

  it("replaces an accepted proposal when the server issues a new id", () => {
    const next = execution("execution-2", "pending");
    expect(mergeChannelMessages(
      [message(execution("execution-1", "accepted"))],
      [message(next)],
      [],
    )[0]?.executionProposal).toEqual(next);
  });

  it("keeps Skill acceptance monotonic independently from issue execution", () => {
    const acceptedIssue = execution("execution-1", "accepted");
    const acceptedSkill = skillExecution("skill-1", "accepted");
    const merged = mergeChannelMessages(
      [
        message(acceptedIssue, null, "message-issue"),
        message(null, acceptedSkill, "message-skill"),
      ],
      [
        message(execution("execution-1", "pending"), null, "message-issue"),
        message(null, skillExecution("skill-1", "pending"), "message-skill"),
      ],
      [],
    );
    expect(merged.find((item) => item.id === "message-issue")
      ?.executionProposal).toEqual(acceptedIssue);
    expect(merged.find((item) => item.id === "message-skill")
      ?.skillExecutionProposal).toEqual(acceptedSkill);
  });

  it("honors an authoritative Skill tombstone without clearing issue execution", () => {
    const acceptedIssue = execution("execution-1", "accepted");
    const merged = mergeChannelMessages(
      [
        message(acceptedIssue, null, "message-issue"),
        message(null, skillExecution("skill-1", "accepted"), "message-skill"),
      ],
      [
        message(acceptedIssue, null, "message-issue"),
        message(null, null, "message-skill"),
      ],
      [],
    );
    expect(merged.find((item) => item.id === "message-issue")
      ?.executionProposal).toEqual(acceptedIssue);
    expect(merged.find((item) => item.id === "message-skill")
      ?.skillExecutionProposal).toBeNull();
  });

  it("preserves local blob URLs on attachments when replacing an optimistic message", () => {
    const optimistic = {
      ...message(null),
      optimistic: true,
      attachments: [
        {
          id: "local-ref-1",
          filename: "photo.png",
          contentType: "image/png",
          byteSize: 1234,
          url: "blob:http://localhost/local-blob-1",
          imageWidth: null,
          imageHeight: null,
        },
      ],
    };
    const authoritative = {
      ...message(null),
      attachments: [
        {
          id: "server-upload-1",
          filename: "photo.png",
          contentType: "image/png",
          byteSize: 1234,
          url: "/workspaces/org-1/channels/chan-1/messages/msg-1/attachments/server-upload-1",
          imageWidth: null,
          imageHeight: null,
        },
      ],
    };
    const merged = mergeChannelMessages([optimistic], [authoritative], []);
    expect(merged[0]?.attachments).toEqual([
      {
        id: "server-upload-1",
        filename: "photo.png",
        contentType: "image/png",
        byteSize: 1234,
        url: "blob:http://localhost/local-blob-1",
        imageWidth: null,
        imageHeight: null,
      },
    ]);
  });
});
