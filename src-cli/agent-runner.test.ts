import { describe, expect, it } from "vitest";
import {
  boundedTranscriptPayload,
  detachedAgentPrompt,
  detachedIssueReplyPrompt,
  detachedProviderRequest,
  issueReplyTextFromPayload,
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
    expect(prompt).not.toContain("claimToken");
    expect(launch.arguments).toContain("workspace-write");
    expect(launch.arguments).toContain("gpt-5");
    expect(launch.arguments).toContain('model_reasoning_effort="high"');
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
    expect(launch.arguments).toContain("read-only");
    expect(launch.arguments).not.toContain("workspace-write");
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
  });

  it("bounds untrusted transcript payloads", () => {
    expect(boundedTranscriptPayload({ message: "ok" }, "ok")).toEqual({
      message: "ok",
    });
    expect(
      boundedTranscriptPayload({ message: "x".repeat(40_000) }, "x".repeat(40_000)),
    ).toMatchObject({ type: "truncated", originalBytes: 40_000 });
  });
});
