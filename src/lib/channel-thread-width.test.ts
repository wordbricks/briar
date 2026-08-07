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

describe("channel thread width", () => {
  it("clamps the stored width to the supported range", () => {
    expect(clampChannelThreadWidth(10)).toBe(channelThreadWidthMin);
    expect(clampChannelThreadWidth(90)).toBe(channelThreadWidthMax);
    expect(clampChannelThreadWidth(45.6)).toBe(46);
    expect(clampChannelThreadWidth(45.4)).toBe(45);
  });

  it("returns null when no width has been stored", () => {
    window.localStorage.clear();
    expect(loadChannelThreadWidth()).toBeNull();
  });

  it("saves and restores a valid width", () => {
    window.localStorage.clear();
    saveChannelThreadWidth(48);
    expect(
      window.localStorage.getItem(channelThreadWidthStorageKey),
    ).toBe("48");
    expect(loadChannelThreadWidth()).toBe(48);
  });

  it("clamps an out-of-range stored value on load", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      channelThreadWidthStorageKey,
      String(channelThreadWidthMax + 20),
    );
    expect(loadChannelThreadWidth()).toBe(channelThreadWidthMax);
  });
});
