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
    const organizationId = channelChangesMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    const since = Number(url.searchParams.get("since") ?? "0");
    if (!Number.isSafeInteger(since) || since < 0) {
      throw new HttpError(400, "Invalid channel cursor");
    }
    return json(
      await loadChannelDelta(db, organizationId, session.user.id, since),
    );
  }

  const organizationChannelsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels$/u,
  );

  const organizationDirectMessagesMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/dms$/u,
  );
  if (organizationDirectMessagesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationDirectMessagesMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    if (!hasOrganizationCapability(role, "conversations:write")) {
      throw new HttpError(403, "Conversation editing permission required");
    }
    const input = decodeDirectMessageInput(await readJson(request));
    const selectedMemberIds = [...new Set(input.memberIds)];
    const selfSelected = selectedMemberIds.includes(session.user.id);
    const memberIds = selectedMemberIds.filter(
      (userId) => userId !== session.user.id,
    );
    const agentIds = [...new Set(input.agentIds)];
    if (selectedMemberIds.length + agentIds.length === 0) {
      throw new HttpError(400, "At least one participant is required");
    }

    const [organizationMembers, organizationAgents] = await Promise.all([
      listOrganizationMembers(db, organizationId),
      listOrganizationAgents(db, organizationId),
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
        ? `self:${session.user.id}`
        : memberIds.length === 1
        ? `users:${JSON.stringify([session.user.id, memberIds[0]!].sort())}`
        : `agent:${JSON.stringify([session.user.id, agentIds[0]!])}`
      : null;
    if (dmKey) {
      const existing = await getDirectMessageByKey(
        db,
        organizationId,
        dmKey,
        session.user.id,
      );
      if (existing) return json({ channel: channelJson(existing) });
    }

    const participantNames = [
      ...selectedMemberIds.map((userId) => membersById.get(userId)!.name),
      ...agentIds.map((agentId) => agentsById.get(agentId)!.name),
    ];
    const channelId = crypto.randomUUID();
    const name = participantNames.join(", ").slice(0, 100);
    let channel;
    try {
      channel = await createChannel(db, {
        id: channelId,
        organizationId,
        kind: "dm",
        dmKey,
        slug: channelSlugFromName(`dm-${channelId}`, channelId),
        name,
        topic: null,
        visibility: "private",
        defaultProjectId: null,
        createdByUserId: session.user.id,
        memberIds,
        agentIds,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (dmKey && message.includes("unique")) {
        channel = await getDirectMessageByKey(
          db,
          organizationId,
          dmKey,
          session.user.id,
        );
      } else {
        throw error;
      }
    }
    if (!channel) throw new HttpError(500, "Direct message was not created");
    return json({ channel: channelJson(channel) }, 201);
  }

  if (organizationChannelsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationChannelsMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    const snapshot = await loadChannelCatalogSnapshot(
      () => getChannelSyncCursor(db, organizationId),
      () => listChannels(db, organizationId, session.user.id),
    );
    return json({
      channels: snapshot.channels.map(channelJson),
      cursor: snapshot.cursor,
    });
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
    const channel = await requireChannelAccess(
      db,
      organizationChannelReadMatch[1],
      organizationChannelReadMatch[2],
      session.user.id,
    );
    const input = decodeChannelReadInput(await readJson(request));
    const lastReadAt = input.lastReadAt ?? new Date().toISOString();
    await markChannelRead(db, {
      userId: session.user.id,
      channelId: channel.id,
      lastReadAt,
    });
    const updated = await getChannel(
      db,
      organizationChannelReadMatch[1],
      channel.id,
      session.user.id,
    );
    if (!updated) throw new HttpError(404, "Channel not found");
    return json({ channel: channelJson(updated) });
  }

  const organizationChannelMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)$/u,
  );
  if (organizationChannelMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      organizationChannelMatch[1],
      organizationChannelMatch[2],
      session.user.id,
    );
    const rawMessageLimit = new URL(request.url).searchParams.get("limit");
    const messageLimit = rawMessageLimit === null
      ? null
      : decodeMessageLimit(rawMessageLimit);
    const [members, channelAgents, messagePage, activeReplies] =
      await Promise.all([
        listChannelMembers(db, channel.id),
        listChannelAgents(db, channel.id),
        messageLimit === null
          ? listChannelRootMessages(db, channel.id).then((messages) => ({
              messages,
              nextCursor: null,
            }))
          : listChannelMessagePage(db, {
              channelId: channel.id,
              parentMessageId: null,
              cursor: null,
              limit: messageLimit,
              includeRepliesInTimeline: channel.kind === "dm",
            }),
        listActiveChannelAgentReplies(db, channel.id),
      ]);
    const agents = await hydrateAgentSkills(db, channelAgents);
    return json({
      channel: channelJson(channel),
      members,
      agents: agents.map(organizationAgentJson),
      messages: messagePage?.messages ?? [],
      agentReplies: activeReplies.map(channelReplyJson),
      nextCursor: messagePage?.nextCursor ?? null,
    });
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
