import { channelSlugFromName } from "../../src/lib/channels-contract";
import { hydrateAgentSkills } from "./agent-skills";
import {
  loadChannelCatalogSnapshot,
} from "./channel-proposal-helpers";
import {
  requireChannelAccess,
} from "./channel-route-access";
import {
  channelSidebarSectionJson,
  listChannelSidebarSections,
} from "./channel-sidebar-repository";
import {
  decodeChannelReadInput,
  decodeDirectMessageInput,
} from "./channel-route-decoders";
import {
  channelJson,
  channelReplyJson,
  createChannel,
  getChannel,
  getChannelSyncCursor,
  getDirectMessageByKey,
  listActiveChannelAgentReplies,
  listAgentDirectMessages,
  listChannelAgents,
  listChannelMembers,
  listChannelMessagePage,
  listChannelRootMessages,
  listChannels,
  loadChannelDelta,
  markChannelRead,
} from "./channels";
import { HttpError } from "./http-response";
import { hasWorkspaceCapability } from "./workspace-access";
import {
  listWorkspaceAgents,
  organizationAgentJson,
} from "./workspace-agents";
import {
  getWorkspaceRole,
  listWorkspaceMembers,
} from "./workspace-repository";
import { decodeMessageLimit } from "./query-contract";

type WorkspaceChannelApplicationInput = {
  db: D1Database;
  workspaceId: string;
  userId: string;
};

export async function syncWorkspaceChannels(
  input: WorkspaceChannelApplicationInput & { since: number },
) {
  const role = await getWorkspaceRole(
    input.db,
    input.workspaceId,
    input.userId,
  );
  if (!hasWorkspaceCapability(role, "workspace:read")) {
    throw new HttpError(404, "Workspace not found");
  }
  if (!Number.isSafeInteger(input.since) || input.since < 0) {
    throw new HttpError(400, "Invalid channel cursor");
  }
  return loadChannelDelta(
    input.db,
    input.workspaceId,
    input.userId,
    input.since,
  );
}

export async function listWorkspaceChannels(
  input: WorkspaceChannelApplicationInput,
) {
  const role = await getWorkspaceRole(
    input.db,
    input.workspaceId,
    input.userId,
  );
  if (!hasWorkspaceCapability(role, "workspace:read")) {
    throw new HttpError(404, "Workspace not found");
  }
  const snapshot = await loadChannelCatalogSnapshot(
    () => getChannelSyncCursor(input.db, input.workspaceId),
    () => listChannels(input.db, input.workspaceId, input.userId),
  );
  // The sidebar groups conversations by the member's own sections, so one
  // catalog load carries them rather than making the list wait on a second RPC.
  const sections = await listChannelSidebarSections(
    input.db,
    input.workspaceId,
    input.userId,
  );
  return {
    channels: snapshot.channels.map(channelJson),
    cursor: snapshot.cursor,
    sidebarSections: sections.map(channelSidebarSectionJson),
  };
}

