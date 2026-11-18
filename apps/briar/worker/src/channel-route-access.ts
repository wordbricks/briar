import { hasWorkspaceCapability } from "./workspace-access";
import { getWorkspaceRole } from "./workspace-repository";
import { HttpError } from "./http-response";
import {
  getChannel,
  getChannelById,
  isAgentDirectMessage,
} from "./channels";

/**
 * An Agent-to-Agent conversation has no human participants, so a person can
 * read it under the plan's §3.5 rule but never write to it, rename it, or
 * change who is in it. Deletion keeps the existing conversation rule.
 */
const AGENT_DIRECT_MESSAGE_READ_ONLY = "Agent conversations are read-only";

export async function requireChannelAccess(
  db: D1Database,
  workspaceId: string,
  channelId: string,
  userId: string,
) {
  const role = await getWorkspaceRole(db, workspaceId, userId);
  if (!hasWorkspaceCapability(role, "workspace:read")) {
    throw new HttpError(404, "Workspace not found");
  }
  const channel = await getChannel(db, workspaceId, channelId, userId);
  if (!channel) throw new HttpError(404, "Channel not found");
  return channel;
}

export async function requireChannelWriteAccess(
  db: D1Database,
  workspaceId: string,
  channelId: string,
  userId: string,
) {
  const role = await getWorkspaceRole(db, workspaceId, userId);
  if (!hasWorkspaceCapability(role, "workspace:read")) {
    throw new HttpError(404, "Workspace not found");
  }
  if (!hasWorkspaceCapability(role, "conversations:write")) {
    throw new HttpError(403, "Conversation editing permission required");
  }
  const channel = await getChannel(db, workspaceId, channelId, userId);
  if (!channel) throw new HttpError(404, "Channel not found");
  if (isAgentDirectMessage(channel)) {
    throw new HttpError(403, AGENT_DIRECT_MESSAGE_READ_ONLY);
  }
  return channel;
}

export async function requireChannelDeletionAccess(
  db: D1Database,
  workspaceId: string,
  channelId: string,
  userId: string,
) {
  const role = await getWorkspaceRole(db, workspaceId, userId);
  if (!hasWorkspaceCapability(role, "workspace:read")) {
    throw new HttpError(404, "Workspace not found");
  }
  const channel = await getChannelById(db, workspaceId, channelId);
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
  if (!hasWorkspaceCapability(role, "conversations:write")) {
    throw new HttpError(403, "Conversation editing permission required");
  }
  if (
    !hasWorkspaceCapability(role, "workspace:update") &&
    channel.created_by_user_id !== userId
  ) {
    throw new HttpError(
      403,
      "Channel creator or workspace owner access required",
    );
  }
  return channel;
}

export async function requireChannelWebhookManagement(
  db: D1Database,
  workspaceId: string,
  channelId: string,
  userId: string,
) {
  const channel = await requireChannelAccess(
    db,
    workspaceId,
    channelId,
    userId,
  );
  if (isAgentDirectMessage(channel)) {
    throw new HttpError(403, AGENT_DIRECT_MESSAGE_READ_ONLY);
  }
  if (channel.kind === "dm") {
    throw new HttpError(400, "Webhooks are not available in direct messages");
  }
  const organizationRole = await getWorkspaceRole(
    db,
    workspaceId,
    userId,
  );
  if (hasWorkspaceCapability(organizationRole, "workspace:update")) {
    return channel;
  }
  if (!hasWorkspaceCapability(organizationRole, "conversations:write")) {
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
