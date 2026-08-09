/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  channelThreadWidthMax,
  channelThreadWidthMin,
  channelThreadWidthStorageKey,
  clampChannelThreadWidth,
  loadChannelThreadWidth,
  saveChannelThreadWidth,
} from "./channel-thread-width";
import {
  clampConversationPaneWidth,
  conversationPaneWidthMax,
  conversationPaneWidthMin,
  conversationPaneWidthStorageKey,
  loadConversationPaneWidth,
  saveConversationPaneWidth,
} from "./conversation-pane-width";

const adapters = [
  {
    name: "channel thread width",
    min: channelThreadWidthMin,
    max: channelThreadWidthMax,
    storageKey: channelThreadWidthStorageKey,
    clamp: clampChannelThreadWidth,
    load: loadChannelThreadWidth,
    save: saveChannelThreadWidth,
  },
  {
    name: "conversation pane width",
    min: conversationPaneWidthMin,
    max: conversationPaneWidthMax,
    storageKey: conversationPaneWidthStorageKey,
    clamp: clampConversationPaneWidth,
    load: loadConversationPaneWidth,
    save: saveConversationPaneWidth,
  },
] as const;

describe.each(adapters)("$name adapter", (adapter) => {
  it("clamps the stored width to the supported range", () => {
    expect(adapter.clamp(10)).toBe(adapter.min);
    expect(adapter.clamp(90)).toBe(adapter.max);
    expect(adapter.clamp(45.6)).toBe(46);
    expect(adapter.clamp(45.4)).toBe(45);
  });

  it("returns null when no width has been stored", () => {
    window.localStorage.clear();
    expect(adapter.load()).toBeNull();
  });

  it("saves and restores a valid width", () => {
    window.localStorage.clear();
    adapter.save(48);
    expect(window.localStorage.getItem(adapter.storageKey)).toBe("48");
    expect(adapter.load()).toBe(48);
  });

  it("clamps an out-of-range stored value on load", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      adapter.storageKey,
      String(adapter.max + 20),
    );
    expect(adapter.load()).toBe(adapter.max);
  });
});
