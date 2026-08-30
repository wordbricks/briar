import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectChannelReplyAttachments,
  parseChannelReplyAgentResult,
} from "./channel-reply-attachments";
import { parseDetachedJsonResult } from "./agent-runner";

const temporaryDirectories: string[] = [];

async function temporaryWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "briar-channel-reply-out-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("channel reply agent attachments", () => {
  it("strips workspace paths before the worker JSON contract is applied", () => {
    expect(parseChannelReplyAgentResult({
      body: "Here is the screen.",
      document: null,
      issueProposal: null,
      attachments: ["  screenshot.png  ", "modal.webp"],
    })).toEqual({
      result: {
        body: "Here is the screen.",
        document: null,
        issueProposal: null,
        issueBatchProposal: null,
        executionProposal: null,
        skillExecutionProposal: null,
        delegation: null,
      },
      attachmentPaths: ["screenshot.png", "modal.webp"],
    });
  });

  it("keeps ordinary replies compatible when attachments are omitted", () => {
    expect(parseChannelReplyAgentResult({
      body: "Answer",
      document: null,
      issueProposal: null,
    })).toMatchObject({
      result: { body: "Answer", delegation: null },
      attachmentPaths: [],
    });
  });

  it("rejects invalid attachment path lists", () => {
    const reply = {
      body: "Answer",
      document: null,
      issueProposal: null,
    };
    for (const attachments of [
      ["   "],
      ["a".repeat(4097)],
      Array.from({ length: 6 }, (_, index) => `screen-${index}.png`),
    ]) {
      expect(() =>
        parseChannelReplyAgentResult({ ...reply, attachments })
      ).toThrow();
    }
  });

  it("extracts channel issue proposals from pure, fenced, or mixed JSON", () => {
    const proposal = {
      body: "이슈 생성을 제안했습니다. 승인이 필요합니다.",
      attachments: [],
      document: null,
      issueProposal: {
        projectId: null,
        executeAfterCreate: false,
        issue: {
          title: "승인 컴포넌트 QA",
          description: null,
          priority: 2,
          status: "backlog",
        },
      },
      executionProposal: null,
      skillExecutionProposal: null,
      delegation: null,
      contextRequests: null,
    };
    const json = JSON.stringify(proposal);

    for (const response of [
      json,
      `\`\`\`json\n${json}\n\`\`\``,
      `제안 내용을 준비했습니다.\n\n\`\`\`json\n${json}\n\`\`\``,
    ]) {
      expect(parseChannelReplyAgentResult(parseDetachedJsonResult(response)))
        .toMatchObject({
          result: { issueProposal: proposal.issueProposal },
          attachmentPaths: [],
        });
    }
  });

  it("rejects invalid channel proposal shapes and multiple JSON objects", () => {
    const invalid = JSON.stringify({
      body: "Invalid proposal",
      attachments: [],
      document: null,
      issueProposal: {
        projectId: null,
        executeAfterCreate: false,
        issue: {
          title: "Out of range",
          description: null,
          priority: 9,
          status: "backlog",
        },
      },
      executionProposal: null,
      skillExecutionProposal: null,
      delegation: null,
      contextRequests: null,
    });
    expect(() =>
      parseChannelReplyAgentResult(parseDetachedJsonResult(invalid))
    ).toThrow();

    const valid = JSON.stringify({
      body: "Answer",
      attachments: [],
      document: null,
      issueProposal: null,
      executionProposal: null,
      skillExecutionProposal: null,
      delegation: null,
      contextRequests: null,
    });
    expect(() => parseDetachedJsonResult(`${valid}\n${valid}`)).toThrow(
      "exactly one JSON object",
    );

    expect(() =>
      parseChannelReplyAgentResult({
        ...JSON.parse(valid),
        unexpected: true,
      })
    ).toThrow();
  });

  it("keeps context lookup turns out of the durable reply contract", () => {
    expect(() =>
      parseChannelReplyAgentResult({
        body: null,
        attachments: [],
        document: null,
        issueProposal: null,
        executionProposal: null,
        skillExecutionProposal: null,
        delegation: null,
        contextRequests: [{
          resource: "issues",
          projectId: "project-1",
          detail: "summary",
          limit: 25,
          cursor: null,
        }],
      })
    ).toThrow("cannot request more context");
  });

  it("rejects a local path left on the worker completion contract", () => {
    expect(() =>
      parseChannelReplyAgentResult({
        body: "Answer",
        document: null,
        issueProposal: null,
        attachments: [{ path: "screenshot.png" }],
      }),
    ).toThrow();
  });

  it("reads validated workspace images and HTML artifacts", async () => {
    const workspacePath = await temporaryWorkspace();
    const imagePath = join(workspacePath, "screenshot.png");
    await writeFile(imagePath, new Uint8Array([137, 80, 78, 71]));
    await writeFile(join(workspacePath, "lesson.html"), "<h1>Lesson</h1>");

    const files = await collectChannelReplyAttachments({
      workspacePath,
      paths: ["screenshot.png", "lesson.html"],
    });
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      name: "screenshot.png",
      type: "image/png",
      size: 4,
    });
    expect(files[1]).toMatchObject({
      name: "lesson.html",
      type: "text/html",
      size: 15,
    });

  });

  it("rejects missing, escaped, or unsupported workspace paths", async () => {
    const workspacePath = await temporaryWorkspace();
    await writeFile(join(workspacePath, "notes.txt"), "not an image");
    await writeFile(join(workspacePath, "inside.png"), new Uint8Array([1, 2, 3]));
    const nestedDirectory = join(workspacePath, "shots");
    await mkdir(nestedDirectory);
    const outside = join(tmpdir(), `briar-channel-reply-outside-${Date.now()}.png`);
    temporaryDirectories.push(outside);
    await writeFile(outside, new Uint8Array([137, 80, 78, 71]));
    await symlink(outside, join(workspacePath, "escape.png"));

    await expect(
      collectChannelReplyAttachments({
        workspacePath,
        paths: ["missing.png"],
      }),
    ).rejects.toThrow("does not exist");
    await expect(
      collectChannelReplyAttachments({
        workspacePath,
        paths: ["notes.txt"],
      }),
    ).rejects.toThrow("must be images or HTML files");
    await expect(
      collectChannelReplyAttachments({
        workspacePath,
        paths: [outside],
      }),
    ).rejects.toThrow("outside the workspace");
    await expect(
      collectChannelReplyAttachments({
        workspacePath,
        paths: ["escape.png"],
      }),
    ).rejects.toThrow("outside the workspace");
    await expect(
      collectChannelReplyAttachments({
        workspacePath,
        paths: ["shots"],
      }),
    ).rejects.toThrow("not a file");
  });
});
