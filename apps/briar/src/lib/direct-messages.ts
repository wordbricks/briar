import type {
  ChannelSummary,
  DirectMessageParticipant,
} from "./channels-contract";

export function directMessageParticipants(
  channel: ChannelSummary,
  currentUserId: string | null,
): DirectMessageParticipant[] {
  return channel.dmParticipants.filter(
    (participant) =>
      participant.type !== "user" || participant.id !== currentUserId,
  );
}

export function directMessageDisplayName(
  channel: ChannelSummary,
  currentUserId: string | null,
) {
  const names = directMessageParticipants(channel, currentUserId).map(
    (participant) => participant.name,
  );
  return names.length > 0 ? names.join(", ") : channel.name;
}

export function sortDirectMessages(channels: readonly ChannelSummary[]) {
  return [...channels].sort((left, right) => {
    const leftActivity = left.lastMessageAt ?? left.createdAt;
    const rightActivity = right.lastMessageAt ?? right.createdAt;
    const activityOrder = rightActivity.localeCompare(leftActivity);
    return activityOrder || left.name.localeCompare(right.name);
  });
}
