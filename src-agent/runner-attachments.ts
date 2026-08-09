import { readFile } from "node:fs/promises";

export type AgentImageAttachment = {
  type: "image";
  path: string;
  name: string;
  mimeType: string;
};

export type AgentAttachment = AgentImageAttachment;

export type DownloadedImageLike = {
  filename: string;
  contentType: string;
  localPath: string | null;
};

export function agentImageAttachments(
  attachments: readonly DownloadedImageLike[],
): AgentImageAttachment[] {
  return attachments.flatMap((attachment) =>
    attachment.localPath && attachment.contentType.startsWith("image/")
      ? [{
          type: "image" as const,
          path: attachment.localPath,
          name: attachment.filename,
          mimeType: attachment.contentType,
        }]
      : [],
  );
}

export async function readAgentImage(
  attachment: AgentImageAttachment,
): Promise<Uint8Array> {
  if (!attachment.mimeType.startsWith("image/")) {
    throw new Error(`Unsupported agent attachment type '${attachment.mimeType}'`);
  }
  const bytes = await readFile(attachment.path);
  if (bytes.byteLength === 0) {
    throw new Error(`Agent image attachment is empty: ${attachment.name}`);
  }
  return bytes;
}
