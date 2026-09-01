import {
  issueReplyAgentIds,
} from "../../src/lib/issue-reply-decision";
import { maxIssueAttachmentCount } from "../../src/lib/issue-attachments";
import {
  issueAttachmentReferences,
  isIssueAttachmentReference,
} from "../../src/lib/issue-markdown";
import type { BriarAuth } from "./auth";
import { getDashboardSyncCursor, listDashboardChanges } from "./dashboard-change-repository";
import {
  deleteIssueMessage,
  getHuntRunForProject,
  getIssueAgentReplyJob,
  getIssueAttachment,
  getIssueMessage,
  getProject,
  getProjectAgent,
  listIssueActionProposals,
  listIssueAgentReplyJobs,
  listIssueAgentSkillExecutionProposals,
  listIssueAttachments,
  listIssueExecutionProposals,
  listIssueReworkProposals,
  listIssueThreadMessages,
  updateIssueMessage,
  type IssueMessageRow,
} from "./db";
import {
  HttpError,
  json,
} from "./http-response";
import { sha256 } from "./crypto-digest";
import { hasOrganizationCapability } from "./organization-access";
import { issueAttachmentResponse } from "./issue-attachment-service";
import {
  issueAgentReplyJson,
  issueMessageJson,
} from "./issue-conversation-json";
import {
  listIssueMessagesWithArchive,
  loadIssueConversationSnapshot,
} from "./issue-conversation-service";
import {
  decodeIssueMessageEditInput,
  decodeIssueMessageInput,
} from "./issue-request-contract";
import {
  commitIssueMessageMutation,
  findIssueMessageMutationReceipt,
  issueMessageAggregateExists,
  type IssueMessageReplyPlan,
} from "./issue-message-mutation-repository";
import { decodeIssueMessageMutationReceiptResponse } from "./issue-mutation-receipt-contract";
import { resolveIssueAttachmentUploads } from "./issue-attachment-upload-repository";
import { getOrganizationRole } from "./organization-repository";
import { issueProcessingAgentSkillRow } from "./agent-skills";

type RequireRunExecutionProject = (
  db: D1Database,
  request: Request,
  runId: string,
) => Promise<string>;

type RequireProjectAccess = (
  auth: BriarAuth,
  db: D1Database,
  request: Request,
  projectId: string,
) => Promise<void>;

const workerBearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice(7).startsWith("briar_worker_")
    : false;
};

type IssueConversationApplicationInput = {
  db: D1Database;
  projectId: string;
  runId: string;
  userId: string;
};

type ArchivedIssueConversationApplicationInput =
  IssueConversationApplicationInput & { archivesBucket: R2Bucket };

async function requireIssueConversationProject(
  input: IssueConversationApplicationInput,
) {
  const project = await getProject(input.db, input.projectId, input.userId);
  if (!project) throw new HttpError(404, "Project not found");
  return project;
}

async function requireIssueConversation(
  input: IssueConversationApplicationInput,
) {
  const project = await requireIssueConversationProject(input);
  const run = await getHuntRunForProject(input.db, project.id, input.runId);
  if (!run) throw new HttpError(404, "Run not found");
  return { project, run };
}

export async function listProjectIssueMessages(
  input: ArchivedIssueConversationApplicationInput,
) {
  const { project, run } = await requireIssueConversation(input);
  const cursor = await getDashboardSyncCursor(input.db, project.id);
  return {
    cursor,
    ...(await loadIssueConversationSnapshot(
      input.db,
      input.archivesBucket,
      project.id,
      run.id,
    )),
  };
}

export async function syncProjectIssueMessages(
  input: ArchivedIssueConversationApplicationInput & { cursor: number },
) {
  if (!Number.isSafeInteger(input.cursor) || input.cursor < 0) {
    throw new HttpError(400, "A non-negative conversation cursor is required");
  }
  const { project, run } = await requireIssueConversation(input);
  const page = await listDashboardChanges(input.db, project.id, input.cursor);
  if (page.expired) {
    throw new HttpError(
      410,
      "Conversation cursor expired; reload the full snapshot",
      "issue_conversation_cursor_expired",
    );
  }
  const changed = page.changes.some(
    (change) => change.entity_type === "notifications",
  );
  const response = {
    cursor: page.nextCursor,
    hasMore: page.hasMore,
    changed,
  };
  if (changed) {
    Object.assign(
      response,
      await loadIssueConversationSnapshot(
        input.db,
        input.archivesBucket,
        project.id,
        run.id,
      ),
    );
  }
  return response;
}

