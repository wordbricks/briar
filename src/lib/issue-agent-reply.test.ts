import { describe, expect, it } from "vitest";
import {
  agentReplyParentMessageId,
  briarMentionAtCaret,
  issueAgentConversation,
  mentionsBriar,
  providerForConversation,
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
