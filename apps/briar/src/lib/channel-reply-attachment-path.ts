const channelReplyAttachmentPathPattern =
  /^\/organizations\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u;

export function channelReplyAttachmentPath(input: {
  organizationId: string;
  workId: string;
  attachmentId: string;
}) {
  return `/organizations/${input.organizationId}/channel-reply-claims/${input.workId}/attachments/${input.attachmentId}`;
}

export function matchChannelReplyAttachmentPath(pathname: string) {
  const match = pathname.match(channelReplyAttachmentPathPattern);
  return match
    ? {
        organizationId: match[1]!,
        workId: match[2]!,
        attachmentId: match[3]!,
      }
    : null;
}
