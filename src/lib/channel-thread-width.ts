export const channelThreadWidthStorageKey =
  "briar.settings.channel-thread-width.v1";

export const channelThreadWidthMin = 30;
export const channelThreadWidthMax = 65;
export const channelThreadWidthDefault = 42;

export function clampChannelThreadWidth(value: number): number {
  return Math.min(
    channelThreadWidthMax,
    Math.max(channelThreadWidthMin, Math.round(value)),
  );
}

export function loadChannelThreadWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(channelThreadWidthStorageKey);
    if (stored === null) return null;
    const parsed = Number(stored);
    return Number.isFinite(parsed)
      ? clampChannelThreadWidth(parsed)
      : null;
  } catch {
    return null;
  }
}

export function saveChannelThreadWidth(width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      channelThreadWidthStorageKey,
      String(clampChannelThreadWidth(width)),
    );
  } catch {
    // Keep the current session width when storage is unavailable.
  }
}
