import { channelSlugFromName } from "../../src/lib/channels-contract";
import type { BriarAuth } from "./auth";
import { processArchiveCleanupQueue } from "./archive";
import { hydrateAgentSkills } from "./agent-skills";
import {
  loadChannelCatalogSnapshot,
} from "./channel-proposal-helpers";
import {
  requireChannelAccess,
  requireChannelDeletionAccess,
  requireChannelWriteAccess,
} from "./channel-route-access";
import {
  decodeChannelInput,
  decodeChannelMemberInput,
  decodeChannelReadInput,
  decodeChannelUpdateInput,
  decodeDirectMessageInput,
} from "./channel-route-decoders";
import {
  addChannelAgent,
  addChannelMember,
  channelJson,
  channelReplyJson,
  createChannel,
  deleteChannel,
  getChannel,
  getChannelSyncCursor,
  getDirectMessageByKey,
  listActiveChannelAgentReplies,
  listChannelAgents,
  listChannelMembers,
  listChannelMessagePage,
  listChannelRootMessages,
  listChannels,
  loadChannelDelta,
  markChannelRead,
  removeChannelAgent,
  removeChannelMember,
  updateChannel,
} from "./channels";
import { HttpError, json } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import {
  getOrganizationAgent,
  listOrganizationAgents,
  organizationAgentJson,
} from "./organization-agents";
import {
  getOrganizationRole,
  listOrganizationMembers,
} from "./organization-repository";
import { responseWithPostCommitCleanup } from "./post-commit-cleanup";
import { getProject } from "./project-command-repository";
import { decodeMessageLimit } from "./query-contract";
import { readJson } from "./request-readers";
import { scheduleChannelActivityDisconnect } from "./realtime-scheduling";
import { requireSession } from "./session-auth";

export type OrganizationChannelRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  env: Env;
  context?: ExecutionContext;
};

type OrganizationChannelApplicationInput = {
  db: D1Database;
  organizationId: string;
  userId: string;
};

export async function syncOrganizationChannels(
  input: OrganizationChannelApplicationInput & { since: number },
) {
  const role = await getOrganizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new HttpError(404, "Organization not found");
  }
  if (!Number.isSafeInteger(input.since) || input.since < 0) {
    throw new HttpError(400, "Invalid channel cursor");
  }
  return loadChannelDelta(
    input.db,
    input.organizationId,
    input.userId,
    input.since,
  );
}

export async function listOrganizationChannels(
  input: OrganizationChannelApplicationInput,
) {
  const role = await getOrganizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new HttpError(404, "Organization not found");
  }
  const snapshot = await loadChannelCatalogSnapshot(
    () => getChannelSyncCursor(input.db, input.organizationId),
    () => listChannels(input.db, input.organizationId, input.userId),
  );
  return {
    channels: snapshot.channels.map(channelJson),
    cursor: snapshot.cursor,
  };
}