export async function createProjectIssueMessage(
  input: IssueConversationApplicationInput & {
    request: ReturnType<typeof decodeIssueMessageInput>;
    attachmentIds: readonly string[];
  },
) {
  const project = await requireIssueConversationProject(input);
  if (!hasOrganizationCapability(project.member_role, "conversations:write")) {
    throw new HttpError(403, "Conversation editing permission required");
  }
  const run = await getHuntRunForProject(input.db, project.id, input.runId);
  if (!run) throw new HttpError(404, "Run not found");
  const request = decodeIssueMessageInput(input.request);
  if (!request.clientMessageId) {
    throw new HttpError(400, "Client message ID is required");
  }
  const messageId = request.clientMessageId.toLowerCase();
  if (
    input.attachmentIds.length > maxIssueAttachmentCount ||
    new Set(input.attachmentIds).size !== input.attachmentIds.length ||
    !input.attachmentIds.every(isIssueAttachmentReference)
  ) {
    throw new HttpError(400, "Attachment IDs are invalid");
  }
  const parentMessageId = request.parentMessageId?.toLowerCase() ?? null;
  const mentionedUserIds = [...new Set(
    (request.mentionedUserIds ?? []).map((userId) => userId.trim()),
  )].sort();
  const explicitMentionedAgentIds = [...new Set(
    (request.mentionedAgentIds ?? []).map((agentId) =>
      agentId.trim().toLowerCase()
    ),
  )].sort();
  const agentProvider = request.agentConversationId
    ? request.agentConversationId.startsWith(`briar:claude:${project.id}:`)
      ? "claude"
      : request.agentConversationId.startsWith(`briar:grok:${project.id}:`)
        ? "grok"
        : request.agentConversationId.startsWith(`briar:${project.id}:`)
          ? "codex"
          : null
    : null;
  if (request.agentConversationId && !agentProvider) {
    throw new HttpError(
      400,
      "Agent conversation does not belong to this project",
    );
  }
  if (agentProvider && explicitMentionedAgentIds.length > 0) {
    throw new HttpError(400, "Agent-authored messages cannot invoke Agents");
  }
  const requestHash = await sha256(JSON.stringify({
    organizationId: project.organization_id,
    projectId: project.id,
    runId: input.runId,
    userId: input.userId,
    messageId,
    body: request.body,
    parentMessageId,
    mentionedUserIds,
    mentionedAgentIds: explicitMentionedAgentIds,
    agentConversationId: request.agentConversationId ?? null,
    attachmentUploadIds: input.attachmentIds,
  }));
  const conflict = () => new HttpError(
    409,
    "Issue message ID was already used with a different request",
  );
  const completed = (
    receipt: NonNullable<Awaited<ReturnType<
      typeof findIssueMessageMutationReceipt
    >>>,
  ) => {
    if (
      receipt.organization_id !== project.organization_id ||
      receipt.project_id !== project.id ||
      receipt.run_id !== input.runId ||
      receipt.user_id !== input.userId ||
      receipt.request_hash !== requestHash
    ) {
      throw conflict();
    }
    return receipt.response_json;
  };
  const existingReceipt = await findIssueMessageMutationReceipt(
    input.db,
    messageId,
  );
  if (existingReceipt) return completed(existingReceipt);
  if (await issueMessageAggregateExists(input.db, messageId)) {
    throw conflict();
  }

  const parent = parentMessageId
    ? await getIssueMessage(input.db, project.id, input.runId, parentMessageId)
    : null;
  if (parentMessageId && !parent) {
    throw new HttpError(404, "Thread message not found");
  }
  for (const mentionedUserId of mentionedUserIds) {
    if (
      !mentionedUserId ||
      !(await getOrganizationRole(
        input.db,
        project.organization_id,
        mentionedUserId,
      ))
    ) {
      throw new HttpError(400, "Mentioned member is not in this organization");
    }
  }
  const explicitlyMentionedAgents = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof getProjectAgent>>>
  >();
  if (!agentProvider) {
    for (const agentId of explicitMentionedAgentIds) {
      const agent = await getProjectAgent(input.db, project.id, agentId);
      if (!agent) {
        throw new HttpError(400, "Mentioned Agent is not in this project");
      }
      explicitlyMentionedAgents.set(agent.id, agent);
    }
  }
  const threadMessages = parentMessageId
    ? await listIssueThreadMessages(
        input.db,
        project.id,
        input.runId,
        parentMessageId,
      )
    : [];
  const targetAgentIds = (agentProvider
    ? []
    : issueReplyAgentIds(
        threadMessages.map((threadMessage) => ({
          id: threadMessage.id,
          parentMessageId: threadMessage.parent_message_id,
          body: threadMessage.body,
          author: {
            agentId: threadMessage.author_agent_id,
            provider: threadMessage.author_agent_provider,
          },
        })),
        {
          mentionedAgentIds: explicitMentionedAgentIds,
          parentMessageId,
        },
      )).sort();
  const targetAgents = new Map(explicitlyMentionedAgents);
  for (const agentId of targetAgentIds) {
    if (targetAgents.has(agentId)) continue;
    const agent = await getProjectAgent(input.db, project.id, agentId);
    if (agent) targetAgents.set(agent.id, agent);
  }

  const bodyAttachmentIds = [...issueAttachmentReferences(request.body)];
  if (bodyAttachmentIds.length > maxIssueAttachmentCount) {
    throw new HttpError(400, "Issue message has too many attachment references");
  }
  const existingAttachments = (await listIssueAttachments(
    input.db,
    project.id,
    input.runId,
  )).filter((attachment) => bodyAttachmentIds.includes(attachment.id));
  const existingAttachmentIds = new Set(
    existingAttachments.map((attachment) => attachment.id),
  );
  const uploadIdSet = new Set(input.attachmentIds);
  const existingReferencedAttachmentIds = bodyAttachmentIds.filter((id) =>
    !uploadIdSet.has(id)
  );
  if (
    bodyAttachmentIds.some((id) =>
      !uploadIdSet.has(id) && !existingAttachmentIds.has(id)
    )
  ) {
    throw new HttpError(
      400,
      "Issue message references an attachment outside this run",
    );
  }

  const createdAt = new Date().toISOString();
  const uploads = await resolveIssueAttachmentUploads(input.db, {
    purpose: "issue_message",
    organizationId: project.organization_id,
    projectId: project.id,
    userId: input.userId,
    mutationId: messageId,
    runId: input.runId,
    uploadIds: input.attachmentIds,
    observedAt: createdAt,
  });
  if (!uploads) {
    throw new HttpError(
      409,
      "Issue message attachments are unavailable, expired, or already consumed",
    );
  }
  const uploadedAttachments = uploads.map((upload) => ({
    id: upload.upload_id,
    run_id: input.runId,
    project_id: project.id,
    object_key: upload.object_key,
    filename: upload.filename,
    content_type: upload.content_type,
    byte_size: upload.byte_size,
    created_at: createdAt,
  }));
  const responseAttachments = [
    ...existingAttachments,
    ...uploadedAttachments,
  ].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id)
  );
  const author = await input.db
    .prepare(
      `select id, name, image from "user" where id = ?`,
    )
    .bind(input.userId)
    .first<{ id: string; name: string; image: string | null }>();
  if (!author) throw new HttpError(403, "Authenticated user no longer exists");
  const replies: IssueMessageReplyPlan[] = [...targetAgents.values()].map(
    (agent) => ({
      id: crypto.randomUUID(),
      replyMessageId: crypto.randomUUID(),
      agentId: agent.id,
      agentName: agent.name,
      agentResponsibility: agent.responsibility,
      preferredWorkerId: run.worker_id,
      preferredProvider: issueProcessingAgentSkillRow(agent.skills ?? [])
        ?.provider ?? agent.provider,
      requiresPreferredWorker: run.worker_id !== null,
    }),
  );
  const message: IssueMessageRow = {
    id: messageId,
    run_id: input.runId,
    parent_message_id: parentMessageId,
    author_user_id: agentProvider ? null : input.userId,
    author_agent_id: null,
    author_agent_name: null,
    author_agent_provider: agentProvider,
    author_name: agentProvider ? null : author.name,
    author_image: agentProvider ? null : author.image,
    author_agent_image: null,
    body: request.body,
    reply_count: 0,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const agentReplies: Array<ReturnType<typeof issueAgentReplyJson>> = replies
    .map((reply) => ({
      id: reply.id,
      triggerMessageId: messageId,
      parentMessageId: parentMessageId ?? messageId,
      agentId: reply.agentId,
      agentName: reply.agentName,
      status: "queued" as const,
      attempts: 0,
      workerId: null,
      provider: null,
      error: null,
      updatedAt: createdAt,
    }));
  const result = decodeIssueMessageMutationReceiptResponse({
    message: issueMessageJson(message, responseAttachments),
    agentReply: agentReplies.length === 1 ? agentReplies[0]! : null,
    agentReplies,
  });
  try {
    await commitIssueMessageMutation(input.db, {
      organizationId: project.organization_id,
      projectId: project.id,
      runId: input.runId,
      userId: input.userId,
      messageId,
      parentMessageId,
      authorAgentProvider: agentProvider,
      body: request.body,
      mentionedUserIds,
      targetAgentIds: [...targetAgents.keys()],
      attachments: uploadedAttachments,
      uploadIds: input.attachmentIds,
      existingAttachmentIds: existingReferencedAttachmentIds,
      replies,
      requestHash,
      response: result,
      committedAt: createdAt,
    });
  } catch (error) {
    const concurrentReceipt = await findIssueMessageMutationReceipt(
      input.db,
      messageId,
    );
    if (concurrentReceipt) return completed(concurrentReceipt);
    if (await issueMessageAggregateExists(input.db, messageId)) {
      throw conflict();
    }
    if (
      input.attachmentIds.length > 0 ||
      existingReferencedAttachmentIds.length > 0
    ) {
      throw new HttpError(
        409,
        "Issue message attachments changed while the message was being created",
      );
    }
    throw error;
  }
  return result;
}

