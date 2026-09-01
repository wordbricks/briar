import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { QueuedAttachmentSchema } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channelReplyClaimTokenHeader } from "../src/lib/channels-contract";
import {
  channelReplyImageDirectory,
  channelReplyImages,
  cleanupChannelReplyImages,
  downloadChannelReplyImages,
} from "./channel-reply-images";

const attachmentId = "22222222-2222-4222-8222-222222222222";
const workId = "33333333-3333-4333-8333-333333333333";
const organizationId = "44444444-4444-4444-8444-444444444444";
const imageBytes = new Uint8Array([137, 80, 78, 71]);
const maxChannelReplyImageBytes = 20 * 1024 * 1024;
const attachmentUrl =
  `/organizations/${organizationId}/channel-reply-claims/${workId}/attachments/${attachmentId}`;

const imageAttachment = (overrides: {
  id?: string;
  filename?: string;
  contentType?: string;
  byteSize?: number;
  url?: string;
} = {}) => create(QueuedAttachmentSchema, {
  id: overrides.id ?? attachmentId,
  filename: overrides.filename ?? "private screen.png",
  contentType: overrides.contentType ?? "image/png",
  byteSize: overrides.byteSize ?? imageBytes.byteLength,
  url: overrides.url ?? attachmentUrl,
});

const triggerAttachments = () => [imageAttachment()];

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
  it("enforces the bounded image policy on generated attachment metadata", () => {
    const attachment = imageAttachment();
    expect(channelReplyImages([attachment])).toEqual([attachment]);
    expect(() => channelReplyImages([
      imageAttachment({ contentType: "image/svg+xml" }),
    ])).toThrow("unsupported");
    expect(() => channelReplyImages([
      imageAttachment({ byteSize: maxChannelReplyImageBytes + 1 }),
    ])).toThrow("20MB");
    expect(() => channelReplyImages(Array.from(
      { length: 6 },
      (_, index) => imageAttachment({
        id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
      }),
    ))).toThrow("최대 5개");
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
      triggerAttachments: triggerAttachments(),
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

  it("does not send claim credentials to a server-issued URL outside the claim", async () => {
    const workspacePath = await temporaryWorkspace();
    const fetcher = vi.fn();
    await expect(downloadChannelReplyImages({
      apiUrl: "https://api.example",
      workerToken: "briar_worker_secret",
      organizationId,
      workId,
      claimToken: "briar_channel_claim_secret",
      triggerAttachments: [imageAttachment({ url: "https://evil.example/private.png" })],
      workspacePath,
      fetcher,
    })).rejects.toThrow("outside the active claim scope");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(access(channelReplyImageDirectory(workspacePath))).rejects.toThrow();
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
        triggerAttachments: triggerAttachments(),
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
      triggerAttachments: triggerAttachments(),
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
      triggerAttachments: triggerAttachments(),
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
