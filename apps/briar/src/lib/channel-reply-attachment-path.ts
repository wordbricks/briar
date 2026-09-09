const channelReplyAttachmentPathPattern =
  /^\/workspaces\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u;

export function channelReplyAttachmentPath(input: {
  workspaceId: string;
  workId: string;
  attachmentId: string;
}) {
  return `/workspaces/${input.workspaceId}/channel-reply-claims/${input.workId}/attachments/${input.attachmentId}`;
}

export function matchChannelReplyAttachmentPath(pathname: string) {
  const match = pathname.match(channelReplyAttachmentPathPattern);
  return match
    ? {
        workspaceId: match[1]!,
        workId: match[2]!,
        attachmentId: match[3]!,
      }
    : null;
}
