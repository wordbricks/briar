import type { ChannelMember } from "./channels-contract";

export const channelReactionPeoplePreviewLimit = 8;

export type ChannelReactionPerson = {
  userId: string;
  name: string | null;
  image: string | null;
  isCurrentUser: boolean;
};

export function resolveChannelReactionPeople({
  currentUserId,
  members,
  userIds,
}: {
  currentUserId: string | null;
  members: readonly ChannelMember[];
  userIds: readonly string[];
}): ChannelReactionPerson[] {
  const memberById = new Map(
    members.map((member) => [member.userId, member]),
  );
  return userIds.map((userId) => {
    const member = memberById.get(userId);
    return {
      userId,
      name: member?.name ?? null,
      image: member?.image ?? null,
      isCurrentUser: currentUserId !== null && userId === currentUserId,
    };
  });
}

export function previewChannelReactionPeople<T>(
  people: readonly T[],
  limit = channelReactionPeoplePreviewLimit,
): { visible: T[]; hiddenCount: number } {
  if (people.length <= limit) {
    return { visible: [...people], hiddenCount: 0 };
  }
  return {
    visible: people.slice(0, limit),
    hiddenCount: people.length - limit,
  };
}
