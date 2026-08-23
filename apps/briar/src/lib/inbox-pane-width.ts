import { createPersistedWidth } from "./persisted-width";

export const inboxPaneWidthStorageKey = "briar.settings.inbox-pane.v1";

/** Width of the right-hand inbox detail pane as a percentage of the workspace. */
export const inboxPaneWidthMin = 30;
export const inboxPaneWidthMax = 65;
export const inboxPaneWidthDefault = 50;

const inboxPaneWidth = createPersistedWidth({
  storageKey: inboxPaneWidthStorageKey,
  min: inboxPaneWidthMin,
  max: inboxPaneWidthMax,
});

export const clampInboxPaneWidth = inboxPaneWidth.clamp;
export const loadInboxPaneWidth = inboxPaneWidth.load;
export const saveInboxPaneWidth = inboxPaneWidth.save;
