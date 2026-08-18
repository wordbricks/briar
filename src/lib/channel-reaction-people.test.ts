import { describe, expect, it } from "vitest";
import type { ChannelMember } from "./channels-contract";
import {
  previewChannelReactionPeople,
  resolveChannelReactionPeople,
} from "./channel-reaction-people";

const member = (
  overrides: Partial<ChannelMember> & Pick<ChannelMember, "userId" | "name">,
): ChannelMember => ({
  email: `${overrides.userId}@example.com`,
  image: null,
  role: "member",
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

describe("resolveChannelReactionPeople", () => {
  it("resolves roster names and images in reaction order", () => {
    expect(
      resolveChannelReactionPeople({
        currentUserId: "user-me",
        members: [
          member({
            userId: "user-sam",
            name: "Sam",
            image: "https://example.com/sam.png",
          }),
          member({ userId: "user-me", name: "Jay" }),
        ],
        userIds: ["user-sam", "user-me", "user-gone"],
      }),
    ).toEqual([
      {
        userId: "user-sam",
        name: "Sam",
        image: "https://example.com/sam.png",
        isCurrentUser: false,
      },
      {
        userId: "user-me",
        name: "Jay",
        image: null,
        isCurrentUser: true,
      },
      {
        userId: "user-gone",
        name: null,
        image: null,
        isCurrentUser: false,
      },
    ]);
  });

  it("marks the current user even when they are missing from the roster", () => {
    expect(
      resolveChannelReactionPeople({
        currentUserId: "user-me",
        members: [member({ userId: "user-sam", name: "Sam" })],
        userIds: ["user-me"],
      }),
    ).toEqual([
      {
        userId: "user-me",
        name: null,
        image: null,
        isCurrentUser: true,
      },
    ]);
  });
});

describe("previewChannelReactionPeople", () => {
  it("keeps short lists intact and caps longer ones", () => {
    expect(previewChannelReactionPeople(["a", "b"], 8)).toEqual({
      visible: ["a", "b"],
      hiddenCount: 0,
    });
    expect(
      previewChannelReactionPeople(["a", "b", "c", "d"], 3),
    ).toEqual({
      visible: ["a", "b", "c"],
      hiddenCount: 1,
    });
  });
});
