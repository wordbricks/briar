import { channelSidebarSectionNameSchema } from "../../src/lib/channels-contract";
import { requireChannelAccess } from "./channel-route-access";
import {
  channelSidebarSectionJson,
  clearChannelReadState,
  createChannelSidebarSection,
  deleteChannelSidebarSection,
  getChannelSidebarSection,
  latestForeignChannelMessageAt,
  listChannelSidebarSections,
  recordChannelSummaryChange,
  renameChannelSidebarSection,
  upsertChannelSidebarPreference,
  type ChannelSidebarPreferenceUpdate,
} from "./channel-sidebar-repository";
import { channelJson, getChannel } from "./channels";
import { HttpError } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import { decodeRequestSync } from "./request-schema";

/*
  Sidebar arrangement is the member's own view of their conversations, so the
  authorization is deliberately narrower than channel editing on one side and
  wider on the other: pinning needs no `conversations:write`, because it changes
  nothing anybody else can see, but it does need the caller to be able to reach
  the conversation at all — which for a DM means being one of its participants,
  since `getChannel` only returns a private channel to a member of it.
*/

const decodeSectionName = decodeRequestSync(channelSidebarSectionNameSchema);

type SidebarApplicationInput = {
  readonly db: D1Database;
  readonly organizationId: string;
  readonly userId: string;
};

const requireOrganizationReader = async (input: SidebarApplicationInput) => {
  const role = await getOrganizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new HttpError(404, "Organization not found");
  }
};

const sections = async (input: SidebarApplicationInput) =>
  (await listChannelSidebarSections(
    input.db,
    input.organizationId,
    input.userId,
  )).map(channelSidebarSectionJson);

/** The channel as this member now sees it, after their own row changed. */
const reloadChannel = async (
  input: SidebarApplicationInput & { readonly channelId: string },
) => {
  const updated = await getChannel(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (!updated) throw new HttpError(404, "Channel not found");
  return channelJson(updated);
};

export async function updateChannelSidebarPreferenceApplication(
  input: SidebarApplicationInput & {
    readonly channelId: string;
    readonly update: ChannelSidebarPreferenceUpdate;
  },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (input.update.section?.case === "set") {
    const section = await getChannelSidebarSection(
      input.db,
      input.organizationId,
      input.userId,
      input.update.section.sectionId,
    );
    if (!section) throw new HttpError(404, "Sidebar section not found");
  }
  await upsertChannelSidebarPreference(input.db, {
    userId: input.userId,
    channelId: channel.id,
    update: input.update,
    now: new Date().toISOString(),
  });
  await recordChannelSummaryChange(input.db, input.organizationId, channel.id);
  return { channel: await reloadChannel({ ...input, channelId: channel.id }) };
}

export async function markChannelUnreadApplication(
  input: SidebarApplicationInput & { readonly channelId: string },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  const unreadable = await latestForeignChannelMessageAt(input.db, {
    userId: input.userId,
    channelId: channel.id,
  });
  // Nothing anybody else wrote means there is nothing to be unread about, so
  // the conversation comes back exactly as it was.
  if (!unreadable) return { channel: channelJson(channel) };
  await clearChannelReadState(input.db, {
    userId: input.userId,
    channelId: channel.id,
  });
  await recordChannelSummaryChange(input.db, input.organizationId, channel.id);
  return { channel: await reloadChannel({ ...input, channelId: channel.id }) };
}

export async function listChannelSidebarSectionsApplication(
  input: SidebarApplicationInput,
) {
  await requireOrganizationReader(input);
  return { sections: await sections(input) };
}

export async function createChannelSidebarSectionApplication(
  input: SidebarApplicationInput & { readonly name: string },
) {
  await requireOrganizationReader(input);
  const now = new Date().toISOString();
  const created = await createChannelSidebarSection(input.db, {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    userId: input.userId,
    name: decodeSectionName(input.name),
    createdAt: now,
  });
  if (!created) throw new HttpError(500, "Sidebar section was not created");
  return {
    section: channelSidebarSectionJson(created),
    sections: await sections(input),
  };
}

export async function renameChannelSidebarSectionApplication(
  input: SidebarApplicationInput & {
    readonly sectionId: string;
    readonly name: string;
  },
) {
  await requireOrganizationReader(input);
  const renamed = await renameChannelSidebarSection(input.db, {
    sectionId: input.sectionId,
    organizationId: input.organizationId,
    userId: input.userId,
    name: decodeSectionName(input.name),
    updatedAt: new Date().toISOString(),
  });
  if (!renamed) throw new HttpError(404, "Sidebar section not found");
  return {
    section: channelSidebarSectionJson(renamed),
    sections: await sections(input),
  };
}

export async function deleteChannelSidebarSectionApplication(
  input: SidebarApplicationInput & { readonly sectionId: string },
) {
  await requireOrganizationReader(input);
  const result = await deleteChannelSidebarSection(input.db, {
    sectionId: input.sectionId,
    organizationId: input.organizationId,
    userId: input.userId,
  });
  if (!result.deleted) throw new HttpError(404, "Sidebar section not found");
  // The conversations that were filed in it are Unassigned now, so each of
  // their summaries changed for this member's other devices.
  for (const channelId of result.channelIds) {
    await recordChannelSummaryChange(input.db, input.organizationId, channelId);
  }
  return { sections: await sections(input) };
}
