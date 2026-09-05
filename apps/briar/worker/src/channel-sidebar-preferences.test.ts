import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { deleteChannelApplication } from "./channel-administration-application";
import { decodeChannelMessageApplicationInput } from "./app-mutation-request-mappers";
import { createOrganizationChannelMessage } from "./channel-message-routes";
import {
  createChannelSidebarSectionApplication,
  deleteChannelSidebarSectionApplication,
  listChannelSidebarSectionsApplication,
  markChannelUnreadApplication,
  renameChannelSidebarSectionApplication,
  updateChannelSidebarPreferenceApplication,
} from "./channel-sidebar-application";
import { getChannelSyncCursor } from "./channels";
import {
  createOrganizationDirectMessage,
  listOrganizationChannels,
  markOrganizationChannelRead,
} from "./organization-channel-routes";
import { HttpError } from "./http-response";

/*
  The sidebar arrangement is per member, so every assertion here is about two
  people looking at the same conversation and seeing different rows, and about a
  member's own devices agreeing through the channel change feed.
*/

const organizationId = "a1000000-0000-4000-8000-000000000001";
const otherOrganizationId = "a1000000-0000-4000-8000-000000000002";
const ownerId = "sidebar-owner";
const partnerId = "sidebar-partner";
const outsiderId = "sidebar-outsider";
const at = (minute: number) =>
  new Date(Date.UTC(2026, 1, 1, 0, minute)).toISOString();

