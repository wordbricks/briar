import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectIssueReplyAttachments,
  parseIssueReplyAgentResult,
} from "./issue-reply-attachments";

const temporaryDirectories: string[] = [];

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
    }))).toEqual({
      result: {
        reply: "Here is the mockup.",
        proposedAction: null,
        executionProposal: null,
        skillExecutionProposal: null,
      },
      attachmentPaths: ["mockup.png"],
    });
  });

  it("rejects non-structured issue replies", () => {
    expect(() => parseIssueReplyAgentResult("An ordinary answer.")).toThrow(
      "exactly one JSON object",
    );
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
