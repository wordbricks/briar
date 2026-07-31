import { describe, expect, it } from "vitest";
import {
  boundedTranscriptPayload,
  detachedAgentPrompt,
  detachedProviderRequest,
} from "./agent-runner";

const agent = {
  id: "agent-1",
  name: "Release Agent",
  provider: "codex" as const,
  model: "gpt-5",
  responsibility: "Ship the assigned issue.",
  skill: "# Release Agent",
};

describe("detached Agent runner", () => {
  it("uses the logical Agent configuration independently of a Worker", () => {
    const prompt = detachedAgentPrompt({
      agent,
      snapshot: {
        runId: "run-42",
        sourceKey: "BRIAR-42",
        title: "Detached execution",
        issueDescription: "Use the attached design.",
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
    expect(prompt).toContain("nontechnical PM or CEO");
    expect(prompt).toContain("observable completion condition");
    expect(prompt).toContain("available under View details");
    expect(prompt).toContain("structured blocked result");
    expect(prompt).not.toContain("claimToken");
    expect(launch.arguments).toContain("workspace-write");
    expect(launch.arguments).toContain("gpt-5");
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
      sandboxMode: "dangerFullAccess",
      claudeBinary: "/bin/claude",
    });
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