describe("channel sidebar preferences", () => {
  const db = cloudflareEnv.DB;

  beforeAll(async () => {
    for (const [id, name] of [
      [ownerId, "Owner"],
      [partnerId, "Partner"],
      [outsiderId, "Outsider"],
    ]) {
      await db
        .prepare(
          `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
           values (?, ?, ?, 1, ?, ?)`,
        )
        .bind(id, name, `${id}@example.com`, at(0), at(0))
        .run();
    }
    for (const id of [organizationId, otherOrganizationId]) {
      await db
        .prepare(
          `insert into briar_organizations (id, name, handle, created_at, updated_at)
           values (?, ?, ?, ?, ?)`,
        )
        .bind(id, `Org ${id.slice(-1)}`, `sidebar-org-${id.slice(-1)}`, at(0), at(0))
        .run();
    }
    for (const [userId, role] of [
      [ownerId, "owner"],
      [partnerId, "owner"],
      // An editor may start conversations but does not administer the
      // organization, so nothing but participation can let them delete a DM.
      [outsiderId, "editor"],
    ]) {
      await db
        .prepare(
          `insert into briar_organization_members (
             organization_id, user_id, role, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
        )
        .bind(organizationId, userId, role, at(0), at(0))
        .run();
    }
    await db
      .prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      )
      .bind(otherOrganizationId, ownerId, at(0), at(0))
      .run();
  }, 60_000);

  const createConversation = async (userId = ownerId, withUserId = partnerId) => {
    const result = await createOrganizationDirectMessage({
      db,
      organizationId,
      userId,
      request: { memberIds: [withUserId], agentIds: [] },
    });
    return result.channel;
  };

  const sendMessage = (channelId: string, userId: string, body: string) =>
    createOrganizationChannelMessage({
      db,
      organizationId,
      channelId,
      userId,
      request: {
        ...decodeChannelMessageApplicationInput({ body }),
        clientMessageId: crypto.randomUUID(),
      },
      attachmentIds: [],
    });

  const catalogEntry = async (userId: string, channelId: string) => {
    const catalog = await listOrganizationChannels({
      db,
      organizationId,
      userId,
    });
    return catalog.channels.find((channel) => channel.id === channelId) ?? null;
  };

  it("keeps one member's pin, section and hidden flag off the other's row", async () => {
    const conversation = await createConversation();
    const section = await createChannelSidebarSectionApplication({
      db,
      organizationId,
      userId: ownerId,
      name: "  Team  ",
    });
    expect(section.section.name).toBe("Team");
    expect(section.sections).toHaveLength(1);

    await updateChannelSidebarPreferenceApplication({
      db,
      organizationId,
      userId: ownerId,
      channelId: conversation.id,
      update: { pinned: true, section: { case: "set", sectionId: section.section.id } },
    });
    const hidden = await updateChannelSidebarPreferenceApplication({
      db,
      organizationId,
      userId: ownerId,
      channelId: conversation.id,
      update: { hidden: true },
    });
    // A later write touches only the field it carries.
    expect(hidden.channel.pinnedAt).not.toBeNull();
    expect(hidden.channel.sidebarSectionId).toBe(section.section.id);
    expect(hidden.channel.hiddenAt).not.toBeNull();

    const mine = await catalogEntry(ownerId, conversation.id);
    expect(mine?.pinnedAt).not.toBeNull();
    expect(mine?.sidebarSectionId).toBe(section.section.id);
    expect(mine?.hiddenAt).not.toBeNull();

    const theirs = await catalogEntry(partnerId, conversation.id);
    expect(theirs?.pinnedAt).toBeNull();
    expect(theirs?.sidebarSectionId).toBeNull();
    expect(theirs?.hiddenAt).toBeNull();

    // Unpinning clears the stamp without disturbing the section.
    const unpinned = await updateChannelSidebarPreferenceApplication({
      db,
      organizationId,
      userId: ownerId,
      channelId: conversation.id,
      update: { pinned: false },
    });
    expect(unpinned.channel.pinnedAt).toBeNull();
    expect(unpinned.channel.sidebarSectionId).toBe(section.section.id);
  });

  it("carries the member's own sections with their catalog", async () => {
    const created = await createChannelSidebarSectionApplication({
      db,
      organizationId,
      userId: partnerId,
      name: "Partner only",
    });
    const catalog = await listOrganizationChannels({
      db,
      organizationId,
      userId: partnerId,
    });
    expect(catalog.sidebarSections.map((section) => section.id)).toContain(
      created.section.id,
    );
    const outsiderCatalog = await listOrganizationChannels({
      db,
      organizationId,
      userId: outsiderId,
    });
    expect(outsiderCatalog.sidebarSections).toHaveLength(0);
  });

  it("advances the channel cursor so the member's other devices refetch", async () => {
    const conversation = await createConversation();
    const before = await getChannelSyncCursor(db, organizationId);
    await updateChannelSidebarPreferenceApplication({
      db,
      organizationId,
      userId: ownerId,
      channelId: conversation.id,
      update: { pinned: true },
    });
    const after = await getChannelSyncCursor(db, organizationId);
    expect(after).toBeGreaterThan(before);
  });

  it("refuses a conversation the caller does not take part in", async () => {
    const conversation = await createConversation();
    await expect(
      updateChannelSidebarPreferenceApplication({
        db,
        organizationId,
        userId: outsiderId,
        channelId: conversation.id,
        update: { pinned: true },
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      markChannelUnreadApplication({
        db,
        organizationId,
        userId: outsiderId,
        channelId: conversation.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("scopes sections to the member who created them", async () => {
    const mine = await createChannelSidebarSectionApplication({
      db,
      organizationId,
      userId: ownerId,
      name: "Scoped",
    });
    await expect(
      renameChannelSidebarSectionApplication({
        db,
        organizationId,
        userId: partnerId,
        sectionId: mine.section.id,
        name: "Stolen",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteChannelSidebarSectionApplication({
        db,
        organizationId,
        userId: partnerId,
        sectionId: mine.section.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
    // Nor may a conversation be filed under somebody else's section.
    const conversation = await createConversation();
    await expect(
      updateChannelSidebarPreferenceApplication({
        db,
        organizationId,
        userId: partnerId,
        channelId: conversation.id,
        update: { section: { case: "set", sectionId: mine.section.id } },
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("falls a conversation back to Unassigned when its section is deleted", async () => {
    const conversation = await createConversation();
    const section = await createChannelSidebarSectionApplication({
      db,
      organizationId,
      userId: ownerId,
      name: "Temporary",
    });
    await updateChannelSidebarPreferenceApplication({
      db,
      organizationId,
      userId: ownerId,
      channelId: conversation.id,
      update: { section: { case: "set", sectionId: section.section.id } },
    });
    const renamed = await renameChannelSidebarSectionApplication({
      db,
      organizationId,
      userId: ownerId,
      sectionId: section.section.id,
      name: "Renamed",
    });
    expect(renamed.section.name).toBe("Renamed");

    const remaining = await deleteChannelSidebarSectionApplication({
      db,
      organizationId,
      userId: ownerId,
      sectionId: section.section.id,
    });
    expect(remaining.sections.map((entry) => entry.id)).not.toContain(
      section.section.id,
    );
    const entry = await catalogEntry(ownerId, conversation.id);
    expect(entry?.sidebarSectionId).toBeNull();
    const listed = await listChannelSidebarSectionsApplication({
      db,
      organizationId,
      userId: ownerId,
    });
    expect(listed.sections.map((item) => item.id)).not.toContain(
      section.section.id,
    );
  });

  it("marks a conversation unread until it is read again", async () => {
    const conversation = await createConversation();
    // Nothing anybody else wrote: there is nothing to be unread about.
    const empty = await markChannelUnreadApplication({
      db,
      organizationId,
      userId: ownerId,
      channelId: conversation.id,
    });
    expect(empty.channel.hasUnread).toBe(false);

    await sendMessage(conversation.id, partnerId, "Are we still on?");
    await markOrganizationChannelRead({
      db,
      organizationId,
      userId: ownerId,
      channelId: conversation.id,
      request: {},
    });
    expect((await catalogEntry(ownerId, conversation.id))?.hasUnread).toBe(false);

    const unread = await markChannelUnreadApplication({
      db,
      organizationId,
      userId: ownerId,
      channelId: conversation.id,
    });
    expect(unread.channel.hasUnread).toBe(true);
    // It stays unread across a plain catalog load, and only reading clears it.
    expect((await catalogEntry(ownerId, conversation.id))?.hasUnread).toBe(true);
    // The partner's own unread state is untouched: they wrote the message.
    expect((await catalogEntry(partnerId, conversation.id))?.hasUnread).toBe(
      false,
    );

    await markOrganizationChannelRead({
      db,
      organizationId,
      userId: ownerId,
      channelId: conversation.id,
      request: {},
    });
    expect((await catalogEntry(ownerId, conversation.id))?.hasUnread).toBe(false);
  });

  it("lets any participant delete a conversation they did not start", async () => {
    const conversation = await createConversation(ownerId, partnerId);
    await expect(
      deleteChannelApplication({
        db,
        organizationId,
        userId: outsiderId,
        channelId: conversation.id,
      }),
    ).rejects.toBeInstanceOf(HttpError);
    await deleteChannelApplication({
      db,
      organizationId,
      userId: partnerId,
      channelId: conversation.id,
    });
    expect(await catalogEntry(ownerId, conversation.id)).toBeNull();
  });
});
