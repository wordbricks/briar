import { describe, expect, it } from "vitest";
import type { ChannelSummary } from "./channels-contract";
import {
  laterTimestamp,
  markChannelCatalogRead,
} from "./channel-unread";

const channel = (
  overrides: Partial<ChannelSummary> = {},
): ChannelSummary => ({
  id: "channel-1",
  organizationId: "org-1",
  slug: "general",
  name: "General",
  topic: null,
  visibility: "public",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 1,
  agentCount: 0,
  kind: "channel",
  createdByUserId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  lastReadAt: null,
  hasUnread: false,
  dmParticipants: [],
  pinnedAt: null,
  sidebarSectionId: null,
  hiddenAt: null,
  ...overrides,
});

describe("channel unread helpers", () => {
  it("clears unread on the matching catalog row", () => {
    const readAt = laterTimestamp(
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    );
    const [updated, other] = markChannelCatalogRead(
      [
        channel({
          hasUnread: true,
          lastMessageAt: "2026-08-02T00:00:00.000Z",
        }),
        channel({
          id: "channel-2",
          slug: "random",
          name: "Random",
          hasUnread: true,
        }),
      ],
      "channel-1",
      readAt,
    );
    expect(updated?.hasUnread).toBe(false);
    expect(updated?.lastReadAt).toBe("2026-08-03T00:00:00.000Z");
    expect(other?.hasUnread).toBe(true);
  });
});
