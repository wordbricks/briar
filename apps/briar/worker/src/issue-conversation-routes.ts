import {
  agentReplyDisplayParentMessageId,
  issueReplyAgentIds,
} from "../../src/lib/issue-reply-decision";
import { maxIssueAttachmentCount } from "../../src/lib/issue-attachments";
import {
  canonicalizeIssueAttachmentReferences,
  isIssueAttachmentReference,
} from "../../src/lib/issue-markdown";
import { prepareStoredAttachments, uploadStoredAttachments } from "./attachment-storage";
import type { BriarAuth } from "./auth";
import { getDashboardSyncCursor, listDashboardChanges } from "./dashboard-change-repository";
import {
  createIssueAttachments,
  createIssueMessage,
  deleteIssueAttachments,
  deleteIssueMessage,
  enqueueIssueAgentReply,
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
  type IssueAgentReplyJobRow,
  type IssueMessageRow,
} from "./db";
import { corsHeaders, HttpError, json } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import {
  deleteUnreferencedUploadedIssueObjects,
  issueAttachmentResponse,
  removeOrphanedIssueAttachments,
} from "./issue-attachment-service";
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
import { readIssueMessageRequest, readJson } from "./request-readers";
import { requireSession } from "./session-auth";

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
  archivesBucket: R2Bucket;
  projectId: string;
  runId: string;
  userId: string;
};

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
  input: IssueConversationApplicationInput,
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
  input: IssueConversationApplicationInput & { cursor: number },
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
    attachmentsBucket: R2Bucket;
    request: unknown;
    attachments: File[];
    attachmentReferences: string[];
  },
) {
  const project = await requireIssueConversationProject(input);
  if (!hasOrganizationCapability(project.member_role, "conversations:write")) {
    throw new HttpError(403, "Conversation editing permission required");
  }
  const run = await getHuntRunForProject(input.db, project.id, input.runId);
  if (!run) throw new HttpError(404, "Run not found");
  if (
    input.attachmentReferences.length > maxIssueAttachmentCount ||
    !input.attachmentReferences.every(isIssueAttachmentReference)
  ) {
    throw new HttpError(400, "Attachment references are invalid");
  }
  const rawRequest = decodeIssueMessageInput(input.request);
  const storedAttachments = prepareStoredAttachments(
    input.attachments,
    () => {
      const id = crypto.randomUUID();
      return {
        id,
        object_key: `issue-attachments/${project.id}/${input.runId}/${id}`,
      };
    },
  );
  const request = {
    ...rawRequest,
    body: canonicalizeIssueAttachmentReferences(
      rawRequest.body,
      input.attachmentReferences,
      storedAttachments.map((attachment) => attachment.id),
    ) ?? rawRequest.body,
  };
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
  const explicitMentionedAgentIds = [...new Set(request.mentionedAgentIds ?? [])];
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
  const createdAt = new Date().toISOString();
  const uploadedKeys: string[] = [];
  let message: IssueMessageRow | null = null;
  try {
    await uploadStoredAttachments(
      input.attachmentsBucket,
      storedAttachments,
      uploadedKeys,
      (attachment) => ({
        attachmentId: attachment.id,
        projectId: project.id,
      }),
    );
    await createIssueAttachments(
      input.db,
      project.id,
      input.runId,
      storedAttachments.map(({ file: _file, ...attachment }) => attachment),
    );
    message = await createIssueMessage(input.db, {
      id: request.clientMessageId ?? crypto.randomUUID(),
      projectId: project.id,
      runId: input.runId,
      parentMessageId: request.parentMessageId ?? null,
      authorUserId: agentProvider ? null : input.userId,
      authorAgentProvider: agentProvider,
      body: request.body,
      mentionedUserIds: agentProvider ? [] : request.mentionedUserIds,
      createdAt,
    });
    if (!message) {
      throw new HttpError(
        404,
        request.parentMessageId ? "Thread message not found" : "Run not found",
      );
    }
  } catch (error) {
    await deleteIssueAttachments(
      input.db,
      project.id,
      input.runId,
      storedAttachments.map((attachment) => attachment.id),
    ).catch(() => undefined);
    await deleteUnreferencedUploadedIssueObjects(
      input.db,
      input.attachmentsBucket,
      uploadedKeys,
    ).catch(() => undefined);
    throw error;
  }
  if (!message) {
    throw new HttpError(
      404,
      request.parentMessageId ? "Thread message not found" : "Run not found",
    );
  }
  const threadMessages = message.parent_message_id
    ? await listIssueThreadMessages(
        input.db,
        project.id,
        input.runId,
        message.parent_message_id,
      )
    : [];
  const targetAgentIds = agentProvider
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
          parentMessageId: message.parent_message_id ?? null,
        },
      );
  const targetAgents = new Map(explicitlyMentionedAgents);
  for (const agentId of targetAgentIds) {
    if (targetAgents.has(agentId)) continue;
    const agent = await getProjectAgent(input.db, project.id, agentId);
    if (agent) targetAgents.set(agent.id, agent);
  }
  const agentReplies: IssueAgentReplyJobRow[] = [];
  if (targetAgents.size > 0) {
    for (const agent of targetAgents.values()) {
      const agentReply = await enqueueIssueAgentReply(input.db, {
        id: crypto.randomUUID(),
        projectId: project.id,
        runId: input.runId,
        triggerMessageId: message.id,
        parentMessageId: agentReplyDisplayParentMessageId("issue", {
          id: message.id,
          parentMessageId: message.parent_message_id,
        }),
        replyMessageId: crypto.randomUUID(),
        agentId: agent.id,
        skillId: null,
        requiresPreferredWorker: run.worker_id !== null,
        createdAt,
      });
      if (agentReply) agentReplies.push(agentReply);
    }
  }
  return {
    message: issueMessageJson(
      message,
      storedAttachments.map(({ file: _file, ...attachment }) => ({
        ...attachment,
        project_id: project.id,
        run_id: input.runId,
        created_at: createdAt,
      })),
    ),
    agentReply: agentReplies.length === 1
      ? issueAgentReplyJson(agentReplies[0])
      : null,
    agentReplies: agentReplies.map(issueAgentReplyJson),
  };
}

