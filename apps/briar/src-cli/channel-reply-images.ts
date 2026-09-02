import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { QueuedAttachment } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { matchChannelReplyAttachmentPath } from "../src/lib/channel-reply-attachment-path";
import { channelReplyClaimTokenHeader } from "../src/lib/channels-contract";
import {
  channelAttachmentMimeTypes,
  channelPdfContentType,
  validateChannelAttachments,
} from "../src/lib/channel-attachments";
import type { AgentImageAttachment } from "../src-agent/runner-attachments";

export const channelReplyAttachmentDirectoryName = ".briar-channel-attachments";

type ChannelReplyImageFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const supportedChannelReplyAttachmentTypes = new Set<string>(
  channelAttachmentMimeTypes.filter((contentType) =>
    contentType === channelPdfContentType ||
    contentType.startsWith("image/") && contentType !== "image/svg+xml"
  ),
);

const attachmentExtension = (contentType: string) =>
  contentType === "image/jpeg"
    ? "jpg"
    : contentType === channelPdfContentType
    ? "pdf"
    : contentType.slice("image/".length);

export function channelReplyAttachments(
  triggerAttachments: readonly QueuedAttachment[],
): QueuedAttachment[] {
  const unsupported = triggerAttachments.find(
    (attachment) => !supportedChannelReplyAttachmentTypes.has(attachment.contentType),
  );
  if (unsupported) {
    throw new Error(
      `Channel reply attachment type is unsupported: ${unsupported.contentType}`,
    );
  }
  const validationError = validateChannelAttachments(
    triggerAttachments.map((attachment) => ({
      name: attachment.filename,
      size: attachment.byteSize,
      type: attachment.contentType,
    })),
  );
  if (validationError) throw new Error(validationError);
  return [...triggerAttachments];
}

function channelReplyAttachmentUrl(input: {
  apiUrl: string;
  organizationId: string;
  workId: string;
  attachment: QueuedAttachment;
}) {
  const match = matchChannelReplyAttachmentPath(input.attachment.url);
  if (
    !match ||
    match.organizationId !== input.organizationId ||
    match.workId !== input.workId ||
    match.attachmentId !== input.attachment.id
  ) {
    throw new Error("Channel reply attachment URL is outside the active claim scope");
  }
  const apiUrl = new URL(input.apiUrl);
  const attachmentUrl = new URL(input.attachment.url, apiUrl);
  if (
    attachmentUrl.origin !== apiUrl.origin ||
    attachmentUrl.pathname !== input.attachment.url ||
    attachmentUrl.search !== "" ||
    attachmentUrl.hash !== ""
  ) {
    throw new Error("Channel reply attachment URL is outside the active claim scope");
  }
  return attachmentUrl;
}

export function channelReplyAttachmentDirectory(workspacePath: string) {
  return join(workspacePath, channelReplyAttachmentDirectoryName);
}

export async function downloadChannelReplyAttachments(input: {
  apiUrl: string;
  workerToken: string;
  organizationId: string;
  workId: string;
  claimToken: string;
  triggerAttachments: readonly QueuedAttachment[];
  workspacePath: string;
  fetcher?: ChannelReplyImageFetcher;
}) {
  const attachments = channelReplyAttachments(input.triggerAttachments);
  const directory = channelReplyAttachmentDirectory(input.workspacePath);
  if (attachments.length === 0) {
    return {
      directory,
      paths: [] as string[],
      imagePaths: [] as string[],
      filePaths: [] as string[],
      attachments: [] as AgentImageAttachment[],
    };
  }

  const fetcher = input.fetcher ?? fetch;
  const paths: string[] = [];
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    for (const attachment of attachments) {
      const response = await fetcher(
        channelReplyAttachmentUrl({
          apiUrl: input.apiUrl,
          organizationId: input.organizationId,
          workId: input.workId,
          attachment,
        }),
        {
          redirect: "error",
          headers: {
            Accept: attachment.contentType,
            Authorization: `Bearer ${input.workerToken}`,
            [channelReplyClaimTokenHeader]: input.claimToken,
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Channel reply attachment download failed (${response.status})`);
      }
      const responseType = response.headers.get("Content-Type")?.split(";", 1)[0];
      if (responseType !== attachment.contentType) {
        throw new Error("Channel reply attachment content type changed during download");
      }
      const contentLength = response.headers.get("Content-Length");
      if (contentLength !== null && Number(contentLength) !== attachment.byteSize) {
        throw new Error("Channel reply attachment size changed during download");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== attachment.byteSize) {
        throw new Error("Channel reply attachment size changed during download");
      }
      const path = join(
        directory,
        `${attachment.id}.${attachmentExtension(attachment.contentType)}`,
      );
      await writeFile(path, bytes, { mode: 0o600 });
      paths.push(path);
    }
    return {
      directory,
      paths,
      imagePaths: attachments.flatMap((attachment, index) =>
        attachment.contentType.startsWith("image/") ? [paths[index]!] : []
      ),
      filePaths: attachments.flatMap((attachment, index) =>
        attachment.contentType === channelPdfContentType ? [paths[index]!] : []
      ),
      attachments: attachments.flatMap((attachment, index) =>
        attachment.contentType.startsWith("image/")
          ? [{
              type: "image" as const,
              path: paths[index]!,
              name: attachment.filename,
              mimeType: attachment.contentType,
            }]
          : []
      ),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Private channel attachments must disappear before a detached analysis worktree is
 * removed. Keeping the operations in one helper makes that lifecycle ordering
 * explicit and testable for every success and failure path.
 */
export async function cleanupChannelReplyAttachments(
  directory: string,
  removeWorkspace?: () => Promise<void>,
) {
  await rm(directory, { recursive: true, force: true });
  await removeWorkspace?.();
}
