import { createPersistedWidth } from "./persisted-width";

export const channelThreadWidthStorageKey =
  "briar.settings.channel-thread-width.v1";

export const channelThreadWidthMin = 30;
export const channelThreadWidthMax = 65;
export const channelThreadWidthDefault = 42;

const channelThreadWidth = createPersistedWidth({
  storageKey: channelThreadWidthStorageKey,
  min: channelThreadWidthMin,
  max: channelThreadWidthMax,
});

export const clampChannelThreadWidth = channelThreadWidth.clamp;
export const loadChannelThreadWidth = channelThreadWidth.load;
export const saveChannelThreadWidth = channelThreadWidth.save;
