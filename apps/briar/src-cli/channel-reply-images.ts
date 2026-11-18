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

type ChannelReplyAttachmentForm = {
  extension: string;
  /** `image` is shown to the provider as a picture; `file` is only a workspace path. */
  kind: "image" | "file";
};

/**
 * How each attachment type the composer accepts reaches an Agent.
 *
 * The entry keys are the composer's own allowlist, so a type nobody can upload
 * cannot be listed here, and the coverage test below keeps the reverse true:
 * every uploadable type either has a form or is named unreadable. That pairing
 * is the point. This table knew only images and PDF when Markdown and text
 * became attachable (#1782), and the gap failed whole replies rather than the
 * single file it could not open.
 */
const channelReplyAttachmentFormEntries: readonly (readonly [
  (typeof channelAttachmentMimeTypes)[number],
  ChannelReplyAttachmentForm,
])[] = [
  ["image/jpeg", { extension: "jpg", kind: "image" }],
  ["image/png", { extension: "png", kind: "image" }],
  ["image/gif", { extension: "gif", kind: "image" }],
  ["image/webp", { extension: "webp", kind: "image" }],
  ["image/avif", { extension: "avif", kind: "image" }],
  [channelPdfContentType, { extension: "pdf", kind: "file" }],
  ["text/markdown", { extension: "md", kind: "file" }],
  ["text/plain", { extension: "txt", kind: "file" }],
];

const channelReplyAttachmentForms = new Map<string, ChannelReplyAttachmentForm>(
  channelReplyAttachmentFormEntries,
);

/**
 * SVG is the one uploadable type an Agent is never handed: it carries script,
 * and nothing behind this download renders it in a sandbox.
 */
export const unreadableChannelReplyAttachmentTypes = ["image/svg+xml"] as const;

/** Read by the test holding the two sets to a partition of the upload allowlist. */
export const channelReplyAttachmentCoverage = {
  readable: channelReplyAttachmentFormEntries.map(([contentType]) => contentType),
  unreadable: unreadableChannelReplyAttachmentTypes,
};

export type ReadableChannelReplyAttachment = {
  attachment: QueuedAttachment;
  form: ChannelReplyAttachmentForm;
};

/** What a trigger's attachments become once this turn decides what it can use. */
export type ChannelReplyAttachmentSplit = {
  readable: ReadableChannelReplyAttachment[];
  unreadable: QueuedAttachment[];
};

/**
 * Splits what this turn can hand the Agent from what it cannot. An attachment
 * with no form is reported, never thrown: the person still asked a question,
 * and answering it without that one file beats replying "답변을 생성하지
 * 못했습니다" to the whole turn.
 */
export function channelReplyAttachments(
  triggerAttachments: readonly QueuedAttachment[],
): ChannelReplyAttachmentSplit {
  // Count and size are the composer's policy, re-checked here against
  // server-supplied metadata. A violation is corrupt input rather than a file
  // this turn can simply do without, so it still stops the reply.
  const validationError = validateChannelAttachments(
    triggerAttachments.map((attachment) => ({
      name: attachment.filename,
      size: attachment.byteSize,
      type: attachment.contentType,
    })),
  );
  if (validationError) throw new Error(validationError);
  const readable: ReadableChannelReplyAttachment[] = [];
  const unreadable: QueuedAttachment[] = [];
  for (const attachment of triggerAttachments) {
    const form = channelReplyAttachmentForms.get(attachment.contentType);
    if (form) readable.push({ attachment, form });
    else unreadable.push(attachment);
  }
  return { readable, unreadable };
}

function channelReplyAttachmentUrl(input: {
  apiUrl: string;
  workspaceId: string;
  workId: string;
  attachment: QueuedAttachment;
}) {
  const match = matchChannelReplyAttachmentPath(input.attachment.url);
  if (
    !match ||
    match.workspaceId !== input.workspaceId ||
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

/**
 * What the Agent is told about a file it was sent but cannot open, so the reply
 * can say so instead of guessing at contents it never received.
 */
export type UnreadableChannelReplyAttachment = {
  filename: string;
  contentType: string;
};

const unreadableSummary = (
  attachments: readonly QueuedAttachment[],
): UnreadableChannelReplyAttachment[] =>
  attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType,
  }));

export async function downloadChannelReplyAttachments(input: {
  apiUrl: string;
  workerToken: string;
  workspaceId: string;
  workId: string;
  claimToken: string;
  triggerAttachments: readonly QueuedAttachment[];
  workspacePath: string;
  fetcher?: ChannelReplyImageFetcher;
}) {
  const { readable, unreadable } = channelReplyAttachments(input.triggerAttachments);
  const directory = channelReplyAttachmentDirectory(input.workspacePath);
  if (readable.length === 0) {
    return {
      directory,
      paths: [] as string[],
      imagePaths: [] as string[],
      filePaths: [] as string[],
      attachments: [] as AgentImageAttachment[],
      unreadable: unreadableSummary(unreadable),
    };
  }

  const fetcher = input.fetcher ?? fetch;
  const paths: string[] = [];
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    for (const { attachment, form } of readable) {
      const response = await fetcher(
        channelReplyAttachmentUrl({
          apiUrl: input.apiUrl,
          workspaceId: input.workspaceId,
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
      const path = join(directory, `${attachment.id}.${form.extension}`);
      await writeFile(path, bytes, { mode: 0o600 });
      paths.push(path);
    }
    return {
      directory,
      paths,
      imagePaths: readable.flatMap(({ form }, index) =>
        form.kind === "image" ? [paths[index]!] : []
      ),
      filePaths: readable.flatMap(({ form }, index) =>
        form.kind === "file" ? [paths[index]!] : []
      ),
      attachments: readable.flatMap(({ attachment, form }, index) =>
        form.kind === "image"
          ? [{
              type: "image" as const,
              path: paths[index]!,
              name: attachment.filename,
              mimeType: attachment.contentType,
            }]
          : []
      ),
      unreadable: unreadableSummary(unreadable),
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