export async function updateProjectIssueMessage(
  input: IssueConversationApplicationInput & {
    messageId: string;
    request: unknown;
  },
) {
  const project = await requireIssueConversationProject(input);
  if (!hasOrganizationCapability(project.member_role, "conversations:write")) {
    throw new HttpError(403, "Conversation editing permission required");
  }
  const request = decodeIssueMessageEditInput(input.request);
  const message = await getIssueMessage(
    input.db,
    project.id,
    input.runId,
    input.messageId,
  );
  if (!message) throw new HttpError(404, "Message not found");
  if (message.author_user_id !== input.userId) {
    throw new HttpError(403, "Only the author can edit this message");
  }
  const updated = await updateIssueMessage(
    input.db,
    project.id,
    input.runId,
    message.id,
    {
      body: request.body,
      mentionedUserIds: request.mentionedUserIds,
      updatedAt: new Date().toISOString(),
    },
  );
  if (!updated) throw new HttpError(404, "Message not found");
  const [
    attachments,
    reworkProposals,
    actionProposals,
    executionProposals,
    skillExecutionProposals,
  ] = await Promise.all([
    listIssueAttachments(input.db, project.id, input.runId),
    listIssueReworkProposals(input.db, project.id, input.runId),
    listIssueActionProposals(input.db, project.id, input.runId),
    listIssueExecutionProposals(input.db, project.id, input.runId),
    listIssueAgentSkillExecutionProposals(input.db, project.id, input.runId),
  ]);
  const proposal = [...reworkProposals, ...actionProposals].find(
    (candidate) => candidate.reply_message_id === updated.id,
  ) ?? null;
  const executionProposal = executionProposals.find(
    (candidate) => candidate.reply_message_id === updated.id,
  ) ?? null;
  return {
    message: issueMessageJson(
      updated,
      attachments,
      proposal,
      executionProposal,
      skillExecutionProposals.find(
        (candidate) => candidate.reply_message_id === updated.id,
      ) ?? null,
    ),
  };
}

