import {
  isIssueAttachmentReference,
  issueAttachmentReferences,
} from "../../src/lib/issue-markdown";
import { maxIssueAttachmentCount } from "../../src/lib/issue-attachments";
import {
  channelReplyAssignedWorkerUnavailableError,
  channelReplyNoAvailableWorkerError,
  channelReplyProviderUsageExhaustedError,
  type ChannelReplyUnavailableReason,
} from "../../src/lib/channels-contract";
import { hydrateAgentSkills } from "./agent-skills";
import { processArchiveCleanupQueue } from "./archive";
import type { BriarAuth } from "./auth";
import { channelAttachmentResponse } from "./channel-attachment-response";
import {
  requireChannelAccess,
  requireChannelWriteAccess,
} from "./channel-route-access";
import { decodeChannelMessageReactionInput } from "./channel-route-decoders";
import {
  channelReplyJson,
  createChannelMessage,
  deleteChannelMessage,
  getChannelMessage,
  getChannelMessageAttachment,
  getChannelReplySessionForThread,
  isChannelReactionEmoji,
  listChannelAgents,
  listChannelAgentReplies,
  listChannelMessagePage,
  listChannelRootMessages,
  listChannelThreadMessages,
  listChannelThreadSubscriptions,
  resolveChannelThreadRootId,
  subscribeChannelThread,
  toggleChannelMessageReaction,
  unsubscribeChannelThread,
} from "./channels";
import { HttpError } from "./http-response";
import { getOrganizationRole } from "./organization-repository";
import {
  decodeProjectChannelMessageQuery,
} from "./query-contract";
import { requireSession } from "./session-auth";
import {
  channelReplyWorkerAvailability,
  userOwnsExecutionWorkerDevice,
} from "./workers";
import { schedulePostCommitCleanup } from "./post-commit-cleanup";
import {
  decodeChannelMessageApplicationInput,
} from "./app-mutation-request-mappers";
import { sha256 } from "./crypto-digest";
import {
  findChannelMessageMutationReceipt,
  resolveChannelMessageUploads,
} from "./channel-message-upload-repository";

export type ChannelMessageRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  env: Env;
  context?: ExecutionContext;
};

type ChannelMessageApplicationInput = {
  db: D1Database;
  organizationId: string;
  channelId: string;
  userId: string;
};

export async function listOrganizationChannelMessages(
  input: ChannelMessageApplicationInput & {
    parentMessageId?: string | null;
    cursor?: string | null;
    limit?: string | number | null;
  },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  const paginated = input.limit !== undefined && input.limit !== null ||
    input.cursor !== undefined && input.cursor !== null;
  if (paginated) {
    const query = decodeProjectChannelMessageQuery({
      limit: input.limit === undefined || input.limit === null
        ? undefined
        : String(input.limit),
      cursor: input.cursor ?? null,
      parentMessageId: input.parentMessageId ?? null,
    });
    const page = await listChannelMessagePage(input.db, {
      channelId: channel.id,
      parentMessageId: query.parentMessageId,
      cursor: query.cursor,
      limit: query.limit,
      includeRepliesInTimeline: channel.kind === "dm",
    });
    if (!page) {
      throw new HttpError(400, "Cursor does not belong to this message view");
    }
    return page;
  }
  return {
    messages: input.parentMessageId
      ? await listChannelThreadMessages(
          input.db,
          channel.id,
          input.parentMessageId,
        )
      : await listChannelRootMessages(input.db, channel.id),
    nextCursor: null,
  };
}

const channelMessageMutationRequestHash = (input: {
  organizationId: string;
  channelId: string;
  userId: string;
  messageId: string;
  body: string;
  parentMessageId: string | null;
  mentionedUserIds: readonly string[];
  mentionedAgentIds: readonly string[];
  skillId: string | null;
  preferredDeviceId: string | null;
  attachmentIds: readonly string[];
}) => sha256(JSON.stringify(input));

const channelMessageMutationConflict = () =>
  new HttpError(
    409,
    "Channel message ID was already used with a different request",
  );

