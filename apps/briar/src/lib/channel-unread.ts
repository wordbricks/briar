import type { ChannelSummary } from "./channels-contract";

export function channelHasUnread(channel: ChannelSummary): boolean {
  if (typeof channel.hasUnread === "boolean") return channel.hasUnread;
  if (!channel.lastMessageAt) return false;
  if (!channel.lastReadAt) return true;
  return channel.lastMessageAt > channel.lastReadAt;
}

export function laterTimestamp(
  ...values: Array<string | null | undefined>
): string {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1)
    ?? new Date().toISOString();
}

export function markChannelSummaryRead(
  channel: ChannelSummary,
  lastReadAt: string,
): ChannelSummary {
  return {
    ...channel,
    lastReadAt,
    hasUnread: false,
  };
}

export function markChannelCatalogRead(
  channels: readonly ChannelSummary[],
  channelId: string,
  lastReadAt: string,
): ChannelSummary[] {
  return channels.map((channel) =>
    channel.id === channelId
      ? markChannelSummaryRead(channel, lastReadAt)
      : channel,
  );
}
