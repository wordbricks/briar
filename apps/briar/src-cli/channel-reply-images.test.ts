import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { QueuedAttachmentSchema } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channelReplyClaimTokenHeader } from "../src/lib/channels-contract";
import { channelAttachmentMimeTypes } from "../src/lib/channel-attachments";
import {
  channelReplyAttachmentCoverage,
  channelReplyAttachmentDirectory,
  channelReplyAttachments,
  cleanupChannelReplyAttachments,
  downloadChannelReplyAttachments,
} from "./channel-reply-images";

const attachmentId = "22222222-2222-4222-8222-222222222222";
const workId = "33333333-3333-4333-8333-333333333333";
const workspaceId = "44444444-4444-4444-8444-444444444444";
const imageBytes = new Uint8Array([137, 80, 78, 71]);
const maxChannelReplyImageBytes = 20 * 1024 * 1024;
const attachmentUrl =
  `/workspaces/${workspaceId}/channel-reply-claims/${workId}/attachments/${attachmentId}`;

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

describe("channel reply attachment inputs", () => {
  it("accepts every attachment type the composer offers, and keeps the count and size policy", () => {
    const attachment = imageAttachment();
    expect(channelReplyAttachments([attachment])).toEqual({
      readable: [{ attachment, form: { extension: "png", kind: "image" } }],
      unreadable: [],
    });
    expect(channelReplyAttachments([
      imageAttachment({ contentType: "application/pdf", filename: "brief.pdf" }),
    ]).readable).toHaveLength(1);
    expect(channelReplyAttachments([
      imageAttachment({ contentType: "text/markdown", filename: "Terms.md" }),
      imageAttachment({ contentType: "text/plain", filename: "notes.txt" }),
    ]).readable.map(({ form }) => form)).toEqual([
      { extension: "md", kind: "file" },
      { extension: "txt", kind: "file" },
    ]);
    expect(() => channelReplyAttachments([
      imageAttachment({ byteSize: maxChannelReplyImageBytes + 1 }),
    ])).toThrow("20MB");
    expect(() => channelReplyAttachments(Array.from(
      { length: 6 },
      (_, index) => imageAttachment({
        id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
      }),
    ))).toThrow("최대 5개");
  });

  // The bug this file exists to prevent: a type became attachable in the
  // composer, this path did not learn it, and the whole reply failed.
  it("decides every composer type as either readable or deliberately unreadable", () => {
    expect([...channelReplyAttachmentCoverage.readable].concat(
      channelReplyAttachmentCoverage.unreadable,
    ).sort()).toEqual([...channelAttachmentMimeTypes].sort());
  });

  it("reports an attachment it will not hand over instead of failing the reply", async () => {
    const workspacePath = await temporaryWorkspace();
    const svg = imageAttachment({
      contentType: "image/svg+xml",
      filename: "diagram.svg",
    });
    const fetcher = vi.fn();

    const downloaded = await downloadChannelReplyAttachments({
      apiUrl: "https://api.example/",
      workerToken: "briar_worker_secret",
      workspaceId,
      workId,
      claimToken: "briar_channel_claim_secret",
      triggerAttachments: [svg],
      workspacePath,
      fetcher,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(downloaded.paths).toEqual([]);
    expect(downloaded.unreadable).toEqual([
      { filename: "diagram.svg", contentType: "image/svg+xml" },
    ]);
  });

  it("downloads Markdown alongside an image and keeps it off the provider image list", async () => {
    const workspacePath = await temporaryWorkspace();
    const markdownBytes = new TextEncoder().encode("# Terms\n\nprivate draft");
    const markdownId = "88888888-8888-4888-8888-888888888888";
    const markdown = imageAttachment({
      id: markdownId,
      filename: "Terms.md",
      contentType: "text/markdown",
      byteSize: markdownBytes.byteLength,
      url:
        `/workspaces/${workspaceId}/channel-reply-claims/${workId}/attachments/${markdownId}`,
    });

    const downloaded = await downloadChannelReplyAttachments({
      apiUrl: "https://api.example/",
      workerToken: "briar_worker_secret",
      workspaceId,
      workId,
      claimToken: "briar_channel_claim_secret",
      triggerAttachments: [imageAttachment(), markdown],
      workspacePath,
      fetcher: async (url) =>
        String(url).endsWith(markdownId)
          ? new Response(markdownBytes, {
              headers: { "Content-Type": "text/markdown; charset=utf-8" },
            })
          : new Response(imageBytes, { headers: { "Content-Type": "image/png" } }),
    });

    const directory = channelReplyAttachmentDirectory(workspacePath);
    const markdownPath = join(directory, `${markdownId}.md`);
    expect(downloaded.paths).toEqual([join(directory, `${attachmentId}.png`), markdownPath]);
    expect(downloaded.imagePaths).toEqual([join(directory, `${attachmentId}.png`)]);
    expect(downloaded.filePaths).toEqual([markdownPath]);
    expect(downloaded.attachments.map(({ name }) => name)).toEqual(["private screen.png"]);
    expect(downloaded.unreadable).toEqual([]);
    expect(new Uint8Array(await readFile(markdownPath))).toEqual(markdownBytes);
    expect((await stat(markdownPath)).mode & 0o777).toBe(0o600);
  });

  it("downloads a claimed image with Worker and claim credentials", async () => {
    const workspacePath = await temporaryWorkspace();
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        `https://api.example/workspaces/${workspaceId}/channel-reply-claims/${workId}/attachments/${attachmentId}`,
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

    const downloaded = await downloadChannelReplyAttachments({
      apiUrl: "https://api.example/",
      workerToken: "briar_worker_secret",
      workspaceId,
      workId,
      claimToken: "briar_channel_claim_secret",
      triggerAttachments: triggerAttachments(),
      workspacePath,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(downloaded.paths).toEqual([
      join(channelReplyAttachmentDirectory(workspacePath), `${attachmentId}.png`),
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

  it("downloads a PDF into the isolated workspace without sending it as a provider image", async () => {
    const workspacePath = await temporaryWorkspace();
    const pdfBytes = new TextEncoder().encode("%PDF-1.7\nprivate brief");
    const pdf = imageAttachment({
      filename: "private brief.pdf",
      contentType: "application/pdf",
      byteSize: pdfBytes.byteLength,
    });
    const downloaded = await downloadChannelReplyAttachments({
      apiUrl: "https://api.example/",
      workerToken: "briar_worker_secret",
      workspaceId,
      workId,
      claimToken: "briar_channel_claim_secret",
      triggerAttachments: [pdf],
      workspacePath,
      fetcher: async () => new Response(pdfBytes, {
        headers: { "Content-Type": "application/pdf" },
      }),
    });

    const expectedPath = join(
      channelReplyAttachmentDirectory(workspacePath),
      `${attachmentId}.pdf`,
    );
    expect(downloaded.paths).toEqual([expectedPath]);
    expect(downloaded.imagePaths).toEqual([]);
    expect(downloaded.filePaths).toEqual([expectedPath]);
    expect(downloaded.attachments).toEqual([]);
    expect(new Uint8Array(await readFile(expectedPath))).toEqual(pdfBytes);
    expect((await stat(expectedPath)).mode & 0o777).toBe(0o600);
  });

  it("does not send claim credentials to a server-issued URL outside the claim", async () => {
    const workspacePath = await temporaryWorkspace();
    const fetcher = vi.fn();
    await expect(downloadChannelReplyAttachments({
      apiUrl: "https://api.example",
      workerToken: "briar_worker_secret",
      workspaceId,
      workId,
      claimToken: "briar_channel_claim_secret",
      triggerAttachments: [imageAttachment({ url: "https://evil.example/private.png" })],
      workspacePath,
      fetcher,
    })).rejects.toThrow("outside the active claim scope");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(access(channelReplyAttachmentDirectory(workspacePath))).rejects.toThrow();
  });

  it("removes a partial private download when validation fails", async () => {
    const workspacePath = await temporaryWorkspace();
    await expect(
      downloadChannelReplyAttachments({
        apiUrl: "https://api.example",
        workerToken: "briar_worker_secret",
        workspaceId,
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
    await expect(access(channelReplyAttachmentDirectory(workspacePath))).rejects.toThrow();
  });

  it("deletes private images before removing the analysis worktree", async () => {
    const workspacePath = await temporaryWorkspace();
    const fetcher = async () =>
      new Response(imageBytes, { headers: { "Content-Type": "image/png" } });
    const downloaded = await downloadChannelReplyAttachments({
      apiUrl: "https://api.example",
      workerToken: "briar_worker_secret",
      workspaceId,
      workId,
      claimToken: "briar_channel_claim_secret",
      triggerAttachments: triggerAttachments(),
      workspacePath,
      fetcher,
    });
    const removeWorkspace = vi.fn(async () => {
      await expect(access(downloaded.directory)).rejects.toThrow();
    });

    await cleanupChannelReplyAttachments(downloaded.directory, removeWorkspace);

    expect(removeWorkspace).toHaveBeenCalledOnce();
  });

  it("does not retain private images when analysis worktree removal fails", async () => {
    const workspacePath = await temporaryWorkspace();
    const downloaded = await downloadChannelReplyAttachments({
      apiUrl: "https://api.example",
      workerToken: "briar_worker_secret",
      workspaceId,
      workId,
      claimToken: "briar_channel_claim_secret",
      triggerAttachments: triggerAttachments(),
      workspacePath,
      fetcher: async () =>
        new Response(imageBytes, { headers: { "Content-Type": "image/png" } }),
    });

    await expect(
      cleanupChannelReplyAttachments(downloaded.directory, async () => {
        throw new Error("git worktree remove failed");
      }),
    ).rejects.toThrow("git worktree remove failed");
    await expect(access(downloaded.directory)).rejects.toThrow();
  });
});