async function completedChannelMessageMutation(
  db: D1Database,
  channelId: string,
  messageId: string,
) {
  const message = await getChannelMessage(db, channelId, messageId);
  if (!message) {
    throw new HttpError(409, "Channel message receipt is incomplete");
  }
  return {
    message,
    agentReplies: (
      await listChannelAgentReplies(db, channelId, messageId)
    ).map(channelReplyJson),
  };
}

export async function createOrganizationChannelMessage(
  input: ChannelMessageApplicationInput & {
    request: ReturnType<typeof decodeChannelMessageApplicationInput>;
    attachmentIds: readonly string[];
  },
) {
  const channel = await requireChannelWriteAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  const request = input.request;
  if (!request.clientMessageId) {
    throw new HttpError(400, "Client message ID is required");
  }
  const messageId = request.clientMessageId;
  if (
    input.attachmentIds.length > maxIssueAttachmentCount ||
    new Set(input.attachmentIds).size !== input.attachmentIds.length ||
    !input.attachmentIds.every(isIssueAttachmentReference)
  ) {
    throw new HttpError(400, "Attachment IDs are invalid");
  }
  const requestHash = await channelMessageMutationRequestHash({
    organizationId: input.organizationId,
    channelId: channel.id,
    userId: input.userId,
    messageId,
    body: request.body,
    parentMessageId: request.parentMessageId,
    mentionedUserIds: request.mentionedUserIds,
    mentionedAgentIds: request.mentionedAgentIds,
    skillId: request.skillId,
    preferredDeviceId: request.preferredDeviceId,
    attachmentIds: input.attachmentIds,
  });
  const existingReceipt = await findChannelMessageMutationReceipt(
    input.db,
    messageId,
  );
  if (existingReceipt) {
    if (
      existingReceipt.organization_id !== input.organizationId ||
      existingReceipt.channel_id !== channel.id ||
      existingReceipt.user_id !== input.userId ||
      existingReceipt.request_hash !== requestHash
    ) {
      throw channelMessageMutationConflict();
    }
    return completedChannelMessageMutation(input.db, channel.id, messageId);
  }
  if (channel.archived_at) {
    throw new HttpError(409, "Channel is archived");
  }
  const bodyAttachmentIds = issueAttachmentReferences(request.body);
  if (
    bodyAttachmentIds.size !== input.attachmentIds.length ||
    !input.attachmentIds.every((id) => bodyAttachmentIds.has(id))
  ) {
    throw new HttpError(
      400,
      "Channel message body must reference exactly the attached uploads",
    );
  }
  if (
    request.parentMessageId &&
    (await resolveChannelThreadRootId(
      input.db,
      channel.id,
      request.parentMessageId,
    )) !== request.parentMessageId
  ) {
    throw new HttpError(404, "Thread message not found");
  }
  if (
    request.preferredDeviceId &&
    !(await userOwnsExecutionWorkerDevice(input.db, {
      organizationId: input.organizationId,
      userId: input.userId,
      deviceId: request.preferredDeviceId,
    }))
  ) {
    throw new HttpError(
      403,
      "Preferred Worker device is not owned by the current user in this organization",
    );
  }
  const roster = await hydrateAgentSkills(
    input.db,
    await listChannelAgents(input.db, channel.id),
  );
  if (request.skillId && channel.kind !== "dm") {
    throw new HttpError(
      400,
      "Agent Skill commands are only available in direct messages",
    );
  }
  const selectedSkillTarget = request.skillId
    ? roster.flatMap((agent) =>
        agent.skills
          .filter((skill) => skill.id === request.skillId)
          .map((skill) => ({ agent, skill }))
      )[0] ?? null
    : null;
  if (request.skillId && !selectedSkillTarget) {
    throw new HttpError(400, "Selected Agent Skill is not in this channel");
  }
  const implicitDirectAgent = channel.kind === "dm" &&
      channel.member_count === 1 &&
      roster.length === 1 &&
      request.mentionedAgentIds.length === 0
    ? roster[0]
    : null;
  const invokedAgentIds = implicitDirectAgent
    ? [implicitDirectAgent.id]
    : request.mentionedAgentIds;
  const mentionedAgents = invokedAgentIds.map((agentId) => {
    const agent = roster.find((candidate) => candidate.id === agentId);
    if (!agent) {
      throw new HttpError(400, "Mentioned Agent is not in this channel");
    }
    return agent;
  });
  if (
    selectedSkillTarget &&
    !mentionedAgents.some((agent) => agent.id === selectedSkillTarget.agent.id)
  ) {
    throw new HttpError(400, "Selected Agent Skill was not invoked");
  }
  for (const userId of request.mentionedUserIds) {
    if (!(await getOrganizationRole(input.db, input.organizationId, userId))) {
      throw new HttpError(400, "Mentioned member is not in this organization");
    }
  }
  const createdAt = new Date().toISOString();
  const uploads = await resolveChannelMessageUploads(input.db, {
    organizationId: input.organizationId,
    channelId: channel.id,
    userId: input.userId,
    messageId,
    uploadIds: input.attachmentIds,
    observedAt: createdAt,
  });
  if (!uploads) {
    throw new HttpError(
      409,
      "Channel attachments are unavailable, expired, or already consumed",
    );
  }
  const invokedAgents = await Promise.all(
    mentionedAgents.map(async (agent) => {
      const selectedSkill = selectedSkillTarget?.agent.id === agent.id
        ? selectedSkillTarget.skill
        : null;
      const retainedSession = await getChannelReplySessionForThread(input.db, {
        channelId: channel.id,
        threadRootMessageId: request.parentMessageId ?? messageId,
        agentId: agent.id,
      });
      const liveSession = retainedSession && retainedSession.retained_until > createdAt
        ? retainedSession
        : null;
      const replyRuntime = selectedSkill?.execution_mode === "conversation"
        ? liveSession ?? agent
        : selectedSkill ?? agent;
      const assignedWorkerId = liveSession
        ? liveSession.owner_worker_id
        : agent.designated_worker_id;
      const assignedWorkerLabel = liveSession
        ? liveSession.owner_worker_label
        : agent.designated_worker_label;
      const workerAvailability = await channelReplyWorkerAvailability(input.db, {
        organizationId: input.organizationId,
        projectId: agent.project_id,
        preferredDeviceId: liveSession?.owner_device_id ?? null,
        preferredWorkerId: assignedWorkerId,
        provider: replyRuntime.provider,
        model: replyRuntime.model,
        effort: replyRuntime.effort,
        observedAt: createdAt,
      });
      const unavailableReason: ChannelReplyUnavailableReason | null =
        workerAvailability === "available"
          ? null
          : assignedWorkerId
          ? channelReplyAssignedWorkerUnavailableError(
              assignedWorkerLabel ?? assignedWorkerId,
            )
          : workerAvailability === "usage_exhausted"
          ? channelReplyProviderUsageExhaustedError
          : channelReplyNoAvailableWorkerError;
      return { agent, selectedSkill, replyRuntime, unavailableReason };
    }),
  );
  let message = null;
  try {
    message = await createChannelMessage(input.db, {
      id: messageId,
      channelId: channel.id,
      parentMessageId: request.parentMessageId,
      authorUserId: input.userId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: request.body,
      mentionedUserIds: request.mentionedUserIds,
      mentionedAgentIds: request.mentionedAgentIds,
      attachments: uploads.map((upload) => ({
        id: upload.upload_id,
        organization_id: upload.organization_id,
        object_key: upload.object_key,
        filename: upload.filename,
        content_type: upload.content_type,
        byte_size: upload.byte_size,
      })),
      mutationCommit: {
        organizationId: input.organizationId,
        channelId: channel.id,
        userId: input.userId,
        messageId,
        uploadIds: input.attachmentIds,
        requestHash,
        committedAt: createdAt,
      },
      agentReplyEnqueue: {
        organizationId: input.organizationId,
        channelId: channel.id,
        triggerMessageId: messageId,
        parentMessageId: request.parentMessageId ?? messageId,
        agents: invokedAgents.map(({
          agent,
          selectedSkill,
          replyRuntime,
          unavailableReason,
        }) => ({
          id: agent.id,
          projectId: agent.project_id,
          skillId: selectedSkill?.id ?? null,
          provider: replyRuntime.provider,
          unavailableReason,
        })),
        preferredDeviceId: request.preferredDeviceId,
        createdAt,
      },
      createdAt,
    });
    if (!message) throw new HttpError(404, "Thread message not found");
  } catch (error) {
    const concurrentReceipt = await findChannelMessageMutationReceipt(
      input.db,
      messageId,
    );
    if (concurrentReceipt) {
      if (
        concurrentReceipt.organization_id === input.organizationId &&
        concurrentReceipt.channel_id === channel.id &&
        concurrentReceipt.user_id === input.userId &&
        concurrentReceipt.request_hash === requestHash
      ) {
        return completedChannelMessageMutation(input.db, channel.id, messageId);
      }
      throw channelMessageMutationConflict();
    }
    if (await getChannelMessage(input.db, channel.id, messageId)) {
      throw channelMessageMutationConflict();
    }
    if (input.attachmentIds.length > 0) {
      throw new HttpError(
        409,
        "Channel attachments changed while the message was being created",
      );
    }
    throw error;
  }
  const agentReplies = await listChannelAgentReplies(
    input.db,
    channel.id,
    message.id,
  );
  return {
    message,
    agentReplies: agentReplies.map(channelReplyJson),
  };
}