export async function createWorkspaceDirectMessage(
  input: WorkspaceChannelApplicationInput & { request: unknown },
) {
  const role = await getWorkspaceRole(
    input.db,
    input.workspaceId,
    input.userId,
  );
  if (!hasWorkspaceCapability(role, "workspace:read")) {
    throw new HttpError(404, "Workspace not found");
  }
  if (!hasWorkspaceCapability(role, "conversations:write")) {
    throw new HttpError(403, "Conversation editing permission required");
  }
  const request = decodeDirectMessageInput(input.request);
  const selectedMemberIds = [...new Set(request.memberIds)];
  const selfSelected = selectedMemberIds.includes(input.userId);
  const memberIds = selectedMemberIds.filter((userId) => userId !== input.userId);
  const agentIds = [...new Set(request.agentIds)];
  if (selectedMemberIds.length + agentIds.length === 0) {
    throw new HttpError(400, "At least one participant is required");
  }

  const [organizationMembers, organizationAgents] = await Promise.all([
    listWorkspaceMembers(input.db, input.workspaceId),
    listWorkspaceAgents(input.db, input.workspaceId),
  ]);
  const membersById = new Map(
    organizationMembers.map((member) => [member.user_id, member]),
  );
  const agentsById = new Map(
    organizationAgents.map((agent) => [agent.id, agent]),
  );
  for (const userId of selectedMemberIds) {
    if (!membersById.has(userId)) {
      throw new HttpError(404, "Workspace member not found");
    }
  }
  for (const agentId of agentIds) {
    if (!agentsById.has(agentId)) {
      throw new HttpError(404, "Workspace Agent not found");
    }
  }

  const selectedParticipantCount = selectedMemberIds.length + agentIds.length;
  const dmKey = selectedParticipantCount === 1
    ? selfSelected
      ? `self:${input.userId}`
      : memberIds.length === 1
      ? `users:${JSON.stringify([input.userId, memberIds[0]!].sort())}`
      : `agent:${JSON.stringify([input.userId, agentIds[0]!])}`
    : null;
  if (dmKey) {
    const existing = await getDirectMessageByKey(
      input.db,
      input.workspaceId,
      dmKey,
      input.userId,
    );
    if (existing) return { channel: channelJson(existing) };
  }

  const participantNames = [
    ...selectedMemberIds.map((userId) => membersById.get(userId)!.name),
    ...agentIds.map((agentId) => agentsById.get(agentId)!.name),
  ];
  const channelId = crypto.randomUUID();
  const name = participantNames.join(", ").slice(0, 100);
  let channel;
  try {
    channel = await createChannel(input.db, {
      id: channelId,
      workspaceId: input.workspaceId,
      kind: "dm",
      dmKey,
      slug: channelSlugFromName(`dm-${channelId}`, channelId),
      name,
      topic: null,
      visibility: "private",
      defaultProjectId: null,
      createdByUserId: input.userId,
      memberIds,
      agentIds,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (dmKey && message.includes("unique")) {
      channel = await getDirectMessageByKey(
        input.db,
        input.workspaceId,
        dmKey,
        input.userId,
      );
    } else {
      throw error;
    }
  }
  if (!channel) throw new HttpError(500, "Direct message was not created");
  return { channel: channelJson(channel) };
}

/**
 * Every Agent-to-Agent conversation one Agent takes part in, newest first, for
 * the conversations tab on an Agent detail page. Workspace read is the bar;
 * the narrower project-access rule of the plan's §3.5 lands with the rest of
 * the viewing permissions.
 */
export async function listWorkspaceAgentDirectMessages(
  input: WorkspaceChannelApplicationInput & { agentId: string },
) {
  const role = await getWorkspaceRole(
    input.db,
    input.workspaceId,
    input.userId,
  );
  if (!hasWorkspaceCapability(role, "workspace:read")) {
    throw new HttpError(404, "Workspace not found");
  }
  const channels = await listAgentDirectMessages(
    input.db,
    input.workspaceId,
    input.agentId,
    input.userId,
  );
  return { channels: channels.map(channelJson) };
}

export async function getWorkspaceChannelDetail(
  input: WorkspaceChannelApplicationInput & {
    channelId: string;
    messageLimit: string | number | null;
  },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.workspaceId,
    input.channelId,
    input.userId,
  );
  const messageLimit = input.messageLimit === null
    ? null
    : decodeMessageLimit(String(input.messageLimit));
  const [members, channelAgents, messagePage, activeReplies] = await Promise.all([
    listChannelMembers(input.db, channel.id),
    listChannelAgents(input.db, channel.id),
    messageLimit === null
      ? listChannelRootMessages(input.db, channel.id).then((messages) => ({
          messages,
          nextCursor: null,
        }))
      : listChannelMessagePage(input.db, {
          channelId: channel.id,
          parentMessageId: null,
          cursor: null,
          limit: messageLimit,
          includeRepliesInTimeline: channel.kind === "dm",
        }),
    listActiveChannelAgentReplies(input.db, channel.id),
  ]);
  const agents = await hydrateAgentSkills(input.db, channelAgents);
  return {
    channel: channelJson(channel),
    members,
    agents: agents.map(organizationAgentJson),
    messages: messagePage?.messages ?? [],
    agentReplies: activeReplies.map(channelReplyJson),
    nextCursor: messagePage?.nextCursor ?? null,
  };
}

export async function markWorkspaceChannelRead(
  input: WorkspaceChannelApplicationInput & {
    channelId: string;
    request: unknown;
  },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.workspaceId,
    input.channelId,
    input.userId,
  );
  const request = decodeChannelReadInput(input.request);
  await markChannelRead(input.db, {
    userId: input.userId,
    channelId: channel.id,
    lastReadAt: request.lastReadAt ?? new Date().toISOString(),
  });
  const updated = await getChannel(
    input.db,
    input.workspaceId,
    channel.id,
    input.userId,
  );
  if (!updated) throw new HttpError(404, "Channel not found");
  return { channel: channelJson(updated) };
}
