import { describe, expect, it } from "vitest";
import {
  channelDeltaResponseIsCurrent,
  companionDeltaResponseIsCurrent,
} from "./channel-delta-fence";

describe("channel delta concurrency fence", () => {
  it("rejects a delta superseded by cursor, data, or authoritative-load state", () => {
    const current = {
      stopped: false,
      requestedCursor: 4,
      currentCursor: 4,
      requestedDataVersion: 7,
      currentDataVersion: 7,
      authoritativeLoadPending: false,
    };

    expect(channelDeltaResponseIsCurrent(current)).toBe(true);
    expect(channelDeltaResponseIsCurrent({
      ...current,
      currentCursor: 5,
    })).toBe(false);
    expect(channelDeltaResponseIsCurrent({
      ...current,
      currentDataVersion: 8,
    })).toBe(false);
    expect(channelDeltaResponseIsCurrent({
      ...current,
      authoritativeLoadPending: true,
    })).toBe(false);
  });

  it("rejects a Companion delta after channel selection changes", () => {
    expect(companionDeltaResponseIsCurrent({
      stopped: false,
      requestedSelectionVersion: 2,
      currentSelectionVersion: 2,
    })).toBe(true);
    expect(companionDeltaResponseIsCurrent({
      stopped: false,
      requestedSelectionVersion: 2,
      currentSelectionVersion: 3,
    })).toBe(false);
  });
});
