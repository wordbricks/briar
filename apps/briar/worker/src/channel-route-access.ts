import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import { HttpError } from "./http-response";
import {
  getChannel,
  getChannelById,
} from "./channels";

export async function requireChannelAccess(
  db: D1Database,
  organizationId: string,
  channelId: string,
  userId: string,
) {
  const role = await getOrganizationRole(db, organizationId, userId);
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new HttpError(404, "Organization not found");
  }
  const channel = await getChannel(db, organizationId, channelId, userId);
  if (!channel) throw new HttpError(404, "Channel not found");
  return channel;
}

export async function requireChannelWriteAccess(
  db: D1Database,
  organizationId: string,
  channelId: string,
  userId: string,
) {
  const role = await getOrganizationRole(db, organizationId, userId);
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new HttpError(404, "Organization not found");
  }
  if (!hasOrganizationCapability(role, "conversations:write")) {
    throw new HttpError(403, "Conversation editing permission required");
  }
  const channel = await getChannel(db, organizationId, channelId, userId);
  if (!channel) throw new HttpError(404, "Channel not found");
  return channel;
}

export async function requireChannelDeletionAccess(
  db: D1Database,
  organizationId: string,
  channelId: string,
  userId: string,
) {
  const role = await getOrganizationRole(db, organizationId, userId);
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new HttpError(404, "Organization not found");
  }
  const channel = await getChannelById(db, organizationId, channelId);
  if (!channel) throw new HttpError(404, "Channel not found");
  /*
    A direct message has no owner: everybody in it is a participant, and the
    person who happened to start it is not more entitled to it than the person
    who replied. Any participant may therefore delete the conversation, which
    deletes it for everybody in it. This only adds a way through: a caller who
    is not a participant still faces the checks below, and regular channels keep
    the creator-or-owner rule untouched.
  */
  if (channel.kind === "dm") {
    const participant = await db
      .prepare(
        `select 1 as present from briar_channel_members
         where channel_id = ? and user_id = ?`,
      )
      .bind(channelId, userId)
      .first<{ present: number }>();
    if (participant) return channel;
  }
  if (!hasOrganizationCapability(role, "conversations:write")) {
    throw new HttpError(403, "Conversation editing permission required");
  }
  if (
    !hasOrganizationCapability(role, "organization:update") &&
    channel.created_by_user_id !== userId
  ) {
    throw new HttpError(
      403,
      "Channel creator or organization owner access required",
    );
  }
  return channel;
}

export async function requireChannelWebhookManagement(
  db: D1Database,
  organizationId: string,
  channelId: string,
  userId: string,
) {
  const channel = await requireChannelAccess(
    db,
    organizationId,
    channelId,
    userId,
  );
  if (channel.kind === "dm") {
    throw new HttpError(400, "Webhooks are not available in direct messages");
  }
  const organizationRole = await getOrganizationRole(
    db,
    organizationId,
    userId,
  );
  if (hasOrganizationCapability(organizationRole, "organization:update")) {
    return channel;
  }
  if (!hasOrganizationCapability(organizationRole, "conversations:write")) {
    throw new HttpError(403, "Conversation editing permission required");
  }
  const membership = await db.prepare(
    `select role from briar_channel_members
     where channel_id = ? and user_id = ?`,
  ).bind(channelId, userId).first<{ role: "owner" | "member" }>();
  if (membership?.role !== "owner") {
    throw new HttpError(403, "Channel owner access required");
  }
  return channel;
}
