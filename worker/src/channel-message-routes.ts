import {
  canonicalizeIssueAttachmentReferences,
} from "../../src/lib/issue-markdown";
import { agentReplyParentMessageId } from "../../src/lib/issue-reply-decision";
import {
  channelReplyNoAvailableWorkerError,
} from "../../src/lib/channels-contract";
import { hydrateAgentSkills } from "./agent-skills";
import type { BriarAuth } from "./auth";
import {
  prepareStoredAttachments,
  uploadStoredAttachments,
} from "./attachment-storage";
import { channelAttachmentResponse } from "./channel-attachment-response";
import { requireChannelAccess } from "./channel-route-access";
import { decodeChannelMessageReactionInput } from "./channel-route-decoders";
import {
  channelJson,
  channelReplyJson,
  createChannelMessage,
  enqueueChannelAgentReplies,
  getChannelMessage,
  getChannelMessageAttachment,
  getChannelMessageDocument,
  getProjectAgentChannel,
  getProjectOrganizationChannel,
  isChannelReactionEmoji,
  isChannelRootMessage,
  listChannelAgentReplies,
  listChannelAgents,
  listChannelMessagePage,
  listChannelRootMessages,
  listChannelThreadMessages,
  listChannelThreadSubscriptions,
  resolveChannelThreadRootId,
  subscribeChannelThread,
  toggleChannelMessageReaction,
  unsubscribeChannelThread,
} from "./channels";
import { sha256 } from "./crypto-digest";
import { findProjectIdByAgentTokenHash } from "./hunt-run-claim-repository";
import {
  HttpError,
  json,
  privateNoStoreJson,
} from "./http-response";
import { getOrganizationRole } from "./organization-repository";
import {
  decodeChannelMessageQuery,
  decodeProjectChannelMessageQuery,
} from "./query-contract";
import {
  readChannelMessageRequest,
  readJson,
} from "./request-readers";
import { requireSession } from "./session-auth";
import {
  hasAvailableChannelReplyWorker,
  userOwnsExecutionWorkerDevice,
} from "./workers";

const bearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
};

async function requireAgentProject(db: D1Database, request: Request) {
  const token = bearerToken(request);
  if (!token.startsWith("briar_agent_")) {
    throw new HttpError(401, "Invalid agent token");
  }
  const projectId = await findProjectIdByAgentTokenHash(
    db,
    await sha256(token),
  );
  if (!projectId) throw new HttpError(401, "Invalid agent token");
  return projectId;
}

export type ChannelMessageRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
};

