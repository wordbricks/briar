import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channelReplyClaimTokenHeader } from "../src/lib/channels-contract";
import {
  channelReplyImageDirectory,
  channelReplyImagesForTrigger,
  cleanupChannelReplyImages,
  downloadChannelReplyImages,
} from "./channel-reply-images";

const triggerMessageId = "11111111-1111-4111-8111-111111111111";
const attachmentId = "22222222-2222-4222-8222-222222222222";
const workId = "33333333-3333-4333-8333-333333333333";
const organizationId = "44444444-4444-4444-8444-444444444444";
const imageBytes = new Uint8Array([137, 80, 78, 71]);
const maxChannelReplyImageBytes = 20 * 1024 * 1024;
const snapshot = {
  snapshotVersion: 2,
  messages: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      attachments: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          filename: "unrelated.mov",
          contentType: "video/quicktime",
          byteSize: imageBytes.byteLength,
        },
      ],
    },
    {
      id: triggerMessageId,
      body: "@briar inspect this",
      attachments: [
        {
          id: attachmentId,
          filename: "private screen.png",
          contentType: "image/png",
          byteSize: imageBytes.byteLength,
          private: true,
        },
      ],
    },
  ],
};

const temporaryDirectories: string[] = [];

async function temporaryWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "briar-channel-images-"));
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

describe("channel reply image inputs", () => {
  it("selects mutable normalized images from a passthrough snapshot", () => {
    const images = channelReplyImagesForTrigger(snapshot, triggerMessageId);

    expect(images).toEqual([
      {
        id: attachmentId,
        filename: "private screen.png",
        contentType: "image/png",
        byteSize: imageBytes.byteLength,
      },
    ]);
    images[0]!.filename = "renamed.png";
    images.push({
      id: "77777777-7777-4777-8777-777777777777",
      filename: "second.webp",
      contentType: "image/webp",
      byteSize: 1,
    });
    expect(images).toHaveLength(2);
  });

  it("rejects invalid image identities, sizes, and batch lengths", () => {
    const trigger = snapshot.messages[1]!;
    for (const attachment of [
      { ...trigger.attachments[0], id: "not-a-uuid" },
      { ...trigger.attachments[0], byteSize: 0 },
      { ...trigger.attachments[0], byteSize: 1.5 },
      { ...trigger.attachments[0], byteSize: maxChannelReplyImageBytes + 1 },
    ]) {
      expect(() =>
        channelReplyImagesForTrigger({
          messages: [{ ...trigger, attachments: [attachment] }],
        }, triggerMessageId)
      ).toThrow();
    }

    expect(() =>
      channelReplyImagesForTrigger({
        messages: [{
          ...trigger,
          attachments: Array.from(
            { length: 6 },
            (_, index) => ({
              ...trigger.attachments[0],
              id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
            }),
          ),
        }],
      }, triggerMessageId)
    ).toThrow();
  });

  it("downloads a claimed image with Worker and claim credentials", async () => {
    const workspacePath = await temporaryWorkspace();
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        `https://api.example/organizations/${organizationId}/channel-reply-claims/${workId}/attachments/${attachmentId}`,
      );
      const headers = new Headers(init?.headers);
      expect(init?.redirect).toBe("error");
      expect(headers.get("Authorization")).toBe("Bearer briar_worker_secret");
      expect(headers.get(channelReplyClaimTokenHeader)).toBe(
        "briar_channel_claim_secret",
      );
      return new Response(imageBytes, {
        headers: { "Content-Type": "image/png" },
      });
    });

    const downloaded = await downloadChannelReplyImages({
      apiUrl: "https://api.example/",
      workerToken: "briar_worker_secret",
      organizationId,
      workId,
      claimToken: "briar_channel_claim_secret",
      triggerMessageId,
      snapshot,
      workspacePath,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(downloaded.paths).toEqual([
      join(channelReplyImageDirectory(workspacePath), `${attachmentId}.png`),
    ]);
    expect(downloaded.attachments).toEqual([
      {
        type: "image",
        path: downloaded.paths[0],
        name: "private screen.png",
        mimeType: "image/png",
      },
    ]);
    expect(new Uint8Array(await readFile(downloaded.paths[0]))).toEqual(imageBytes);
    expect((await stat(downloaded.paths[0])).mode & 0o777).toBe(0o600);
  });

  it("removes a partial private download when validation fails", async () => {
    const workspacePath = await temporaryWorkspace();
    await expect(
      downloadChannelReplyImages({
        apiUrl: "https://api.example",
        workerToken: "briar_worker_secret",
        organizationId,
        workId,
        claimToken: "briar_channel_claim_secret",
        triggerMessageId,
        snapshot,
        workspacePath,
        fetcher: async () =>
          new Response(new Uint8Array([1]), {
            headers: { "Content-Type": "image/png" },
          }),
      }),
    ).rejects.toThrow("size changed");
    await expect(access(channelReplyImageDirectory(workspacePath))).rejects.toThrow();
  });

  it("deletes private images before removing the analysis worktree", async () => {
    const workspacePath = await temporaryWorkspace();
    const fetcher = async () =>
      new Response(imageBytes, { headers: { "Content-Type": "image/png" } });
    const downloaded = await downloadChannelReplyImages({
      apiUrl: "https://api.example",
      workerToken: "briar_worker_secret",
      organizationId,
      workId,
      claimToken: "briar_channel_claim_secret",
      triggerMessageId,
      snapshot,
      workspacePath,
      fetcher,
    });
    const removeWorkspace = vi.fn(async () => {
      await expect(access(downloaded.directory)).rejects.toThrow();
    });

    await cleanupChannelReplyImages(downloaded.directory, removeWorkspace);

    expect(removeWorkspace).toHaveBeenCalledOnce();
  });

  it("does not retain private images when analysis worktree removal fails", async () => {
    const workspacePath = await temporaryWorkspace();
    const downloaded = await downloadChannelReplyImages({
      apiUrl: "https://api.example",
      workerToken: "briar_worker_secret",
      organizationId,
      workId,
      claimToken: "briar_channel_claim_secret",
      triggerMessageId,
      snapshot,
      workspacePath,
      fetcher: async () =>
        new Response(imageBytes, { headers: { "Content-Type": "image/png" } }),
    });

    await expect(
      cleanupChannelReplyImages(downloaded.directory, async () => {
        throw new Error("git worktree remove failed");
      }),
    ).rejects.toThrow("git worktree remove failed");
    await expect(access(downloaded.directory)).rejects.toThrow();
  });
});
