export const conversationPaneWidthStorageKey =
  "briar.settings.conversation-pane.v1";

export const conversationPaneWidthMin = 30;
export const conversationPaneWidthMax = 65;
export const conversationPaneWidthDefault = 38;

export function clampConversationPaneWidth(value: number): number {
  return Math.min(
    conversationPaneWidthMax,
    Math.max(conversationPaneWidthMin, Math.round(value)),
  );
}

export function loadConversationPaneWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(conversationPaneWidthStorageKey);
    if (stored === null) return null;
    const parsed = Number(stored);
    return Number.isFinite(parsed)
      ? clampConversationPaneWidth(parsed)
      : null;
  } catch {
    return null;
  }
}

export function saveConversationPaneWidth(width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      conversationPaneWidthStorageKey,
      String(clampConversationPaneWidth(width)),
    );
  } catch {
    // Keep the current session width when storage is unavailable.
  }
}
