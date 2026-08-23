import { canManageOrganization } from "./organization-access";
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
  if (!role) throw new HttpError(404, "Organization not found");
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
  if (!role) throw new HttpError(404, "Organization not found");
  const channel = await getChannelById(db, organizationId, channelId);
  if (!channel) throw new HttpError(404, "Channel not found");
  if (role !== "owner" && channel.created_by_user_id !== userId) {
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
  if (canManageOrganization(organizationRole)) return channel;
  const membership = await db.prepare(
    `select role from briar_channel_members
     where channel_id = ? and user_id = ?`,
  ).bind(channelId, userId).first<{ role: "owner" | "member" }>();
  if (membership?.role !== "owner") {
    throw new HttpError(403, "Channel owner access required");
  }
  return channel;
}
