import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { QueuedAttachment } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { matchChannelReplyAttachmentPath } from "../src/lib/channel-reply-attachment-path";
import { channelReplyClaimTokenHeader } from "../src/lib/channels-contract";
import {
  issueAttachmentMimeTypes,
  validateIssueAttachments,
} from "../src/lib/issue-attachments";
import type { AgentImageAttachment } from "../src-agent/runner-attachments";

export const channelReplyImageDirectoryName = ".briar-channel-images";

type ChannelReplyImageFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const supportedChannelReplyImageTypes = new Set<string>(
  issueAttachmentMimeTypes.filter(
    (contentType) => contentType.startsWith("image/") &&
      contentType !== "image/svg+xml",
  ),
);

const imageExtension = (contentType: string) =>
  contentType === "image/jpeg" ? "jpg" : contentType.slice("image/".length);

export function channelReplyImages(
  triggerAttachments: readonly QueuedAttachment[],
): QueuedAttachment[] {
  const unsupported = triggerAttachments.find(
    (attachment) => !supportedChannelReplyImageTypes.has(attachment.contentType),
  );
  if (unsupported) {
    throw new Error(
      `Channel reply image type is unsupported: ${unsupported.contentType}`,
    );
  }
  const validationError = validateIssueAttachments(
    triggerAttachments.map((attachment) => ({
      name: attachment.filename,
      size: attachment.byteSize,
      type: attachment.contentType,
    })),
  );
  if (validationError) throw new Error(validationError);
  return [...triggerAttachments];
}

function channelReplyImageUrl(input: {
  apiUrl: string;
  organizationId: string;
  workId: string;
  image: QueuedAttachment;
}) {
  const match = matchChannelReplyAttachmentPath(input.image.url);
  if (
    !match ||
    match.organizationId !== input.organizationId ||
    match.workId !== input.workId ||
    match.attachmentId !== input.image.id
  ) {
    throw new Error("Channel reply image URL is outside the active claim scope");
  }
  const apiUrl = new URL(input.apiUrl);
  const imageUrl = new URL(input.image.url, apiUrl);
  if (
    imageUrl.origin !== apiUrl.origin ||
    imageUrl.pathname !== input.image.url ||
    imageUrl.search !== "" ||
    imageUrl.hash !== ""
  ) {
    throw new Error("Channel reply image URL is outside the active claim scope");
  }
  return imageUrl;
}

export function channelReplyImageDirectory(workspacePath: string) {
  return join(workspacePath, channelReplyImageDirectoryName);
}

export async function downloadChannelReplyImages(input: {
  apiUrl: string;
  workerToken: string;
  organizationId: string;
  workId: string;
  claimToken: string;
  triggerAttachments: readonly QueuedAttachment[];
  workspacePath: string;
  fetcher?: ChannelReplyImageFetcher;
}) {
  const images = channelReplyImages(input.triggerAttachments);
  const directory = channelReplyImageDirectory(input.workspacePath);
  if (images.length === 0) {
    return {
      directory,
      paths: [] as string[],
      attachments: [] as AgentImageAttachment[],
    };
  }

  const fetcher = input.fetcher ?? fetch;
  const paths: string[] = [];
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    for (const image of images) {
      const response = await fetcher(
        channelReplyImageUrl({
          apiUrl: input.apiUrl,
          organizationId: input.organizationId,
          workId: input.workId,
          image,
        }),
        {
          redirect: "error",
          headers: {
            Accept: image.contentType,
            Authorization: `Bearer ${input.workerToken}`,
            [channelReplyClaimTokenHeader]: input.claimToken,
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Channel reply image download failed (${response.status})`);
      }
      const responseType = response.headers.get("Content-Type")?.split(";", 1)[0];
      if (responseType !== image.contentType) {
        throw new Error("Channel reply image content type changed during download");
      }
      const contentLength = response.headers.get("Content-Length");
      if (contentLength !== null && Number(contentLength) !== image.byteSize) {
        throw new Error("Channel reply image size changed during download");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== image.byteSize) {
        throw new Error("Channel reply image size changed during download");
      }
      const path = join(
        directory,
        `${image.id}.${imageExtension(image.contentType)}`,
      );
      await writeFile(path, bytes, { mode: 0o600 });
      paths.push(path);
    }
    return {
      directory,
      paths,
      attachments: images.map((image, index) => ({
        type: "image" as const,
        path: paths[index]!,
        name: image.filename,
        mimeType: image.contentType,
      })),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Private channel images must disappear before a detached analysis worktree is
 * removed. Keeping the operations in one helper makes that lifecycle ordering
 * explicit and testable for every success and failure path.
 */
export async function cleanupChannelReplyImages(
  directory: string,
  removeWorkspace?: () => Promise<void>,
) {
  await rm(directory, { recursive: true, force: true });
  await removeWorkspace?.();
}
