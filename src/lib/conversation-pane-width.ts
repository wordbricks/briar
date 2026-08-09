import { createPersistedWidth } from "./persisted-width";

export const conversationPaneWidthStorageKey =
  "briar.settings.conversation-pane.v1";

export const conversationPaneWidthMin = 30;
export const conversationPaneWidthMax = 65;
export const conversationPaneWidthDefault = 38;

const conversationPaneWidth = createPersistedWidth({
  storageKey: conversationPaneWidthStorageKey,
  min: conversationPaneWidthMin,
  max: conversationPaneWidthMax,
});

export const clampConversationPaneWidth = conversationPaneWidth.clamp;
export const loadConversationPaneWidth = conversationPaneWidth.load;
export const saveConversationPaneWidth = conversationPaneWidth.save;
