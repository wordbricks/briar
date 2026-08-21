import { describe, expect, it } from "vitest";
import type { ChannelSummary } from "./channels-contract";
import {
  directMessageDisplayName,
  directMessageParticipants,
  sortDirectMessages,
} from "./direct-messages";

const dm = (overrides: Partial<ChannelSummary> = {}): ChannelSummary => ({
  id: "dm-1",
  organizationId: "org-1",
  kind: "dm",
  slug: "dm-1",
  name: "Fallback",
  topic: null,
  visibility: "private",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 1,
  agentCount: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  dmParticipants: [
    { type: "user", id: "me", name: "Me", image: null },
    { type: "agent", id: "agent", name: "Falcon", image: null },
  ],
  ...overrides,
});

describe("direct message presentation", () => {
  it("excludes the current user from names and avatars", () => {
    expect(directMessageDisplayName(dm(), "me")).toBe("Falcon");
    expect(directMessageParticipants(dm(), "me")).toEqual([
      { type: "agent", id: "agent", name: "Falcon", image: null },
    ]);
  });

  it("orders conversations by their latest activity", () => {
    expect(sortDirectMessages([
      dm({ id: "older", lastMessageAt: "2026-01-02T00:00:00.000Z" }),
      dm({ id: "newer", lastMessageAt: "2026-01-03T00:00:00.000Z" }),
    ]).map((channel) => channel.id)).toEqual(["newer", "older"]);
  });
});
