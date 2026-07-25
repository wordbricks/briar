import { describe, expect, it } from "vitest";
import {
  agentReplyParentMessageId,
  briarMentionAtCaret,
  issueAgentConversation,
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
});
