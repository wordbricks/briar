import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IssueAgentReplyProviderOutputSchema } from "../src/lib/agent-reply-contract";
import {
  collectIssueReplyAttachments,
  parseIssueReplyAgentResult,
} from "./issue-reply-attachments";
import { providerStructuredOutputContract } from "./structured-output-contract";

const temporaryDirectories: string[] = [];
const decodeIssueReplyJson = providerStructuredOutputContract(
  "codex",
  IssueAgentReplyProviderOutputSchema,
).decodeJson;

async function temporaryWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "briar-issue-reply-out-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("issue reply agent attachments", () => {
  it("extracts attachment paths without changing the issue reply result", () => {
    expect(parseIssueReplyAgentResult(JSON.stringify({
      reply: "Here is the mockup.",
      attachments: [" mockup.png "],
      proposedAction: null,
      executionProposal: null,
      skillExecutionProposal: null,
    }), decodeIssueReplyJson)).toEqual({
      result: {
        body: "Here is the mockup.",
        proposedAction: null,
        executionProposal: null,
        skillExecutionProposal: null,
      },
      attachmentPaths: ["mockup.png"],
    });
  });

  it("rejects Skill execution unless the server selected that authority", () => {
    const output = JSON.stringify({
      reply: "The saved Skill requires approval.",
      attachments: [],
      proposedAction: null,
      executionProposal: null,
      skillExecutionProposal: { type: "request_agent_skill_execute" },
    });

    expect(() => parseIssueReplyAgentResult(output, decodeIssueReplyJson)).toThrow(
      "Agent Skill execution target is not authorized",
    );
    expect(parseIssueReplyAgentResult(output, decodeIssueReplyJson, {
      allowSkillExecutionProposal: true,
    }).result.skillExecutionProposal).toEqual({
      type: "request_agent_skill_execute",
    });
  });

  it("reads validated workspace images and HTML artifacts", async () => {
    const workspacePath = await temporaryWorkspace();
    await writeFile(
      join(workspacePath, "mockup.png"),
      new Uint8Array([137, 80, 78, 71]),
    );
    await writeFile(join(workspacePath, "lesson.html"), "<h1>Lesson</h1>");
    await expect(collectIssueReplyAttachments({
      workspacePath,
      paths: ["mockup.png", "lesson.html"],
    })).resolves.toEqual([expect.objectContaining({
      name: "mockup.png",
      type: "image/png",
      size: 4,
    }), expect.objectContaining({
      name: "lesson.html",
      type: "text/html",
      size: 15,
    })]);
  });
});
