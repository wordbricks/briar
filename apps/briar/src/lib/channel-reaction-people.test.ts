import { describe, expect, it } from "vitest";
import type { ChannelMember } from "./channels-contract";
import { resolveChannelReactionPeople } from "./channel-reaction-people";

describe("resolveChannelReactionPeople", () => {
  it("uses organization profiles when a reaction author is not in the channel roster", () => {
    const member: ChannelMember = {
      userId: "owner",
      name: "Owner",
      email: "owner@example.com",
      image: null,
      role: "owner",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(
      resolveChannelReactionPeople({
        currentUserId: "owner",
        members: [member],
        reactionPeople: [{
          userId: "manager",
          name: "GetGPT Manager",
          image: "https://example.com/manager.png",
        }],
        userIds: ["owner", "manager", "missing"],
      }),
    ).toEqual([
      {
        userId: "owner",
        name: "Owner",
        image: null,
        isCurrentUser: true,
      },
      {
        userId: "manager",
        name: "GetGPT Manager",
        image: "https://example.com/manager.png",
        isCurrentUser: false,
      },
      {
        userId: "missing",
        name: null,
        image: null,
        isCurrentUser: false,
      },
    ]);
  });
});
