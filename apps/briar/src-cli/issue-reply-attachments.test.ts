import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Predicate from "effect/Predicate";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectIssueReplyAttachments,
  issueReplyCompleteRequestBody,
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
  it("extracts image paths without changing the existing issue reply result", () => {
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

  it("keeps legacy plain-text issue replies compatible", () => {
    expect(parseIssueReplyAgentResult("An ordinary answer.")).toEqual({
      result: {
        reply: "An ordinary answer.",
        proposedAction: null,
        executionProposal: null,
        skillExecutionProposal: null,
      },
      attachmentPaths: [],
    });
  });

  it("reads workspace images and emits the shared multipart contract", async () => {
    const workspacePath = await temporaryWorkspace();
    await writeFile(
      join(workspacePath, "mockup.png"),
      new Uint8Array([137, 80, 78, 71]),
    );
    const attachments = await collectIssueReplyAttachments({
      workspacePath,
      paths: ["mockup.png"],
    });
    const body = issueReplyCompleteRequestBody({
      projectId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      claimToken: `briar_reply_claim_${"a".repeat(64)}`,
      result: {
        reply: "Here is the mockup.",
        proposedAction: null,
        executionProposal: null,
        skillExecutionProposal: null,
      },
      attachments,
    });

    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(JSON.parse(String(form.get("complete")))).toMatchObject({
      body: "Here is the mockup.",
    });
    expect(form.getAll("attachments")).toHaveLength(1);
    expect(form.get("attachments")).toMatchObject({
      name: "mockup.png",
      type: "image/png",
      size: 4,
    });
  });

  it("keeps JSON completion when there are no images", () => {
    const body = issueReplyCompleteRequestBody({
      projectId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      claimToken: `briar_reply_claim_${"b".repeat(64)}`,
      result: {
        reply: "Answer",
        proposedAction: null,
        executionProposal: null,
        skillExecutionProposal: null,
      },
      attachments: [],
    });

    if (!Predicate.isString(body)) {
      throw new Error("attachment-free issue replies must use a JSON body");
    }
    expect(JSON.parse(body)).toMatchObject({ body: "Answer" });
  });
});
