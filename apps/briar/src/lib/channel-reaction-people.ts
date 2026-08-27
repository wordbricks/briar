import type {
  ChannelMember,
  ChannelMessageReactionPerson,
} from "./channels-contract";

export const channelReactionPeoplePreviewLimit = 8;

export type ChannelReactionPerson = {
  userId: string;
  name: string | null;
  image: string | null;
  isCurrentUser: boolean;
};

export type ChannelReactionPeoplePreview<T> = {
  visible: T[];
  hiddenCount: number;
};

export function resolveChannelReactionPeople({
  currentUserId,
  members,
  reactionPeople = [],
  userIds,
}: {
  currentUserId: string | null;
  members: readonly ChannelMember[];
  reactionPeople?: readonly ChannelMessageReactionPerson[];
  userIds: readonly string[];
}): ChannelReactionPerson[] {
  const memberById = new Map(
    members.map((member) => [member.userId, member]),
  );
  const reactionPersonById = new Map(
    reactionPeople.map((person) => [person.userId, person]),
  );
  return userIds.map((userId) => {
    const member = memberById.get(userId) ?? reactionPersonById.get(userId);
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
): ChannelReactionPeoplePreview<T> {
  if (people.length <= limit) {
    return { visible: [...people], hiddenCount: 0 };
  }
  return {
    visible: people.slice(0, limit),
    hiddenCount: people.length - limit,
  };
}
