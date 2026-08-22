import type { IssueMessage } from "../types";

/**
 * Apply an authoritative conversation snapshot while keeping a locally
 * accepted approval over a delayed pending version of that same proposal.
 * Null/missing proposals, new IDs, and removed messages remain authoritative.
 */
export function mergeIssueMessages(
  current: IssueMessage[],
  incoming: IssueMessage[],
) {
  const previousById = new Map(current.map((message) => [message.id, message]));
  const incomingIds = new Set(incoming.map((message) => message.id));
  const merged = incoming.map((message) => {
    const previous = previousById.get(message.id);
    const acceptedIssueExecution =
      previous?.executionProposal?.status === "accepted"
        ? previous.executionProposal
        : null;
    const acceptedSkillExecution =
      previous?.skillExecutionProposal?.status === "accepted"
        ? previous.skillExecutionProposal
        : null;
    return {
      ...message,
      ...(acceptedIssueExecution &&
      message.executionProposal?.id === acceptedIssueExecution.id &&
      message.executionProposal.status === "pending"
        ? { executionProposal: acceptedIssueExecution }
        : {}),
      ...(acceptedSkillExecution &&
      message.skillExecutionProposal?.id === acceptedSkillExecution.id &&
      message.skillExecutionProposal.status === "pending"
        ? { skillExecutionProposal: acceptedSkillExecution }
        : {}),
    };
  });
  merged.push(
    ...current.filter(
      (message) => message.optimistic && !incomingIds.has(message.id),
    ),
  );
  return merged.sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt.localeCompare(right.createdAt)
  );
}
