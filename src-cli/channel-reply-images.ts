import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { channelReplyClaimTokenHeader } from "../src/lib/channels-contract";
import type { AgentImageAttachment } from "../src-agent/runner-attachments";

export const channelReplyImageDirectoryName = ".briar-channel-images";
export { channelReplyClaimTokenHeader };

const maxChannelReplyImages = 5;
const maxChannelReplyImageBytes = 20 * 1024 * 1024;
const maxChannelReplyImageTotalBytes = 25 * 1024 * 1024;

const channelReplyImageSchema = z.object({
  id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  contentType: z.string().regex(/^image\/(?:avif|gif|jpeg|png|webp)$/u),
  byteSize: z.number().int().positive().max(maxChannelReplyImageBytes),
});

const channelReplySnapshotSchema = z
  .object({
    messages: z.array(
      z
        .object({
          id: z.string().uuid(),
          attachments: z.array(z.unknown()),
        })
        .passthrough(),
    ),
  })
  .passthrough();

type ChannelReplyImage = z.infer<typeof channelReplyImageSchema>;
type ChannelReplyImageFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const imageExtension = (contentType: string) =>
  contentType === "image/jpeg" ? "jpg" : contentType.slice("image/".length);

export function channelReplyImagesForTrigger(
  snapshot: Record<string, unknown>,
  triggerMessageId: string,
): ChannelReplyImage[] {
  const parsed = channelReplySnapshotSchema.parse(snapshot);
  const trigger = parsed.messages.find((message) => message.id === triggerMessageId);
  const images = z
    .array(channelReplyImageSchema)
    .max(maxChannelReplyImages)
    .parse(trigger?.attachments ?? []);
  const totalBytes = images.reduce((total, image) => total + image.byteSize, 0);
  if (totalBytes > maxChannelReplyImageTotalBytes) {
    throw new Error("Channel reply images exceed the total download limit");
  }
  return images;
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
  triggerMessageId: string;
  snapshot: Record<string, unknown>;
  workspacePath: string;
  fetcher?: ChannelReplyImageFetcher;
}) {
  const images = channelReplyImagesForTrigger(
    input.snapshot,
    input.triggerMessageId,
  );
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
        `${input.apiUrl.replace(/\/$/u, "")}/organizations/${input.organizationId}/channel-reply-claims/${input.workId}/attachments/${image.id}`,
        {
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
