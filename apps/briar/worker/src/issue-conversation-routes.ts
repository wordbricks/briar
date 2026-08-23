import {
  agentReplyDisplayParentMessageId,
  issueReplyAgentIds,
} from "../../src/lib/issue-reply-decision";
import { canonicalizeIssueAttachmentReferences } from "../../src/lib/issue-markdown";
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
import { decodeIssueMessageEditInput } from "./issue-request-contract";
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
  const issueMessagesDeltaMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/messages\/delta$/u,
  );
  if (issueMessagesDeltaMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueMessagesDeltaMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(
      db,
      project.id,
      issueMessagesDeltaMatch[2],
    );
    if (!run) throw new HttpError(404, "Run not found");
    const rawCursor = new URL(request.url).searchParams.get("cursor");
    if (!rawCursor || !/^\d+$/u.test(rawCursor)) {
      throw new HttpError(400, "A non-negative conversation cursor is required");
    }
    const cursor = Number(rawCursor);
    if (!Number.isSafeInteger(cursor)) {
      throw new HttpError(400, "Conversation cursor is outside the safe range");
    }
    const page = await listDashboardChanges(db, project.id, cursor);
    if (page.expired) {
      return json(
        {
          code: "issue_conversation_cursor_expired",
          message: "Conversation cursor expired; reload the full snapshot",
        },
        410,
      );
    }
    const changed = page.changes.some(
      (change) => change.entity_type === "notifications",
    );
    return json({
      cursor: page.nextCursor,
      hasMore: page.hasMore,
      changed,
      ...(changed
        ? await loadIssueConversationSnapshot(
            db,
            archivesBucket,
            project.id,
            run.id,
          )
        : {}),
    });
  }
  if (issueMessagesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueMessagesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(
      db,
      project.id,
      issueMessagesMatch[2],
    );
    if (!run) throw new HttpError(404, "Run not found");
    const cursor = await getDashboardSyncCursor(db, project.id);
    return json({
      cursor,
      ...(await loadIssueConversationSnapshot(
        db,
        archivesBucket,
        project.id,
        run.id,
      )),
    });
  }
  if (issueMessagesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueMessagesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(
      db,
      project.id,
      issueMessagesMatch[2],
    );
    if (!run) throw new HttpError(404, "Run not found");
    const { input: rawInput, attachments, attachmentReferences } =
      await readIssueMessageRequest(request);
    const storedAttachments = prepareStoredAttachments(
      attachments,
      () => {
        const id = crypto.randomUUID();
        return {
          id,
          object_key: `issue-attachments/${project.id}/${issueMessagesMatch[2]}/${id}`,
        };
      },
    );
    const input = {
      ...rawInput,
      body: canonicalizeIssueAttachmentReferences(
        rawInput.body,
        attachmentReferences,
        storedAttachments.map((attachment) => attachment.id),
      ) ?? rawInput.body,
    };
    const agentProvider = input.agentConversationId
      ? input.agentConversationId.startsWith(`briar:claude:${project.id}:`)
        ? "claude"
        : input.agentConversationId.startsWith(`briar:grok:${project.id}:`)
          ? "grok"
          : input.agentConversationId.startsWith(`briar:${project.id}:`)
            ? "codex"
            : null
      : null;
    if (input.agentConversationId && !agentProvider) {
      throw new HttpError(
        400,
        "Agent conversation does not belong to this project",
      );
    }
    const explicitMentionedAgentIds = [...new Set(input.mentionedAgentIds ?? [])];
    const explicitlyMentionedAgents = new Map<
      string,
      NonNullable<Awaited<ReturnType<typeof getProjectAgent>>>
    >();
    if (!agentProvider) {
      for (const agentId of explicitMentionedAgentIds) {
        const agent = await getProjectAgent(db, project.id, agentId);
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
        attachmentsBucket,
        storedAttachments,
        uploadedKeys,
        (attachment) => ({
          attachmentId: attachment.id,
          projectId: project.id,
        }),
      );
      await createIssueAttachments(
        db,
        project.id,
        issueMessagesMatch[2],
        storedAttachments.map(({ file: _file, ...attachment }) => attachment),
      );
      message = await createIssueMessage(db, {
        id: input.clientMessageId ?? crypto.randomUUID(),
        projectId: project.id,
        runId: issueMessagesMatch[2],
        parentMessageId: input.parentMessageId ?? null,
        authorUserId: agentProvider ? null : session.user.id,
        authorAgentProvider: agentProvider,
        body: input.body,
        mentionedUserIds: agentProvider ? [] : input.mentionedUserIds,
        createdAt,
      });
      if (!message) throw new HttpError(
        404,
        input.parentMessageId ? "Thread message not found" : "Run not found",
      );
    } catch (error) {
      await deleteIssueAttachments(
        db,
        project.id,
        issueMessagesMatch[2],
        storedAttachments.map((attachment) => attachment.id),
      ).catch(() => undefined);
      await deleteUnreferencedUploadedIssueObjects(
        db,
        attachmentsBucket,
        uploadedKeys,
      ).catch(() => undefined);
      throw error;
    }
    if (!message) {
      throw new HttpError(
        404,
        input.parentMessageId ? "Thread message not found" : "Run not found",
      );
    }
    const threadMessages = message.parent_message_id
      ? await listIssueThreadMessages(
          db,
          project.id,
          issueMessagesMatch[2],
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
      const agent = await getProjectAgent(db, project.id, agentId);
      if (agent) targetAgents.set(agent.id, agent);
    }
    const agentReplies: IssueAgentReplyJobRow[] = [];
    if (targetAgents.size > 0) {
      for (const agent of targetAgents.values()) {
        const agentReply = await enqueueIssueAgentReply(db, {
          id: crypto.randomUUID(),
          projectId: project.id,
          runId: issueMessagesMatch[2],
          triggerMessageId: message.id,
          parentMessageId: agentReplyDisplayParentMessageId("issue", {
            id: message.id,
            parentMessageId: message.parent_message_id,
          }),
          replyMessageId: crypto.randomUUID(),
          agentId: agent.id,
          skillId: null,
          // A live processing Worker is the only safe place to look for the
          // issue's uncommitted worktree. If the run has not been claimed yet,
          // keep the reply claimable and let the Worker answer from the
          // durable snapshot/repository context instead.
          requiresPreferredWorker: run.worker_id !== null,
          createdAt,
        });
        if (agentReply) agentReplies.push(agentReply);
      }
    }
    return json(
      {
        message: issueMessageJson(
          message,
          storedAttachments.map(({ file: _file, ...attachment }) => ({
            ...attachment,
            project_id: project.id,
            run_id: issueMessagesMatch[2],
            created_at: createdAt,
          })),
        ),
        agentReply: agentReplies.length === 1
          ? issueAgentReplyJson(agentReplies[0])
          : null,
        agentReplies: agentReplies.map(issueAgentReplyJson),
      },
      201,
    );
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

  const issueAgentReplyStatusMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/agent-reply$/u,
  );
  if (issueAgentReplyStatusMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueAgentReplyStatusMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const replyJobs = (await listIssueAgentReplyJobs(
      db,
      project.id,
      issueAgentReplyStatusMatch[2],
    )).filter(
      (candidate) =>
        candidate.trigger_message_id === issueAgentReplyStatusMatch[3],
    );
    const job = replyJobs[0] ?? await getIssueAgentReplyJob(
      db,
      project.id,
      issueAgentReplyStatusMatch[3],
    );
    if (!job || job.run_id !== issueAgentReplyStatusMatch[2]) {
      throw new HttpError(404, "Agent reply not found");
    }
    const [
      messages,
      reworkProposals,
      actionProposals,
      executionProposals,
      skillExecutionProposals,
    ] =
      replyJobs.some((candidate) => candidate.status === "completed")
        ? await Promise.all([
            listIssueMessagesWithArchive(
              db,
              archivesBucket,
              project.id,
              job.run_id,
            ),
            listIssueReworkProposals(db, project.id, job.run_id),
            listIssueActionProposals(db, project.id, job.run_id),
            listIssueExecutionProposals(db, project.id, job.run_id),
            listIssueAgentSkillExecutionProposals(db, project.id, job.run_id),
          ])
        : [[], [], [], [], []];
    const reply = messages.find(
      (message) => message.id === job.reply_message_id,
    );
    const replyMessages = messages.filter((message) =>
      replyJobs.some((candidate) => candidate.reply_message_id === message.id),
    );
    const proposal = [...reworkProposals, ...actionProposals].find(
      (candidate) => candidate.reply_message_id === job.reply_message_id,
    ) ?? null;
    return json({
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
        ),
      ),
    });
  }


  return undefined;
}
