import { describe, expect, it } from "vitest";
import {
  agentReplyParentMessageId,
  issueMentionAtCaret,
  issueMentionHandle,
  issueReplyAgentIds,
  mentionsIssueHandle,
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

  it("routes every explicitly mentioned Project Agent", () => {
    expect(
      issueReplyAgentIds([], {
        mentionedAgentIds: ["agent-2", "agent-1", "agent-2"],
        parentMessageId: null,
      }),
    ).toEqual(["agent-2", "agent-1"]);
  });

  it("does not treat the old @briar alias as a routing signal", () => {
    expect(
      issueReplyAgentIds([], {
        parentMessageId: null,
      }),
    ).toEqual([]);
  });

  it("continues with every agent that participated in the same thread", () => {
    const thread = [
      {
        id: "thread-root",
        parentMessageId: null,
        body: "첫 질문",
        author: { agentId: null, provider: null },
      },
      {
        id: "codex-reply",
        parentMessageId: "thread-root",
        body: "Codex 답변",
        author: { agentId: "agent-codex", provider: "codex" },
      },
      {
        id: "claude-reply",
        parentMessageId: "thread-root",
        body: "Claude 답변",
        author: { agentId: "agent-claude", provider: "claude" },
      },
    ];

    expect(
      issueReplyAgentIds(thread, {
        parentMessageId: "thread-root",
      }),
    ).toEqual(["agent-codex", "agent-claude"]);
  });

  it("continues with an agent ancestor for nested replies", () => {
    const thread = [
      {
        id: "thread-root",
        parentMessageId: null,
        body: "첫 질문",
        author: { agentId: null, provider: null },
      },
      {
        id: "agent-reply",
        parentMessageId: "thread-root",
        body: "현재 진행 중입니다.",
        author: { agentId: "agent-1", provider: "codex" },
      },
      {
        id: "nested-reply",
        parentMessageId: "agent-reply",
        body: "자세히 알려줘",
        author: { agentId: null, provider: null },
      },
    ];

    expect(
      issueReplyAgentIds(thread, {
        parentMessageId: "nested-reply",
      }),
    ).toEqual(["agent-1"]);
  });

  it("does not continue from provider-only legacy messages", () => {
    expect(
      issueReplyAgentIds(
        [
          {
            id: "legacy-reply",
            parentMessageId: "thread-root",
            body: "기존 답변",
            author: { agentId: null, provider: "codex" },
          },
        ],
        { parentMessageId: "thread-root" },
      ),
    ).toEqual([]);
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