export async function handleChannelMessageRoute(
  routeInput: ChannelMessageRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db, attachmentsBucket } = routeInput;
  const { pathname } = url;

  const projectChannelMessagesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages$/u,
  );
  if (projectChannelMessagesMatch && request.method === "GET") {
    const requestedProjectId = projectChannelMessagesMatch[1];
    const channelId = projectChannelMessagesMatch[2];
    const authenticatedProjectId = await requireAgentProject(db, request);
    if (authenticatedProjectId !== requestedProjectId) {
      throw new HttpError(403, "Agent token is not valid for this project");
    }

    const channel = await getProjectAgentChannel(
      db,
      requestedProjectId,
      channelId,
    );
    if (!channel) {
      const organizationChannel = await getProjectOrganizationChannel(
        db,
        requestedProjectId,
        channelId,
      );
      if (!organizationChannel) throw new HttpError(404, "Channel not found");
      throw new HttpError(
        403,
        "No Project Agent for this project has access to the channel",
      );
    }

    const searchParams = new URL(request.url).searchParams;
    const query = decodeChannelMessageQuery({
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor"),
      parentMessageId: searchParams.get("parentMessageId"),
    });
    if (
      query.parentMessageId &&
      !(await isChannelRootMessage(db, channel.id, query.parentMessageId))
    ) {
      throw new HttpError(404, "Thread parent message not found");
    }
    const page = await listChannelMessagePage(db, {
      channelId: channel.id,
      parentMessageId: query.parentMessageId,
      cursor: query.cursor,
      limit: query.limit,
    });
    if (!page) {
      throw new HttpError(400, "Cursor does not belong to this message view");
    }
    return privateNoStoreJson({ channel: channelJson(channel), ...page });
  }

  const channelMessagesMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages$/u,
  );
  const channelAttachmentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u,
  );
  const channelDocumentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/document$/u,
  );
  if (channelDocumentMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    await requireChannelAccess(
      db,
      channelDocumentMatch[1],
      channelDocumentMatch[2],
      session.user.id,
    );
    const document = await getChannelMessageDocument(
      db,
      channelDocumentMatch[2],
      channelDocumentMatch[3],
    );
    if (!document) throw new HttpError(404, "Document not found");
    return privateNoStoreJson({
      document: {
        messageId: document.message_id,
        title: document.title,
        markdown: document.markdown,
        projectId: document.project_id,
      },
    });
  }
  if (
    channelAttachmentMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const session = await requireSession(auth, request);
    await requireChannelAccess(
      db,
      channelAttachmentMatch[1],
      channelAttachmentMatch[2],
      session.user.id,
    );
    const attachment = await getChannelMessageAttachment(
      db,
      channelAttachmentMatch[1],
      channelAttachmentMatch[2],
      channelAttachmentMatch[3],
      channelAttachmentMatch[4],
    );
    if (!attachment) throw new HttpError(404, "Attachment not found");
    if (request.method === "HEAD") {
      const object = await attachmentsBucket.head(attachment.object_key);
      if (!object) throw new HttpError(404, "Attachment not found");
      return channelAttachmentResponse(attachment, object, null);
    }
    const object = await attachmentsBucket.get(attachment.object_key);
    if (!object) throw new HttpError(404, "Attachment not found");
    return channelAttachmentResponse(attachment, object, object.body);
  }
  if (channelMessagesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelMessagesMatch[1],
      channelMessagesMatch[2],
      session.user.id,
    );
    const searchParams = new URL(request.url).searchParams;
    const parentMessageId = searchParams.get("parentMessageId");
    const paginated = searchParams.has("limit") || searchParams.has("cursor");
    if (paginated) {
      const query = decodeProjectChannelMessageQuery({
        limit: searchParams.get("limit") ?? undefined,
        cursor: searchParams.get("cursor"),
        parentMessageId,
      });
      const page = await listChannelMessagePage(db, {
        channelId: channel.id,
        parentMessageId: query.parentMessageId,
        cursor: query.cursor,
        limit: query.limit,
      });
      if (!page) {
        throw new HttpError(400, "Cursor does not belong to this message view");
      }
      return json(page);
    }
    return json({
      messages: parentMessageId
        ? await listChannelThreadMessages(db, channel.id, parentMessageId)
        : await listChannelRootMessages(db, channel.id),
      nextCursor: null,
    });
  }
  if (channelMessagesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = channelMessagesMatch[1];
    const channel = await requireChannelAccess(
      db,
      organizationId,
      channelMessagesMatch[2],
      session.user.id,
    );
    if (channel.archived_at) {
      throw new HttpError(409, "Channel is archived");
    }
    const { input: rawInput, attachments, attachmentReferences } =
      await readChannelMessageRequest(request);
    if (
      rawInput.preferredDeviceId &&
      !(await userOwnsExecutionWorkerDevice(db, {
        organizationId,
        userId: session.user.id,
        deviceId: rawInput.preferredDeviceId,
      }))
    ) {
      throw new HttpError(
        403,
        "Preferred Worker device is not owned by the current user in this organization",
      );
    }
    const roster = await hydrateAgentSkills(
      db,
      await listChannelAgents(db, channel.id),
    );
    const implicitDirectAgent =
      channel.kind === "dm" &&
        channel.member_count === 1 &&
        roster.length === 1 &&
        rawInput.mentionedAgentIds.length === 0
        ? roster[0]
        : null;
    const invokedAgentIds = implicitDirectAgent
      ? [implicitDirectAgent.id]
      : rawInput.mentionedAgentIds;
    const mentionedAgents = invokedAgentIds.map((agentId) => {
      const agent = roster.find((candidate) => candidate.id === agentId);
      if (!agent) {
        throw new HttpError(400, "Mentioned Agent is not in this channel");
      }
      return agent;
    });
    for (const userId of rawInput.mentionedUserIds) {
      if (!(await getOrganizationRole(db, organizationId, userId))) {
        throw new HttpError(400, "Mentioned member is not in this organization");
      }
    }
    const createdAt = new Date().toISOString();
    const messageId = rawInput.clientMessageId ?? crypto.randomUUID();
    const storedAttachments = prepareStoredAttachments(attachments, () => {
      const id = crypto.randomUUID();
      return {
        id,
        organization_id: organizationId,
        object_key:
          `channel-attachments/${organizationId}/${channel.id}/${messageId}/${id}`,
      };
    });
    const input = {
      ...rawInput,
      body: canonicalizeIssueAttachmentReferences(
        rawInput.body,
        attachmentReferences,
        storedAttachments.map((attachment) => attachment.id),
      ) ?? rawInput.body,
    };
    const invokedAgents = await Promise.all(
      mentionedAgents.map(async (agent) => {
        const hasAvailableWorker = await hasAvailableChannelReplyWorker(db, {
          organizationId,
          projectId: agent.project_id,
          provider: agent.provider,
          model: agent.model,
          effort: agent.effort,
          observedAt: createdAt,
        });
        const unavailableReason:
          | typeof channelReplyNoAvailableWorkerError
          | null = hasAvailableWorker
            ? null
            : channelReplyNoAvailableWorkerError;
        return { agent, unavailableReason };
      }),
    );
    const uploadedKeys: string[] = [];
    let message = null;
    try {
      await uploadStoredAttachments(
        attachmentsBucket,
        storedAttachments,
        uploadedKeys,
        (attachment) => ({
          attachmentId: attachment.id,
          channelId: channel.id,
          messageId,
          organizationId,
        }),
      );
      message = await createChannelMessage(db, {
        id: messageId,
        channelId: channel.id,
        parentMessageId: input.parentMessageId,
        authorUserId: session.user.id,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentProvider: null,
        body: input.body,
        mentionedUserIds: input.mentionedUserIds,
        mentionedAgentIds: input.mentionedAgentIds,
        attachments: storedAttachments.map(({ file: _file, ...attachment }) =>
          attachment
        ),
        createdAt,
      });
      if (!message) throw new HttpError(404, "Thread message not found");
    } catch (error) {
      if (uploadedKeys.length > 0) {
        try {
          await attachmentsBucket.delete(uploadedKeys);
        } catch (cleanupError) {
          console.error(JSON.stringify({
            message: "Failed channel upload cleanup",
            organizationId,
            channelId: channel.id,
            messageId,
            attachmentCount: uploadedKeys.length,
            error: cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
          }));
        }
      }
      throw error;
    }
    const agentReplies = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId: channel.id,
      triggerMessageId: message.id,
      parentMessageId: agentReplyParentMessageId(message),
      agents: invokedAgents.map(({ agent, unavailableReason }) => ({
        id: agent.id,
        projectId: agent.project_id,
        skillId: null,
        provider: agent.provider,
        unavailableReason,
      })),
      preferredDeviceId: input.preferredDeviceId,
      createdAt,
    });
    return json({
      message,
      agentReplies: agentReplies.map(channelReplyJson),
    }, 201);
  }

  const channelThreadSubscriptionMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/subscription$/u,
  );
  if (
    channelThreadSubscriptionMatch &&
    (request.method === "PUT" || request.method === "DELETE")
  ) {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelThreadSubscriptionMatch[1],
      channelThreadSubscriptionMatch[2],
      session.user.id,
    );
    const rootMessageId = await resolveChannelThreadRootId(
      db,
      channel.id,
      channelThreadSubscriptionMatch[3],
    );
    if (!rootMessageId) throw new HttpError(404, "Message not found");
    if (request.method === "DELETE") {
      await unsubscribeChannelThread(
        db,
        channel.id,
        rootMessageId,
        session.user.id,
      );
    } else {
      await subscribeChannelThread(
        db,
        channel.id,
        rootMessageId,
        session.user.id,
        new Date().toISOString(),
      );
    }
    return json({
      rootMessageId,
      subscribers: await listChannelThreadSubscriptions(
        db,
        channel.id,
        rootMessageId,
      ),
    });
  }

  const channelMessageReactionMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/reactions$/u,
  );
  if (channelMessageReactionMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelMessageReactionMatch[1],
      channelMessageReactionMatch[2],
      session.user.id,
    );
    if (channel.archived_at) {
      throw new HttpError(409, "Channel is archived");
    }
    const input = decodeChannelMessageReactionInput(
      await readJson(request, 1_024),
    );
    if (!isChannelReactionEmoji(input.emoji)) {
      throw new HttpError(400, "Reaction must be a single emoji");
    }
    const message = await toggleChannelMessageReaction(db, {
      channelId: channel.id,
      messageId: channelMessageReactionMatch[3],
      userId: session.user.id,
      emoji: input.emoji,
      createdAt: new Date().toISOString(),
    });
    if (!message) throw new HttpError(404, "Message not found");
    return json({ message });
  }

  const channelAgentRepliesMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/agent-replies$/u,
  );
  if (channelAgentRepliesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const channel = await requireChannelAccess(
      db,
      channelAgentRepliesMatch[1],
      channelAgentRepliesMatch[2],
      session.user.id,
    );
    const jobs = await listChannelAgentReplies(
      db,
      channel.id,
      channelAgentRepliesMatch[3],
    );
    const replies = await Promise.all(
      jobs
        .filter((job) => job.status === "completed")
        .map((job) => getChannelMessage(db, channel.id, job.reply_message_id)),
    );
    return json({
      agentReplies: jobs.map(channelReplyJson),
      messages: replies.filter((reply) => reply !== null),
    });
  }

  return undefined;
}
