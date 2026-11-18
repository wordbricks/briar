import { describe, expect, it } from "vitest";

import type { ChannelSummary } from "../../lib/channels-contract";
import { organizationChannelIdsAtom } from "../entities/channels";
import { activeWorkspaceIdAtom } from "../workspace/atoms";
import { lockedTeamIdAtom } from "../platform";
import { createTestRegistry } from "../registry";
import { applySyncEvent } from "../sync/apply";
import {
  activeChannelIdAtom,
  activeWorkspaceChannelsAtom,
  channelCatalogCursorAtom,
  initialChannelInviteIdAtom,
  organizationDirectMessagesAtom,
  requestedChannelSettingsIdAtom,
  resetChannelSelection,
  unreadDirectMessageCountAtom,
  visibleWorkspaceChannelsAtom,
} from "./atoms";

const channel = (
  id: string,
  overrides: Partial<ChannelSummary> = {},
): ChannelSummary => ({
  id,
  workspaceId: "org-a",
  kind: "channel",
  slug: id,
  name: id,
  topic: null,
  visibility: "public",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 1,
  agentCount: 0,
  createdByUserId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  lastReadAt: null,
  hasUnread: false,
  dmParticipants: [],
  pinnedAt: null,
  sidebarSectionId: null,
  hiddenAt: null,
  readOnly: false,
  ...overrides,
});

const registryWith = (workspaceId: string | null) =>
  createTestRegistry([
    [activeWorkspaceIdAtom, workspaceId],
    [lockedTeamIdAtom, null],
  ]);

describe("channel selection atoms", () => {
  it("reads back what was written under the same workspace", () => {
    const registry = registryWith("org-a");
    registry.set(activeChannelIdAtom, "channel-1");
    registry.set(requestedChannelSettingsIdAtom, "channel-1");
    registry.set(channelCatalogCursorAtom, 7);

    expect(registry.get(activeChannelIdAtom)).toBe("channel-1");
    expect(registry.get(requestedChannelSettingsIdAtom)).toBe("channel-1");
    expect(registry.get(channelCatalogCursorAtom)).toBe(7);
  });

  it("resets the selection when the workspace changes", () => {
    const registry = registryWith("org-a");
    registry.set(activeChannelIdAtom, "channel-1");
    registry.set(initialChannelInviteIdAtom, "channel-1");
    registry.set(channelCatalogCursorAtom, 7);

    registry.set(activeWorkspaceIdAtom, "org-b");

    expect(registry.get(activeChannelIdAtom)).toBeNull();
    expect(registry.get(initialChannelInviteIdAtom)).toBeNull();
    expect(registry.get(channelCatalogCursorAtom)).toBeNull();
  });

  it("notifies subscribers of the reset without an explicit write", () => {
    const registry = registryWith("org-a");
    registry.set(activeChannelIdAtom, "channel-1");
    const seen: (string | null)[] = [];
    const unsubscribe = registry.subscribe(
      activeChannelIdAtom,
      (value) => seen.push(value),
      { immediate: true },
    );

    registry.set(activeWorkspaceIdAtom, "org-b");
    unsubscribe();

    expect(seen).toEqual(["channel-1", null]);
  });

  it("does not restore a selection when the workspace comes back", () => {
    const registry = registryWith("org-a");
    registry.set(activeChannelIdAtom, "channel-1");

    // The sync hook drops the stamps as part of switching, so returning to an
    // workspace must not reopen what was last open there.
    registry.set(activeWorkspaceIdAtom, "org-b");
    resetChannelSelection(registry);
    registry.set(activeWorkspaceIdAtom, "org-a");

    expect(registry.get(activeChannelIdAtom)).toBeNull();
  });
});

describe("channel list selectors", () => {
  it("splits the catalog into channels and direct messages", () => {
    const registry = registryWith("org-a");
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      workspaceId: "org-a",
      channels: [
        channel("general"),
        channel("dm-1", { kind: "dm", hasUnread: true }),
        channel("dm-2", { kind: "dm" }),
      ],
    });

    expect(
      registry.get(activeWorkspaceChannelsAtom).map((item) => item.id),
    ).toEqual(["general", "dm-1", "dm-2"]);
    expect(
      registry.get(visibleWorkspaceChannelsAtom).map((item) => item.id),
    ).toEqual(["general"]);
    expect(
      registry.get(organizationDirectMessagesAtom).map((item) => item.id),
    ).toEqual(["dm-1", "dm-2"]);
    expect(registry.get(unreadDirectMessageCountAtom)).toBe(1);
  });

  it("shows a project window only the channels pinned to its team", () => {
    const registry = createTestRegistry([
      [activeWorkspaceIdAtom, "org-a"],
      [lockedTeamIdAtom, "team-a"],
    ]);
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      workspaceId: "org-a",
      channels: [
        channel("pinned", { defaultProjectId: "team-a" }),
        channel("other", { defaultProjectId: "team-b" }),
        channel("dm-1", { kind: "dm" }),
      ],
    });

    expect(
      registry.get(visibleWorkspaceChannelsAtom).map((item) => item.id),
    ).toEqual(["pinned"]);
    expect(registry.get(organizationDirectMessagesAtom)).toEqual([]);
  });

  it("keeps the list reference across a delta that changed nothing", () => {
    const registry = registryWith("org-a");
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      workspaceId: "org-a",
      channels: [channel("general")],
    });
    const before = registry.get(visibleWorkspaceChannelsAtom);

    applySyncEvent(registry, {
      kind: "channel-catalog-delta",
      workspaceId: "org-a",
      channels: [],
      removedChannelIds: [],
      reset: false,
    });

    expect(registry.get(visibleWorkspaceChannelsAtom)).toBe(before);
  });

  it("reads nothing while no workspace is selected", () => {
    const registry = registryWith(null);
    expect(registry.get(activeWorkspaceChannelsAtom)).toEqual([]);
    expect(registry.get(organizationChannelIdsAtom("org-a"))).toBeNull();
  });
});
