import type {
  ChannelMember,
  ChannelMessageReactionPerson,
} from "./channels-contract";

export const channelReactionPeoplePreviewLimit = 8;

export type ChannelReactionPerson = {
  userId?: string;
  agentId?: string;
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
  agentIds = [],
}: {
  currentUserId: string | null;
  members: readonly ChannelMember[];
  reactionPeople?: readonly ChannelMessageReactionPerson[];
  userIds: readonly string[];
  agentIds?: readonly string[];
}): ChannelReactionPerson[] {
  const memberById = new Map(
    members.map((member) => [member.userId, member]),
  );
  const reactionPersonByUserId = new Map(
    reactionPeople
      .filter((person): person is ChannelMessageReactionPerson & { userId: string } =>
        Boolean(person.userId)
      )
      .map((person) => [person.userId, person]),
  );
  const reactionPersonByAgentId = new Map(
    reactionPeople
      .filter((person): person is ChannelMessageReactionPerson & { agentId: string } =>
        Boolean(person.agentId)
      )
      .map((person) => [person.agentId, person]),
  );
  return [
    ...userIds.map((userId) => {
      const member = memberById.get(userId) ?? reactionPersonByUserId.get(userId);
      return {
        userId,
        name: member?.name ?? null,
        image: member?.image ?? null,
        isCurrentUser: currentUserId !== null && userId === currentUserId,
      };
    }),
    ...agentIds.map((agentId) => {
      const person = reactionPersonByAgentId.get(agentId);
      return {
        agentId,
        name: person?.name ?? null,
        image: person?.image ?? null,
        isCurrentUser: false,
      };
    }),
  ];
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
