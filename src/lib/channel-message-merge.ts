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
    byId.set(
      message.id,
      keepsAcceptedExecution
        ? { ...message, executionProposal: acceptedExecution }
        : message,
    );
  }
  for (const id of removedIds) byId.delete(id);
  return [...byId.values()].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt.localeCompare(right.createdAt),
  );
}
