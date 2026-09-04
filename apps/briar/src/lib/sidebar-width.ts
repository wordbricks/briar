import { createPersistedWidth } from "./persisted-width";

export const sidebarWidthStorageKey = "briar.settings.sidebar-width.v1";

export const sidebarWidthMin = 200;
export const sidebarWidthMax = 480;
export const sidebarWidthDefault = 252;

const sidebarWidth = createPersistedWidth({
  storageKey: sidebarWidthStorageKey,
  min: sidebarWidthMin,
  max: sidebarWidthMax,
});

export const clampSidebarWidth = sidebarWidth.clamp;
export const loadSidebarWidth = sidebarWidth.load;
export const saveSidebarWidth = sidebarWidth.save;
