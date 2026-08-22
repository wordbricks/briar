import type { ChannelMessageReaction } from "./channels-contract";

/**
 * Toggles an emoji reaction optimistically on an aggregated reaction list.
 *
 * - If the emoji does not exist, appends a new reaction with count 1 and current user.
 * - If the emoji exists and the user already reacted, removes the user.
 *   - If the user was the only reactor (or count reaches 0), removes the reaction completely.
 *   - Otherwise, decrements count and filters the user from userIds.
 * - If the emoji exists and the user has not reacted, increments count and appends the user.
 */
export function toggleOptimisticChannelReaction(
  reactions: readonly ChannelMessageReaction[],
  emoji: string,
  currentUserId: string | null,
): ChannelMessageReaction[] {
  const trimmedEmoji = emoji.trim();
  if (!trimmedEmoji) {
    return [...reactions];
  }

  const existingIndex = reactions.findIndex(
    (reaction) => reaction.emoji === trimmedEmoji,
  );

  if (existingIndex === -1) {
    return [
      ...reactions,
      {
        emoji: trimmedEmoji,
        count: 1,
        userIds: currentUserId ? [currentUserId] : [],
      },
    ];
  }

  const existing = reactions[existingIndex];
  const hasUser = Boolean(
    currentUserId && existing.userIds.includes(currentUserId),
  );

  if (hasUser) {
    const nextUserIds = existing.userIds.filter((id) => id !== currentUserId);
    const nextCount = Math.max(0, existing.count - 1);
    if (nextCount === 0 || nextUserIds.length === 0) {
      return reactions.filter((_, index) => index !== existingIndex);
    }
    const next = [...reactions];
    next[existingIndex] = {
      ...existing,
      count: nextCount,
      userIds: nextUserIds,
    };
    return next;
  }

  const nextUserIds = currentUserId
    ? [...existing.userIds, currentUserId]
    : existing.userIds;
  const nextCount = existing.count + 1;
  const next = [...reactions];
  next[existingIndex] = {
    ...existing,
    count: nextCount,
    userIds: nextUserIds,
  };
  return next;
}
