import type { ChannelSummary } from "./channels-contract";

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
