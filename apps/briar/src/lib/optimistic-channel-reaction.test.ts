import { describe, expect, it } from "vitest";
import type { ChannelMessageReaction } from "./channels-contract";
import { toggleOptimisticChannelReaction } from "./optimistic-channel-reaction";

describe("toggleOptimisticChannelReaction", () => {
  it("adds a new emoji reaction when not present", () => {
    const initial: ChannelMessageReaction[] = [];
    const result = toggleOptimisticChannelReaction(initial, "👍", "user-1");

    expect(result).toEqual([
      {
        emoji: "👍",
        count: 1,
        userIds: ["user-1"],
      },
    ]);
  });

  it("appends to userIds and increments count when emoji exists without current user", () => {
    const initial: ChannelMessageReaction[] = [
      { emoji: "👍", count: 1, userIds: ["user-2"] },
    ];
    const result = toggleOptimisticChannelReaction(initial, "👍", "user-1");

    expect(result).toEqual([
      {
        emoji: "👍",
        count: 2,
        userIds: ["user-2", "user-1"],
      },
    ]);
  });

  it("removes the emoji reaction completely when current user was the only reactor", () => {
    const initial: ChannelMessageReaction[] = [
      { emoji: "👍", count: 1, userIds: ["user-1"] },
    ];
    const result = toggleOptimisticChannelReaction(initial, "👍", "user-1");

    expect(result).toEqual([]);
  });

  it("decrements count and removes user from userIds when multiple users reacted", () => {
    const initial: ChannelMessageReaction[] = [
      { emoji: "👍", count: 2, userIds: ["user-2", "user-1"] },
      { emoji: "❤️", count: 1, userIds: ["user-3"] },
    ];
    const result = toggleOptimisticChannelReaction(initial, "👍", "user-1");

    expect(result).toEqual([
      {
        emoji: "👍",
        count: 1,
        userIds: ["user-2"],
      },
      {
        emoji: "❤️",
        count: 1,
        userIds: ["user-3"],
      },
    ]);
  });

  it("is reversible by toggling the same emoji again", () => {
    const initial: ChannelMessageReaction[] = [
      { emoji: "🎉", count: 1, userIds: ["user-2"] },
    ];
    const toggled = toggleOptimisticChannelReaction(initial, "👍", "user-1");
    expect(toggled).toHaveLength(2);

    const reverted = toggleOptimisticChannelReaction(toggled, "👍", "user-1");
    expect(reverted).toEqual(initial);
  });

  it("handles empty or blank emoji by returning a copy of initial reactions", () => {
    const initial: ChannelMessageReaction[] = [
      { emoji: "👍", count: 1, userIds: ["user-1"] },
    ];
    const result = toggleOptimisticChannelReaction(initial, "   ", "user-1");
    expect(result).toEqual(initial);
  });

  it("handles null currentUserId when adding a new reaction", () => {
    const initial: ChannelMessageReaction[] = [];
    const result = toggleOptimisticChannelReaction(initial, "🔥", null);

    expect(result).toEqual([
      {
        emoji: "🔥",
        count: 1,
        userIds: [],
      },
    ]);
  });
});
