import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  channelReplyCompleteRequestBody,
  collectChannelReplyAttachments,
  parseChannelReplyAgentResult,
} from "./channel-reply-attachments";

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

  it("reads workspace images and keeps a JSON complete body when none exist", async () => {
    const workspacePath = await temporaryWorkspace();
    const imagePath = join(workspacePath, "screenshot.png");
    await writeFile(imagePath, new Uint8Array([137, 80, 78, 71]));

    const files = await collectChannelReplyAttachments({
      workspacePath,
      paths: ["screenshot.png"],
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: "screenshot.png",
      type: "image/png",
      size: 4,
    });

    const jsonBody = channelReplyCompleteRequestBody({
      organizationId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      claimToken: "briar_channel_claim_secret",
      result: parseChannelReplyAgentResult({
        body: "No image",
        document: null,
        issueProposal: null,
      }).result,
      attachments: [],
    });
    expect(typeof jsonBody).toBe("string");
    expect(JSON.parse(jsonBody as string)).not.toHaveProperty("attachments");

    const form = channelReplyCompleteRequestBody({
      organizationId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      claimToken: "briar_channel_claim_secret",
      result: parseChannelReplyAgentResult({
        body: "Here is the screen.",
        document: null,
        issueProposal: null,
      }).result,
      attachments: files,
    });
    expect(form).toBeInstanceOf(FormData);
    const payload = JSON.parse(String((form as FormData).get("complete")));
    expect(payload.result.body).toBe("Here is the screen.");
    expect(payload.result).not.toHaveProperty("attachments");
    expect((form as FormData).getAll("attachments")).toHaveLength(1);
  });

  it("rejects missing, escaped, or non-image workspace paths", async () => {
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
    ).rejects.toThrow("must be images");
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
