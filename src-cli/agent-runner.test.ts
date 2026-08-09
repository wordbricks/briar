import { describe, expect, it } from "vitest";
import {
  boundedTranscriptPayload,
  createDetachedTranscriptSequencer,
  detachedAgentPrompt,
  detachedConversationIdFromPayload,
  detachedPayloadDirection,
  detachedIssueReplyPrompt,
  detachedProviderRequest,
  detachedProviderBlockedRunEvent,
  detachedProviderBlockFromPayload,
  detachedRunContinuationPrompt,
  detachedRunDisposition,
  detachedTranscriptSequence,
  detachedTranscriptPayload,
  issueReplyTextFromPayload,
  parseDetachedIssueReplyResult,
  shouldPersistDetachedTranscriptPayload,
} from "./agent-runner";

const agent = {
  id: "agent-1",
  name: "Release Agent",
  provider: "codex" as const,
  model: "gpt-5",
  effort: "high" as const,
  responsibility: "Ship the assigned issue.",
  skill: "# Release Agent",
};

describe("detached Agent runner", () => {
  it("builds a structured blocked handoff for an exhausted OpenCode free tier", () => {
    const block = detachedProviderBlockFromPayload({
      type: "blocked",
      reason: "free_tier_limit",
      provider: "opencode",
      message: "Free limit reached",
      nextRetryAt: "2026-08-06T00:00:00.864Z",
    });
    expect(block).not.toBeNull();

    const event = detachedProviderBlockedRunEvent({
      block: block!,
      runId: "run-42",
      attempt: 2,
      actor: "briar-worker:worker-1",
      repository: "briar",
      model: "opencode/deepseek-v4-flash-free",
      occurredAt: "2026-08-05T12:03:24.852Z",
    });

    expect(event.status).toBe("blocked");
    expect(event.eventKey).toBe("detached:2:agent-blocked:free_tier_limit");
    expect(event.structuredResult).toMatchObject({
      outcome: "blocked",
      humanActionRequired: true,
      dueAt: "2026-08-06T00:00:00.864Z",
    });
    expect(event.structuredResult.summary).toContain("무료 사용 한도가 소진");
    expect(event.structuredResult.nextAction).toContain("재시도");
    expect(event.detail).toContain("retry/free_tier_limit");
  });

  it("builds a structured blocked handoff for transient OpenCode overload", () => {
    const block = detachedProviderBlockFromPayload({
      type: "blocked",
      reason: "upstream_overloaded",
      provider: "opencode",
      message: "Streaming response failed: [503] The request queue is full.",
      nextRetryAt: null,
      statusCode: 503,
    });
    expect(block).not.toBeNull();

    const event = detachedProviderBlockedRunEvent({
      block: block!,
      runId: "run-503",
      attempt: 2,
      actor: "briar-worker:worker-1",
      repository: "briar",
      model: "opencode/deepseek-v4-flash-free",
      occurredAt: "2026-08-06T01:00:00.000Z",
    });

    expect(event.status).toBe("blocked");
    expect(event.eventKey).toBe("detached:2:agent-blocked:upstream_overloaded");
    expect(event.structuredResult).toMatchObject({
      outcome: "blocked",
      humanActionRequired: true,
      dueAt: null,
    });
    expect(event.structuredResult.summary).toContain("OpenCode 서비스가 혼잡");
    expect(event.structuredResult.nextAction).toContain("재시도");
    expect(event.structuredResult.nextAction).toContain("모델");
    expect(event.detail).toContain("transient HTTP 503");
  });

  it("appends retry and resume output in a distinct transcript sequence range", () => {
    expect(detachedTranscriptSequence(1, 1)).toBe(1);
    expect(detachedTranscriptSequence(1, 37)).toBe(37);
    expect(detachedTranscriptSequence(2, 1)).toBe(1_000_001);
    expect(detachedTranscriptSequence(3, 1)).toBe(2_000_001);
  });

  it("builds a neutral issue prompt when no logical Agent is assigned", () => {
    const prompt = detachedAgentPrompt({
      agent: null,
      snapshot: {
        sourceKey: "BRIAR-7",
        title: "Run on selected Worker",
      },
      workspacePath: "/worktree",
    });

    expect(prompt).toContain("Process the Briar issue BRIAR-7 on the selected Worker");
    expect(prompt).not.toContain("Briar Agent assigned");
  });

  it("uses the logical Agent configuration independently of a Worker", () => {
    const prompt = detachedAgentPrompt({
      agent,
      snapshot: {
        runId: "run-42",
        sourceKey: "BRIAR-42",
        title: "Detached execution",
        issueDescription: "Use the attached design.",
        briarIssueUrl:
          "https://briar-api.example/open/issues/project-1/run-42",
        attachments: [
          {
            filename: "design.png",
            localPath: "/runtime/attachments/run-42/design.png",
          },
        ],
        conversation: [
          {
            author: { name: "Jay", provider: null },
            body: "The mobile layout is the acceptance criterion.",
          },
        ],
        reviewFeedback: "Keep the summary concise and verify the mobile layout.",
      },
      workspacePath: "/worktree",
    });
    const launch = detachedProviderRequest({
      agent,
      prompt,
      workspacePath: "/worktree",
      fullAccess: false,
      agentBinary: "/bin/codex",
    });

    expect(prompt).toContain("Release Agent");
    expect(prompt).toContain("BRIAR-42");
    expect(prompt).toContain("Use the attached design.");
    expect(prompt).toContain("/runtime/attachments/run-42/design.png");
    expect(prompt).toContain("The mobile layout is the acceptance criterion.");
    expect(prompt).toContain(
      "include the durable snapshot's briarIssueUrl in the pull request description",
    );
    expect(prompt).toContain(
      "https://briar-api.example/open/issues/project-1/run-42",
    );
    expect(prompt).toContain("nontechnical PM or CEO");
    expect(prompt).toContain("observable completion condition");
    expect(prompt).toContain("available under View details");
    expect(prompt).toContain("absolute path in `$BRIAR_CLI`");
    expect(prompt).toContain("instead of the bare `briar` command");
    expect(prompt).toContain("structured blocked result");
    expect(prompt).toContain("briar run stage start");
    expect(prompt).toContain("briar run stage complete");
    expect(prompt).toContain("original problem and the specific data");
    expect(prompt).toContain("key implementation approach");
    expect(prompt).toContain("before-and-after operational or user impact");
    expect(prompt).toContain("relevant selection or decision criteria");
    expect(prompt).toContain("Adapt the explanation to the work performed");
    expect(prompt).toContain("fallback, recovery, or cleanup");
    expect(prompt).toContain("standalone Markdown explanation");
    expect(prompt).toContain("short `##` section headings");
    expect(prompt).toContain("bullet points under each section");
    expect(prompt).toContain("`**bold**` emphasis");
    expect(prompt).toContain("Do not return one uninterrupted block of prose");
    expect(prompt).toContain("never invent them");
    expect(prompt).toContain("briar run evidence add --image");
    expect(prompt).toContain("issue detail page");
    expect(prompt).toContain("outcome is `partial`");
    expect(prompt).toContain("short Markdown headings and bullet points");
    expect(prompt).toContain("reviewFeedback");
    expect(prompt).toContain("Keep the summary concise and verify the mobile layout.");
    expect(prompt).toContain("required acceptance criteria");
    expect(prompt).not.toContain("claimToken");
    expect(launch.kind).toBe("runner");
    expect(launch.request).toMatchObject({
      conversationId: null,
      sandboxMode: "workspaceWrite",
      codexBinary: "/bin/codex",
      model: "gpt-5",
      effort: "high",
    });
  });

  it("continues the same provider conversation on a follow-up turn", () => {
    const launch = detachedProviderRequest({
      agent,
      prompt: detachedRunContinuationPrompt({
        runId: "run-42",
        sourceKey: "BRIAR-42",
      }),
      workspacePath: "/worktree",
      fullAccess: true,
      conversationId: "thread-42",
      agentBinary: "/bin/codex",
    });

    expect(launch.request.conversationId).toBe("thread-42");
    expect(launch.request.message).toContain("still has an active claim");
    expect(launch.request.message).toContain("A prose final answer by itself does not finish");
  });

  it("extracts provider conversation IDs from session payloads", () => {
    expect(
      detachedConversationIdFromPayload({
        type: "session",
        sessionId: "thread-42",
      }),
    ).toBe("thread-42");
    expect(
      detachedConversationIdFromPayload({
        type: "event",
        event: {
          type: "conversationStarted",
          conversationId: "thread-43",
        },
      }),
    ).toBe("thread-43");
  });

  it("continues only while the claimed run remains active", () => {
    expect(detachedRunDisposition({ runId: "run-42" }, "run-42")).toBe(
      "continue",
    );
    expect(
      detachedRunDisposition(
        { runId: "run-42", terminalStatus: "completed" },
        "run-42",
      ),
    ).toBe("terminal");
    expect(detachedRunDisposition(undefined, "run-42")).toBe("released");
    expect(detachedRunDisposition({ runId: "run-new" }, "run-42")).toBe(
      "released",
    );
  });

  it("passes provider-neutral image attachments to every runner", () => {
    const attachments = [{
      type: "image" as const,
      path: "/worktree/.briar-channel-images/screen.png",
      name: "screen.png",
      mimeType: "image/png",
    }];
    const launch = detachedProviderRequest({
      agent,
      prompt: "Inspect the attached screenshot",
      workspacePath: "/worktree",
      fullAccess: false,
      readOnly: true,
      attachments,
      agentBinary: "/bin/codex",
    });
    expect(launch.request).toMatchObject({
      attachments,
      sandboxMode: "readOnly",
    });

    const claudeLaunch = detachedProviderRequest({
      agent: { ...agent, provider: "claude" },
      prompt: "Inspect the attached screenshot",
      workspacePath: "/worktree",
      fullAccess: false,
      readOnly: true,
      attachments,
      agentBinary: "/bin/claude",
    });
    expect(claudeLaunch.request).toMatchObject({ attachments });
  });

  it("prevents terminal-stage replay after the final checkpoint resumes", () => {
    const prompt = detachedAgentPrompt({
      agent,
      snapshot: {
        sourceKey: "BRIAR-99",
        title: "Finish terminal review",
      },
      workspacePath: "/worktree",
      startStage: null,
      resumeContext: {
        checkpointKey: "after-production",
        position: "after",
        revision: 4,
        terminalReviewOnly: true,
      },
    });

    expect(prompt).toContain("Do not execute the terminal stage again");
    expect(prompt).toContain("record only terminal completion");
  });

  it("uses the same noninteractive contract for standalone providers", () => {
    const launch = detachedProviderRequest({
      agent: { ...agent, provider: "claude", model: null },
      prompt: "work",
      workspacePath: "/worktree",
      fullAccess: true,
      agentBinary: "/bin/claude",
    });
    expect(launch.kind).toBe("runner");
    expect(launch.request).toMatchObject({
      approvalPolicy: "never",
      effort: "high",
      sandboxMode: "dangerFullAccess",
      claudeBinary: "/bin/claude",
    });
  });

  it("answers issue mentions read-only even without the issue worktree", () => {
    const prompt = detachedIssueReplyPrompt({
      snapshot: {
        run: { resultSummary: "Fixed the retry race.", branch: "briar/retry" },
        messages: [{ body: "@briar what changed?" }],
      },
      userMessage: "@briar what changed?",
      workspaceAvailable: false,
    });
    const launch = detachedProviderRequest({
      agent,
      prompt,
      workspacePath: "/connected-repository",
      fullAccess: false,
      readOnly: true,
      agentBinary: "/bin/codex",
    });

    expect(prompt).toContain("worktree is unavailable");
    expect(prompt).toContain("Fixed the retry race.");
    expect(prompt).toContain("@briar what changed?");
    expect(prompt).toContain("request_issue_rework");
    expect(prompt).toContain("request_issue_update");
    expect(prompt).toContain("request_issue_create");
    expect(prompt).toContain("confirmation button");
    expect(launch.kind).toBe("runner");
    expect(launch.request).toMatchObject({
      sandboxMode: "readOnly",
      codexBinary: "/bin/codex",
    });
  });

  it("parses a proposed completed-run revision without executing it", () => {
    expect(parseDetachedIssueReplyResult(JSON.stringify({
      reply: "D를 D′로 바꾸는 개정을 제안했습니다. 수락이 필요합니다.",
      proposedAction: {
        type: "request_issue_rework",
        workflowStage: "implementing",
        reason: "D를 D′로 변경하고 영향받는 QA를 다시 확인한다.",
      },
    }))).toEqual({
      reply: "D를 D′로 바꾸는 개정을 제안했습니다. 수락이 필요합니다.",
      proposedAction: {
        type: "request_issue_rework",
        workflowStage: "implementing",
        reason: "D를 D′로 변경하고 영향받는 QA를 다시 확인한다.",
      },
    });
    expect(parseDetachedIssueReplyResult("plain fallback")).toEqual({
      reply: "plain fallback",
      proposedAction: null,
    });
  });

  it("parses issue edit and creation proposals without applying them", () => {
    expect(parseDetachedIssueReplyResult(JSON.stringify({
      reply: "설명 변경을 제안했습니다. 수락해 주세요.",
      proposedAction: {
        type: "request_issue_update",
        changes: { description: "새 승인 기준", priority: 1 },
      },
    }))).toEqual({
      reply: "설명 변경을 제안했습니다. 수락해 주세요.",
      proposedAction: {
        type: "request_issue_update",
        changes: { description: "새 승인 기준", priority: 1 },
      },
    });
    expect(parseDetachedIssueReplyResult(JSON.stringify({
      reply: "후속 이슈 생성을 제안했습니다. 수락해 주세요.",
      proposedAction: {
        type: "request_issue_create",
        issue: {
          title: "후속 QA",
          description: null,
          priority: 2,
          status: "backlog",
        },
      },
    }))).toMatchObject({
      proposedAction: {
        type: "request_issue_create",
        issue: { title: "후속 QA", status: "backlog" },
      },
    });
  });

  it("extracts final replies from every detached provider event shape", () => {
    expect(
      issueReplyTextFromPayload({ type: "result", message: " Claude reply " }),
    ).toBe("Claude reply");
    expect(
      issueReplyTextFromPayload({
        type: "event",
        event: { type: "messageCompleted", text: "Grok reply" },
      }),
    ).toBe("Grok reply");
    expect(
      issueReplyTextFromPayload({
        type: "item.completed",
        item: { type: "agent_message", text: "Codex reply" },
      }),
    ).toBe("Codex reply");
    expect(
      issueReplyTextFromPayload({
        type: "event",
        raw: {
          method: "item/completed",
          params: {
            item: { type: "agentMessage", phase: "final_answer", text: "App Server reply" },
          },
        },
      }),
    ).toBe("App Server reply");
    expect(
      issueReplyTextFromPayload({
        type: "event",
        raw: {
          method: "turn/completed",
          params: {
            turn: {
              items: [
                { type: "agentMessage", phase: "commentary", text: "Working" },
                { type: "agentMessage", phase: "final_answer", text: "Final App Server reply" },
              ],
            },
          },
        },
      }),
    ).toBe("Final App Server reply");
  });

  it("bounds untrusted transcript payloads", () => {
    expect(boundedTranscriptPayload({ message: "ok" }, "ok")).toEqual({
      message: "ok",
    });
    expect(
      boundedTranscriptPayload({ message: "x".repeat(40_000) }, "x".repeat(40_000)),
    ).toMatchObject({ type: "truncated", originalBytes: 40_000 });
  });

  it("preserves runner event directions and exposes session starts", () => {
    const clientEvent = { type: "event", direction: "client", raw: {} };
    expect(detachedPayloadDirection(clientEvent)).toBe("client");
    expect(detachedPayloadDirection({ type: "event", raw: {} })).toBe("server");
    expect(
      detachedTranscriptPayload(
        { type: "session", sessionId: "thread-1" },
        '{"type":"session","sessionId":"thread-1"}',
      ),
    ).toEqual({
      type: "session",
      sessionId: "thread-1",
      event: { type: "conversationStarted", conversationId: "thread-1" },
    });
    expect(
      detachedTranscriptPayload(
        {
          type: "event",
          direction: "server",
          event: {
            type: "messageCompleted",
            id: "message-1",
            phase: "final_answer",
            text: "Done",
          },
          raw: { text: "x".repeat(40_000) },
        },
        "x".repeat(40_000),
      ),
    ).toMatchObject({
      type: "event",
      event: { type: "messageCompleted", id: "message-1" },
    });
  });

  it("keeps streaming message deltas ephemeral", () => {
    expect(
      shouldPersistDetachedTranscriptPayload({
        type: "event",
        event: { type: "messageDelta", id: "message-1", delta: "hello" },
      }),
    ).toBe(false);
    expect(
      shouldPersistDetachedTranscriptPayload({
        type: "messageDelta",
        id: "message-1",
        delta: "hello",
      }),
    ).toBe(false);
    expect(
      shouldPersistDetachedTranscriptPayload({
        type: "event",
        event: {
          type: "messageCompleted",
          id: "message-1",
          text: "hello",
        },
      }),
    ).toBe(true);
  });

  it("assigns transcript sequences only to persisted payloads", () => {
    const sequencer = createDetachedTranscriptSequencer(1);
    const delta = {
      type: "event",
      event: { type: "messageDelta", id: "message-1", delta: "x" },
    };
    for (let index = 0; index < 20_000; index += 1) {
      expect(sequencer.nextForPayload(delta)).toBeNull();
    }

    expect(
      sequencer.nextForPayload({
        type: "event",
        event: {
          type: "messageCompleted",
          id: "message-1",
          text: "done",
        },
      }),
    ).toBe(1);
    expect(sequencer.next()).toBe(2);
  });
});