export async function deleteOrganizationChannelMessage(
  input: ChannelMessageApplicationInput & {
    messageId: string;
    attachmentsBucket: R2Bucket;
    env: Env;
    context?: ExecutionContext;
  },
) {
  await requireChannelWriteAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  const observedAt = new Date().toISOString();
  const result = await deleteChannelMessage(input.db, {
    organizationId: input.organizationId,
    channelId: input.channelId,
    messageId: input.messageId,
    userId: input.userId,
    deletedAt: observedAt,
  });
  if (result.outcome === "forbidden") {
    throw new HttpError(403, "Message author or channel manager access required");
  }
  void schedulePostCommitCleanup({
    context: input.context,
    operation: "channel_message_delete",
    observedAt,
    tasks: [{
      queue: "archive",
      run: () => processArchiveCleanupQueue(
        input.db,
        input.env.ARCHIVES,
        input.attachmentsBucket,
        observedAt,
        100,
      ),
    }],
  });
  return {
    deleted: result.outcome === "deleted",
    message: result.message,
    parentMessage: result.parentMessage,
  };
}

export async function setOrganizationChannelThreadSubscription(
  input: ChannelMessageApplicationInput & {
    rootMessageId: string;
    subscribed: boolean;
  },
) {
  const channel = await requireChannelAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  const rootMessageId = await resolveChannelThreadRootId(
    input.db,
    channel.id,
    input.rootMessageId,
  );
  if (!rootMessageId) throw new HttpError(404, "Message not found");
  if (input.subscribed) {
    await subscribeChannelThread(
      input.db,
      channel.id,
      rootMessageId,
      input.userId,
      new Date().toISOString(),
    );
  } else {
    await unsubscribeChannelThread(
      input.db,
      channel.id,
      rootMessageId,
      input.userId,
    );
  }
  return {
    rootMessageId,
    subscribers: await listChannelThreadSubscriptions(
      input.db,
      channel.id,
      rootMessageId,
    ),
  };
}

export async function toggleOrganizationChannelMessageReaction(
  input: ChannelMessageApplicationInput & {
    messageId: string;
    request: unknown;
  },
) {
  const channel = await requireChannelWriteAccess(
    input.db,
    input.organizationId,
    input.channelId,
    input.userId,
  );
  if (channel.archived_at) {
    throw new HttpError(409, "Channel is archived");
  }
  const request = decodeChannelMessageReactionInput(input.request);
  if (!isChannelReactionEmoji(request.emoji)) {
    throw new HttpError(400, "Reaction must be a single emoji");
  }
  const message = await toggleChannelMessageReaction(input.db, {
    channelId: channel.id,
    messageId: input.messageId,
    userId: input.userId,
    emoji: request.emoji,
    createdAt: new Date().toISOString(),
  });
  if (!message) throw new HttpError(404, "Message not found");
  return { message };
}

export async function handleChannelMessageRoute(
  routeInput: ChannelMessageRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db, attachmentsBucket } = routeInput;
  const { pathname } = url;

  const channelAttachmentMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u,
  );
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
  return undefined;
}