export async function createOrganizationDirectMessage(
  input: OrganizationChannelApplicationInput & { request: unknown },
) {
  const role = await getOrganizationRole(
    input.db,
    input.organizationId,
    input.userId,
  );
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new HttpError(404, "Organization not found");
  }
  if (!hasOrganizationCapability(role, "conversations:write")) {
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
    listOrganizationMembers(input.db, input.organizationId),
    listOrganizationAgents(input.db, input.organizationId),
  ]);
  const membersById = new Map(
    organizationMembers.map((member) => [member.user_id, member]),
  );
  const agentsById = new Map(
    organizationAgents.map((agent) => [agent.id, agent]),
  );
  for (const userId of selectedMemberIds) {
    if (!membersById.has(userId)) {
      throw new HttpError(404, "Organization member not found");
    }
  }
  for (const agentId of agentIds) {
    if (!agentsById.has(agentId)) {
      throw new HttpError(404, "Organization Agent not found");
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
      input.organizationId,
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
      organizationId: input.organizationId,
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
        input.organizationId,
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

export async function getOrganizationChannelDetail(
  input: OrganizationChannelApplicationInput & {
    channelId: string;
    messageLimit: string | number | null;
  },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.organizationId,
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

export async function markOrganizationChannelRead(
  input: OrganizationChannelApplicationInput & {
    channelId: string;
    request: unknown;
  },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.organizationId,
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
    input.organizationId,
    channel.id,
    input.userId,
  );
  if (!updated) throw new HttpError(404, "Channel not found");
  return { channel: channelJson(updated) };
}

export async function handleOrganizationChannelRoute(
  routeInput: OrganizationChannelRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db, attachmentsBucket, env, context } =
    routeInput;
  const { pathname } = url;

  const channelChangesMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channel-changes$/u,
  );
  if (channelChangesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const since = Number(url.searchParams.get("since") ?? "0");
    return json(await syncOrganizationChannels({
      db,
      organizationId: channelChangesMatch[1],
      userId: session.user.id,
      since,
    }));
  }

  const organizationChannelsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels$/u,
  );

  const organizationDirectMessagesMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/dms$/u,
  );
  if (organizationDirectMessagesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    return json(await createOrganizationDirectMessage({
      db,
      organizationId: organizationDirectMessagesMatch[1],
      userId: session.user.id,
      request: await readJson(request),
    }), 201);
  }

  if (organizationChannelsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    return json(await listOrganizationChannels({
      db,
      organizationId: organizationChannelsMatch[1],
      userId: session.user.id,
    }));
  }
  if (organizationChannelsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationChannelsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    if (!hasOrganizationCapability(role, "conversations:write")) {
      throw new HttpError(403, "Conversation editing permission required");
    }
    const input = decodeChannelInput(await readJson(request));
    const channelId = crypto.randomUUID();
    const slug = input.slug ?? channelSlugFromName(input.name, channelId);
    if (input.defaultProjectId) {
      const project = await getProject(
        db,
        input.defaultProjectId,
        session.user.id,
      );
      if (!project) throw new HttpError(404, "Project not found");
    }
    let channel;
    try {
      channel = await createChannel(db, {
        id: channelId,
        organizationId,
        slug,
        name: input.name,
        topic: input.topic,
        visibility: input.visibility,
        defaultProjectId: input.defaultProjectId,
        createdByUserId: session.user.id,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("unique")) {
        throw new HttpError(409, "Channel slug already exists");
      }
      throw error;
    }
    if (!channel) throw new HttpError(500, "Channel was not created");
    return json({ channel: channelJson(channel) }, 201);
  }

  const organizationChannelReadMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/read$/u,
  );
  if (organizationChannelReadMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    return json(await markOrganizationChannelRead({
      db,
      organizationId: organizationChannelReadMatch[1],
      channelId: organizationChannelReadMatch[2],
      userId: session.user.id,
      request: await readJson(request),
    }));
  }

  const organizationChannelMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)$/u,
  );
  if (organizationChannelMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    return json(await getOrganizationChannelDetail({
      db,
      organizationId: organizationChannelMatch[1],
      channelId: organizationChannelMatch[2],
      userId: session.user.id,
      messageLimit: url.searchParams.get("limit"),
    }));
  }
  if (organizationChannelMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const currentChannel = await requireChannelWriteAccess(
      db,
      organizationChannelMatch[1],
      organizationChannelMatch[2],
      session.user.id,
    );
    const input = decodeChannelUpdateInput(await readJson(request));
    if (
      currentChannel.kind === "dm" &&
      (input.visibility === "public" || input.defaultProjectId)
    ) {
      throw new HttpError(
        400,
        "Direct messages must remain private and organization-scoped",
      );
    }
    if (input.defaultProjectId) {
      const project = await getProject(
        db,
        input.defaultProjectId,
        session.user.id,
      );
      if (!project) throw new HttpError(404, "Project not found");
    }
    const channel = await updateChannel(db, {
      organizationId: organizationChannelMatch[1],
      channelId: organizationChannelMatch[2],
      userId: session.user.id,
      ...input,
      updatedAt: new Date().toISOString(),
    });
    if (!channel) throw new HttpError(404, "Channel not found");
    scheduleChannelActivityDisconnect(
      env,
      organizationChannelMatch[1],
      organizationChannelMatch[2],
      context,
    );
    return json({ channel: channelJson(channel) });
  }
  if (organizationChannelMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const organizationId = organizationChannelMatch[1];
    await requireChannelDeletionAccess(
      db,
      organizationId,
      organizationChannelMatch[2],
      session.user.id,
    );
    const observedAt = new Date().toISOString();
    const deleted = await deleteChannel(
      db,
      organizationId,
      organizationChannelMatch[2],
      session.user.id,
      observedAt,
    );
    if (!deleted) throw new HttpError(404, "Channel not found");
    scheduleChannelActivityDisconnect(
      env,
      organizationId,
      organizationChannelMatch[2],
      context,
    );
    return responseWithPostCommitCleanup(json({ deleted: true }), {
      context,
      operation: "channel_delete",
      observedAt,
      tasks: [{
        queue: "archive",
        run: () =>
          processArchiveCleanupQueue(
            db,
            env.ARCHIVES,
            attachmentsBucket,
            observedAt,
            1_000,
          ),
      }],
    });
  }

  const channelMemberMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/members\/([0-9a-zA-Z-]+)$/u,
  );
  if (channelMemberMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWriteAccess(
      db,
      channelMemberMatch[1],
      channelMemberMatch[2],
      session.user.id,
    );
    const input = decodeChannelMemberInput(await readJson(request));
    const targetRole = await getOrganizationRole(
      db,
      channelMemberMatch[1],
      channelMemberMatch[3],
    );
    if (!targetRole) throw new HttpError(404, "Organization member not found");
    await addChannelMember(db, {
      channelId: channel.id,
      userId: channelMemberMatch[3],
      role: input.role,
      createdAt: new Date().toISOString(),
    });
    return json({ members: await listChannelMembers(db, channel.id) });
  }
  if (channelMemberMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWriteAccess(
      db,
      channelMemberMatch[1],
      channelMemberMatch[2],
      session.user.id,
    );
    await removeChannelMember(db, channel.id, channelMemberMatch[3]);
    scheduleChannelActivityDisconnect(
      env,
      channelMemberMatch[1],
      channel.id,
      context,
    );
    return json({ members: await listChannelMembers(db, channel.id) });
  }

  const channelAgentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/agents\/([0-9a-f-]+)$/u,
  );
  if (channelAgentMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWriteAccess(
      db,
      channelAgentMatch[1],
      channelAgentMatch[2],
      session.user.id,
    );
    const agent = await getOrganizationAgent(
      db,
      channelAgentMatch[1],
      channelAgentMatch[3],
    );
    if (!agent) throw new HttpError(404, "Agent not found");
    // Adding a project Agent exposes that project's context to the channel, so
    // the member doing it must be able to reach the project themselves.
    if (agent.project_id) {
      const project = await getProject(db, agent.project_id, session.user.id);
      if (!project) throw new HttpError(403, "Project access required");
    }
    await addChannelAgent(db, {
      channelId: channel.id,
      agentId: agent.id,
      addedByUserId: session.user.id,
      createdAt: new Date().toISOString(),
    });
    const agents = await hydrateAgentSkills(
      db,
      await listChannelAgents(db, channel.id),
    );
    return json({ agents: agents.map(organizationAgentJson) });
  }
  if (channelAgentMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelWriteAccess(
      db,
      channelAgentMatch[1],
      channelAgentMatch[2],
      session.user.id,
    );
    await removeChannelAgent(db, channel.id, channelAgentMatch[3]);
    const agents = await hydrateAgentSkills(
      db,
      await listChannelAgents(db, channel.id),
    );
    return json({ agents: agents.map(organizationAgentJson) });
  }

  return undefined;
}
