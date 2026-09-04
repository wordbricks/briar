import type { ChannelMessage } from "./channels-contract";

/**
 * Merge a cursor page without letting an older pending snapshot visually undo
 * an accepted execution. An authoritative null or a new proposal id is still
 * applied so transfer/unassign invalidation cannot leave a stale approval card.
 */
export function mergeChannelMessages(
  current: ChannelMessage[],
  incoming: ChannelMessage[],
  removedIds: string[],
) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const previous = byId.get(message.id);
    const acceptedExecution = previous?.executionProposal?.status === "accepted"
      ? previous.executionProposal
      : null;
    const keepsAcceptedExecution = Boolean(
      acceptedExecution &&
      message.executionProposal?.id === acceptedExecution.id &&
      message.executionProposal.status === "pending",
    );
    const acceptedSkillExecution =
      previous?.skillExecutionProposal?.status === "accepted"
        ? previous.skillExecutionProposal
        : null;
    const keepsAcceptedSkillExecution = Boolean(
      acceptedSkillExecution &&
      message.skillExecutionProposal?.id === acceptedSkillExecution.id &&
      message.skillExecutionProposal.status === "pending",
    );
    const attachments = previous?.attachments &&
      previous.attachments.length === message.attachments.length
        ? message.attachments.map((attachment, index) => {
            const previousAttachment = previous.attachments[index];
            if (
              previousAttachment?.url.startsWith("blob:") &&
              previousAttachment.filename === attachment.filename
            ) {
              return {
                ...attachment,
                url: previousAttachment.url,
              };
            }
            return attachment;
          })
        : message.attachments;
    const withAttachments = attachments !== message.attachments
      ? { ...message, attachments }
      : message;
    const merged = keepsAcceptedExecution
      ? { ...withAttachments, executionProposal: acceptedExecution }
      : withAttachments;
    byId.set(
      message.id,
      keepsAcceptedSkillExecution
        ? { ...merged, skillExecutionProposal: acceptedSkillExecution }
        : merged,
    );
  }
  for (const id of removedIds) byId.delete(id);
  return [...byId.values()].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt.localeCompare(right.createdAt),
  );
}

/** Merge a complete server snapshot while preserving only monotonic accepts. */
export function mergeChannelMessageSnapshot(
  current: ChannelMessage[],
  incoming: ChannelMessage[],
) {
  const incomingIds = new Set(incoming.map((message) => message.id));
  return mergeChannelMessages(
    current,
    incoming,
    current
      .filter((message) => !message.optimistic && !incomingIds.has(message.id))
      .map((message) => message.id),
  );
}
