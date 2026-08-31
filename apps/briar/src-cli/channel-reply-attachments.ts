import { collectReplyAttachments } from "./reply-attachments";

/**
 * Read reply attachments before the disposable workspace is deleted. Paths stay
 * inside that workspace so a model cannot attach an arbitrary host file.
 */
export async function collectChannelReplyAttachments(input: {
  workspacePath: string;
  paths: readonly string[];
}): Promise<File[]> {
  return collectReplyAttachments({
    ...input,
    replyLabel: "Channel reply",
  });
}