export async function deleteProjectIssueMessage(
  input: IssueConversationApplicationInput & {
    messageId: string;
  },
) {
  const project = await requireIssueConversationProject(input);
  if (!hasOrganizationCapability(project.member_role, "conversations:write")) {
    throw new HttpError(403, "Conversation editing permission required");
  }
  const message = await getIssueMessage(
    input.db,
    project.id,
    input.runId,
    input.messageId,
  );
  if (!message) throw new HttpError(404, "Message not found");
  if (message.author_user_id !== input.userId) {
    throw new HttpError(403, "Only the author can delete this message");
  }
  const deleted = await deleteIssueMessage(
    input.db,
    project.id,
    input.runId,
    message.id,
  );
  if (!deleted) throw new HttpError(404, "Message not found");
  return { deleted: true as const };
}

export async function getProjectIssueAgentReply(
  input: ArchivedIssueConversationApplicationInput & {
    triggerMessageId: string;
  },
) {
  const project = await requireIssueConversationProject(input);
  const replyJobs = (await listIssueAgentReplyJobs(
    input.db,
    project.id,
    input.runId,
  )).filter(
    (candidate) => candidate.trigger_message_id === input.triggerMessageId,
  );
  const job = replyJobs[0] ?? await getIssueAgentReplyJob(
    input.db,
    project.id,
    input.triggerMessageId,
  );
  if (!job || job.run_id !== input.runId) {
    throw new HttpError(404, "Agent reply not found");
  }
  const [
    messages,
    reworkProposals,
    actionProposals,
    executionProposals,
    skillExecutionProposals,
  ] = replyJobs.some((candidate) => candidate.status === "completed")
    ? await Promise.all([
        listIssueMessagesWithArchive(
          input.db,
          input.archivesBucket,
          project.id,
          job.run_id,
        ),
        listIssueReworkProposals(input.db, project.id, job.run_id),
        listIssueActionProposals(input.db, project.id, job.run_id),
        listIssueExecutionProposals(input.db, project.id, job.run_id),
        listIssueAgentSkillExecutionProposals(
          input.db,
          project.id,
          job.run_id,
        ),
      ])
    : [[], [], [], [], []];
  const reply = messages.find(
    (message) => message.id === job.reply_message_id,
  );
  const replyMessages = messages.filter((message) =>
    replyJobs.some((candidate) => candidate.reply_message_id === message.id)
  );
  const proposal = [...reworkProposals, ...actionProposals].find(
    (candidate) => candidate.reply_message_id === job.reply_message_id,
  ) ?? null;
  return {
    agentReply: issueAgentReplyJson(job),
    agentReplies: replyJobs.map(issueAgentReplyJson),
    message: reply
      ? issueMessageJson(
          reply,
          [],
          proposal,
          executionProposals.find(
            (candidate) => candidate.reply_message_id === job.reply_message_id,
          ) ?? null,
          skillExecutionProposals.find(
            (candidate) => candidate.reply_message_id === job.reply_message_id,
          ) ?? null,
        )
      : null,
    messages: replyMessages.map((replyMessage) =>
      issueMessageJson(
        replyMessage,
        [],
        [...reworkProposals, ...actionProposals].find(
          (candidate) => candidate.reply_message_id === replyMessage.id,
        ) ?? null,
        executionProposals.find(
          (candidate) => candidate.reply_message_id === replyMessage.id,
        ) ?? null,
        skillExecutionProposals.find(
          (candidate) => candidate.reply_message_id === replyMessage.id,
        ) ?? null,
      )
    ),
  };
}

