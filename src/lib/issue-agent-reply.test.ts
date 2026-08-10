import { describe, expect, it } from "vitest";
import {
  agentReplyParentMessageId,
  issueMentionAtCaret,
  issueMentionHandle,
  mentionsIssueHandle,
  mentionsBriar,
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

  it("applies the same continuation rule to worker-row shaped messages", () => {
    const thread = [
      {
        id: "thread-root",
        parentMessageId: null,
        body: "첫 질문",
        author: { provider: null },
      },
      {
        id: "agent-reply",
        parentMessageId: "thread-root",
        body: "현재 진행 중입니다.",
        author: { provider: "codex" },
      },
    ];

    expect(
      shouldBriarReply(thread, {
        body: "이어서 질문",
        parentMessageId: "thread-root",
      }),
    ).toBe(true);
    expect(
      shouldBriarReply([thread[0]], {
        body: "이어서 질문",
        parentMessageId: "thread-root",
      }),
    ).toBe(false);
    expect(
      shouldBriarReply(thread, {
        body: "별도의 새 메시지",
        parentMessageId: null,
      }),
    ).toBe(false);
  });

  it("continues replying to a nested reply when an ancestor is agent-authored", () => {
    const thread = [
      {
        id: "thread-root",
        parentMessageId: null,
        body: "첫 질문",
        author: { provider: null },
      },
      {
        id: "agent-reply",
        parentMessageId: "thread-root",
        body: "현재 진행 중입니다.",
        author: { provider: "codex" },
      },
      {
        id: "nested-reply",
        parentMessageId: "agent-reply",
        body: "자세히 알려줘",
        author: { provider: null },
      },
    ];

    expect(
      shouldBriarReply(thread, {
        body: "대댓글에 이어서 질문",
        parentMessageId: "nested-reply",
      }),
    ).toBe(true);
  });

  it("does not reply to a nested reply when no ancestor participated", () => {
    const thread = [
      {
        id: "thread-root",
        parentMessageId: null,
        body: "첫 질문",
        author: { provider: null },
      },
      {
        id: "reply-1",
        parentMessageId: "thread-root",
        body: "동료 답변",
        author: { provider: null },
      },
      {
        id: "nested-reply",
        parentMessageId: "reply-1",
        body: "동료 대댓글",
        author: { provider: null },
      },
    ];

    expect(
      shouldBriarReply(thread, {
        body: "동료 대댓글에 이어서",
        parentMessageId: "nested-reply",
      }),
    ).toBe(false);
  });

  it("continues replying to a nested reply whose parent is agent-authored", () => {
    const thread = [
      {
        id: "thread-root",
        parentMessageId: null,
        body: "첫 질문",
        author: { provider: null },
      },
      {
        id: "agent-reply",
        parentMessageId: "thread-root",
        body: "현재 진행 중입니다.",
        author: { provider: "grok" },
      },
    ];

    expect(
      shouldBriarReply(thread, {
        body: "답변의 대댓글",
        parentMessageId: "agent-reply",
      }),
    ).toBe(true);
  });

  it("recognizes a standalone @briar mention without matching email-like text", () => {
    expect(mentionsBriar("@briar 이 변경을 설명해 줘")).toBe(true);
    expect(mentionsBriar("Could you check this, @BRIAR?")).toBe(true);
    expect(mentionsBriar("owner@briar.example")).toBe(false);
    expect(mentionsBriar("@briard")).toBe(false);
  });

  it("builds member mention handles and recognizes selected mentions", () => {
    expect(
      issueMentionHandle({
        userId: "user-1",
        email: "Jay.Kim+dev@example.com",
      }),
    ).toBe("jay.kim-dev");
    expect(issueMentionAtCaret("ask @jay.k", 10)).toEqual({
      start: 4,
      end: 10,
      query: "jay.k",
    });
    expect(mentionsIssueHandle("@jay.kim-dev 확인해 주세요", "jay.kim-dev"))
      .toBe(true);
    expect(mentionsIssueHandle("owner@jay.kim-dev.example", "jay.kim-dev"))
      .toBe(false);
  });
});
