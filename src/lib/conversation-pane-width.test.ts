/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  clampConversationPaneWidth,
  conversationPaneWidthMax,
  conversationPaneWidthMin,
  conversationPaneWidthStorageKey,
  loadConversationPaneWidth,
  saveConversationPaneWidth,
} from "./conversation-pane-width";

describe("conversation pane width", () => {
  it("clamps the stored width to the supported range", () => {
    expect(clampConversationPaneWidth(10)).toBe(conversationPaneWidthMin);
    expect(clampConversationPaneWidth(90)).toBe(conversationPaneWidthMax);
    expect(clampConversationPaneWidth(45.6)).toBe(46);
    expect(clampConversationPaneWidth(45.4)).toBe(45);
  });

  it("returns null when no width has been stored", () => {
    window.localStorage.clear();
    expect(loadConversationPaneWidth()).toBeNull();
  });

  it("saves and restores a valid width", () => {
    window.localStorage.clear();
    saveConversationPaneWidth(48);
    expect(window.localStorage.getItem(conversationPaneWidthStorageKey)).toBe(
      "48",
    );
    expect(loadConversationPaneWidth()).toBe(48);
  });

  it("clamps an out-of-range stored value on load", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      conversationPaneWidthStorageKey,
      String(conversationPaneWidthMax + 20),
    );
    expect(loadConversationPaneWidth()).toBe(conversationPaneWidthMax);
  });
});