export async function handleIssueConversationRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  archivesBucket: R2Bucket;
  requireRunExecutionProject: RequireRunExecutionProject;
  requireProjectAccess: RequireProjectAccess;
}): Promise<Response | undefined> {
  const {
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    requireRunExecutionProject,
    requireProjectAccess,
  } = input;

  const attachmentMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u,
  );
  if (
    attachmentMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    if (workerBearerToken(request)) {
      if (
        (await requireRunExecutionProject(db, request, attachmentMatch[2])) !==
        attachmentMatch[1]
      ) {
        throw new HttpError(404, "Attachment not found");
      }
    } else {
      await requireProjectAccess(auth, db, request, attachmentMatch[1]);
    }
    const attachment = await getIssueAttachment(
      db,
      attachmentMatch[1],
      attachmentMatch[2],
      attachmentMatch[3],
    );
    if (!attachment) throw new HttpError(404, "Attachment not found");
    if (request.method === "HEAD") {
      const object = await attachmentsBucket.head(attachment.object_key);
      if (!object) throw new HttpError(404, "Attachment not found");
      return issueAttachmentResponse(attachment, object, null);
    }
    const object = await attachmentsBucket.get(attachment.object_key);
    if (!object) throw new HttpError(404, "Attachment not found");
    return issueAttachmentResponse(attachment, object, object.body);
  }

  return undefined;
}
