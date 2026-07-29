import { describe, expect, it } from "vitest";
import type { HuntRun } from "../types";
import {
  agentReplyParentMessageId,
  briarMentionAtCaret,
  issueAgentConversation,
  issueConversationSnapshot,
  mentionsBriar,
  providerForConversation,
  shouldBriarReply,
} from "./issue-agent-reply";

describe("issue agent replies", () => {
  it("places agent replies in the mention message thread", () => {
    expect(
      agentReplyParentMessageId({
        id: "root-mention",
        parentMessageId: null,
      }),
    ).toBe("root-mention");
    expect(
      agentReplyParentMessageId({
        id: "thread-mention",
        parentMessageId: "thread-root",
      }),
    ).toBe("thread-root");
  });

  it("continues replying in a thread where Briar was mentioned", () => {
    const rootMessage = {
      id: "thread-root",
      runId: "run-1",
      parentMessageId: null,
      body: "@briar 진행 상황을 알려줘",
      author: { id: "user-1", name: "User", image: null, provider: null },
      replyCount: 1,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    } as const;

    expect(
      shouldBriarReply([rootMessage], {
        body: "그 다음에는 어떻게 됐어?",
        parentMessageId: rootMessage.id,
      }),
    ).toBe(true);
    expect(
      shouldBriarReply([rootMessage], {
        body: "별도의 새 메시지",
        parentMessageId: null,
      }),
    ).toBe(false);
  });

  it("continues replying when Briar has already participated in the thread", () => {
    const agentReply = {
      id: "agent-reply",
      runId: "run-1",
      parentMessageId: "thread-root",
      body: "현재 진행 중입니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex",
      },
      replyCount: 0,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    } as const;

    expect(
      shouldBriarReply([agentReply], {
        body: "완료되면 알려줘",
        parentMessageId: "thread-root",
      }),
    ).toBe(true);
  });

  it("recognizes a standalone @briar mention without matching email-like text", () => {
    expect(mentionsBriar("@briar 이 변경을 설명해 줘")).toBe(true);
    expect(mentionsBriar("Could you check this, @BRIAR?")).toBe(true);
    expect(mentionsBriar("owner@briar.example")).toBe(false);
    expect(mentionsBriar("@briard")).toBe(false);
  });

  it("suggests @briar for a mention prefix at the caret", () => {
    expect(briarMentionAtCaret("@", 1)).toEqual({ start: 0, end: 1 });
    expect(briarMentionAtCaret("ask @br", 7)).toEqual({ start: 4, end: 7 });
    expect(briarMentionAtCaret("owner@", 6)).toBeNull();
    expect(briarMentionAtCaret("@other", 6)).toBeNull();
    expect(briarMentionAtCaret("@briar ", 7)).toBeNull();
  });

  it("resolves the provider encoded in a project-scoped conversation id", () => {
    expect(providerForConversation("project-1", "briar:project-1:thread-1"))
      .toBe("codex");
    expect(
      providerForConversation(
        "project-1",
        "briar:claude:project-1:session-1",
      ),
    ).toBe("claude");
    expect(
      providerForConversation(
        "project-1",
        "briar:grok:project-1:session-1",
      ),
    ).toBe("grok");
    expect(providerForConversation("project-2", "briar:project-1:thread-1"))
      .toBeNull();
  });

  it("uses the newest completed session that actually processed the issue", () => {
    expect(
      issueAgentConversation(
        [
          {
            projectId: "project-1",
            status: "completed",
            conversationId: "briar:project-1:skipped-thread",
            issues: [{ runId: "run-1", outcome: "skipped" }],
          },
          {
            projectId: "project-1",
            status: "completed",
            conversationId: "briar:claude:project-1:session-1",
            issues: [{ runId: "run-1", outcome: "completed" }],
          },
        ],
        "project-1",
        "run-1",
      ),
    ).toEqual({
      conversationId: "briar:claude:project-1:session-1",
      provider: "claude",
    });
  });

  it("starts a new project conversation when the issue has no prior session", () => {
    expect(issueAgentConversation([], "project-1", "run-1")).toEqual({
      conversationId: null,
      provider: null,
    });
  });

  it("preserves durable issue details needed after worktree cleanup", () => {
    const run = {
      id: "run-1",
      runNumber: 17,
      currentAttempt: 1,
      currentRevision: 1,
      source: "issue",
      sourceKey: "issue:17",
      title: "Clarify result urgency",
      issueDescription: "Explain the urgency recorded by the agent.",
      priority: 2,
      status: "completed",
      workflowStage: "local_qa",
      workflow: {
        version: 1,
        stages: [],
        execution: { stopAfterStage: "repository_workflow_pending" },
        completion: { requiredStages: [] },
      },
      progress: 100,
      detail: "All checks passed.",
      repository: "owner/repository",
      branch: "briar/clarify-urgency-11111111",
      commitSha: "abc123",
      tracker: null,
      attachments: [
        {
          id: "attachment-1",
          filename: "result.png",
          contentType: "image/png",
          byteSize: 2048,
          url: "https://example.invalid/private-result.png",
        },
      ],
      resultSummary: "The issue was completed.",
      structuredResult: {
        summary: "The issue was completed.",
        outcome: "completed",
        importance: "important",
        urgency: "time_sensitive",
        impact: "issue",
        humanActionRequired: false,
        nextAction: null,
        dueAt: null,
      },
      pullRequestUrls: ["https://example.invalid/pull/17"],
      targetSha: null,
      stagingQaStatus: null,
      productionQaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: { customerTier: "enterprise" },
      claimedBy: "agent-1",
      claimedAt: "2026-07-29T01:00:00.000Z",
      leaseExpiresAt: null,
      claimAttempts: 1,
      sourceCreatedAt: "2026-07-28T23:00:00.000Z",
      startedAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T02:00:00.000Z",
      completedAt: "2026-07-29T02:00:00.000Z",
      events: [],
    } as HuntRun;

    const snapshot = issueConversationSnapshot(run, []);

    expect(snapshot.run).toMatchObject({
      runId: "run-1",
      issueDescription: "Explain the urgency recorded by the agent.",
      structuredResult: {
        importance: "important",
        urgency: "time_sensitive",
      },
      context: { customerTier: "enterprise" },
      attachments: [
        {
          filename: "result.png",
          contentType: "image/png",
          byteSize: 2048,
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-result.png");
  });
});
