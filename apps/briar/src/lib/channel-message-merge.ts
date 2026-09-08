import type { ChannelMessage } from "./channels-contract";

const legacyChronology = (left: ChannelMessage, right: ChannelMessage) =>
  left.createdAt === right.createdAt
    ? left.id.localeCompare(right.id)
    : left.createdAt.localeCompare(right.createdAt);

/**
 * Durable DM parts in one uninterrupted timeline span use the server sequence.
 * Legacy messages remain chronological barriers, so publication metadata never
 * moves a batch across an intervening user message.
 */
export function sortChannelMessagesForDisplay(
  messages: readonly ChannelMessage[],
): ChannelMessage[] {
  const tieId = (message: ChannelMessage) =>
    message.dmMetadata?.batchId ?? message.id;
  const chronological = [...messages].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt.localeCompare(right.createdAt);
    }
    const tieDifference = tieId(left).localeCompare(tieId(right));
    if (tieDifference !== 0) return tieDifference;
    if (
      left.dmMetadata?.batchId === right.dmMetadata?.batchId &&
      left.dmMetadata && right.dmMetadata
    ) {
      return left.dmMetadata.partIndex - right.dmMetadata.partIndex ||
        left.dmMetadata.conversationSequence -
          right.dmMetadata.conversationSequence ||
        left.id.localeCompare(right.id);
    }
    return left.id.localeCompare(right.id);
  });

  let start = 0;
  while (start < chronological.length) {
    if (!chronological[start]?.dmMetadata) {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (end < chronological.length && chronological[end]?.dmMetadata) end += 1;
    const ordered = chronological.slice(start, end).sort((left, right) => {
      const leftMetadata = left.dmMetadata!;
      const rightMetadata = right.dmMetadata!;
      return leftMetadata.conversationSequence - rightMetadata.conversationSequence ||
        leftMetadata.partIndex - rightMetadata.partIndex ||
        legacyChronology(left, right);
    });
    chronological.splice(start, ordered.length, ...ordered);
    start = end;
  }
  return chronological;
}

/**
 * Merge a cursor page without letting an older pending snapshot visually undo
 * an accepted execution. An authoritative null or a new proposal id is still
 * applied so transfer/unassign invalidation cannot leave a stale approval card.
 */
export function mergeChannelMessages(
  current: readonly ChannelMessage[],
  incoming: readonly ChannelMessage[],
  removedIds: readonly string[],
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
  return sortChannelMessagesForDisplay([...byId.values()]);
}

/** Merge a complete server snapshot while preserving only monotonic accepts. */
export function mergeChannelMessageSnapshot(
  current: readonly ChannelMessage[],
  incoming: readonly ChannelMessage[],
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