export async function getProjectIssueAgentReply(
  input: IssueConversationApplicationInput & { triggerMessageId: string },
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
    archivesBucket,
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

  const issueMessagesMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/messages$/u,
  );
  if (
    issueMessagesMatch && request.method === "POST" &&
    request.headers.get("content-type")?.toLowerCase().startsWith(
      "multipart/form-data",
    )
  ) {
    const session = await requireSession(auth, request);
    const messageRequest =
      await readIssueMessageRequest(request);
    if (messageRequest.attachments.length === 0) {
      throw new HttpError(400, "Issue message upload requires an attachment");
    }
    return json(await createProjectIssueMessage({
      db,
      archivesBucket,
      attachmentsBucket,
      projectId: issueMessagesMatch[1],
      runId: issueMessagesMatch[2],
      userId: session.user.id,
      request: messageRequest.input,
      attachments: messageRequest.attachments,
      attachmentReferences: messageRequest.attachmentReferences,
    }), 201);
  }

  const issueMessageEditMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)$/u,
  );
  if (issueMessageEditMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueMessageEditMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "conversations:write")) {
      throw new HttpError(403, "Conversation editing permission required");
    }
    const input = decodeIssueMessageEditInput(await readJson(request));
    const message = await getIssueMessage(
      db,
      project.id,
      issueMessageEditMatch[2],
      issueMessageEditMatch[3],
    );
    if (!message) throw new HttpError(404, "Message not found");
    if (message.author_user_id !== session.user.id) {
      throw new HttpError(403, "Only the author can edit this message");
    }
    const updated = await updateIssueMessage(
      db,
      project.id,
      issueMessageEditMatch[2],
      message.id,
      {
        body: input.body,
        mentionedUserIds: input.mentionedUserIds,
        updatedAt: new Date().toISOString(),
      },
    );
    if (!updated) throw new HttpError(404, "Message not found");
    await removeOrphanedIssueAttachments(
      db,
      archivesBucket,
      attachmentsBucket,
      project.id,
      issueMessageEditMatch[2],
    );
    const [
      attachments,
      reworkProposals,
      actionProposals,
      executionProposals,
      skillExecutionProposals,
    ] = await Promise.all([
      listIssueAttachments(db, project.id, issueMessageEditMatch[2]),
      listIssueReworkProposals(db, project.id, issueMessageEditMatch[2]),
      listIssueActionProposals(db, project.id, issueMessageEditMatch[2]),
      listIssueExecutionProposals(db, project.id, issueMessageEditMatch[2]),
      listIssueAgentSkillExecutionProposals(
        db,
        project.id,
        issueMessageEditMatch[2],
      ),
    ]);
    const proposal = [...reworkProposals, ...actionProposals].find(
      (candidate) => candidate.reply_message_id === updated.id,
    ) ?? null;
    const executionProposal = executionProposals.find(
      (candidate) => candidate.reply_message_id === updated.id,
    ) ?? null;
    return json({
      message: issueMessageJson(
        updated,
        attachments,
        proposal,
        executionProposal,
        skillExecutionProposals.find(
          (candidate) => candidate.reply_message_id === updated.id,
        ) ?? null,
      ),
    });
  }
  if (issueMessageEditMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueMessageEditMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "conversations:write")) {
      throw new HttpError(403, "Conversation editing permission required");
    }
    const message = await getIssueMessage(
      db,
      project.id,
      issueMessageEditMatch[2],
      issueMessageEditMatch[3],
    );
    if (!message) throw new HttpError(404, "Message not found");
    if (message.author_user_id !== session.user.id) {
      throw new HttpError(403, "Only the author can delete this message");
    }
    const deleted = await deleteIssueMessage(
      db,
      project.id,
      issueMessageEditMatch[2],
      message.id,
    );
    if (!deleted) throw new HttpError(404, "Message not found");
    await removeOrphanedIssueAttachments(
      db,
      archivesBucket,
      attachmentsBucket,
      project.id,
      issueMessageEditMatch[2],
    );
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return undefined;
}
