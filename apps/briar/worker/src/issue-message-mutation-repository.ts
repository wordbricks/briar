import type { TeamAgentProvider } from "./team-agent-model";
import {
  issueAttachmentUploadAvailabilityGuard,
  issueAttachmentUploadConsumeStatements,
} from "./issue-attachment-upload-repository";
import type { IssueAttachmentRow } from "./issue-attachment-repository";
import {
  decodeIssueMessageMutationReceiptRow,
  encodeIssueMessageMutationReceiptResponseJson,
  encodeIssueMutationAttachmentUploadIdsJson,
  type IssueMessageMutationReceiptResponse,
} from "./issue-mutation-receipt-contract";

export type IssueMessageReplyPlan = {
  id: string;
  replyMessageId: string;
  agentId: string;
  agentName: string;
  agentResponsibility: string;
  preferredWorkerId: string | null;
  preferredProvider: TeamAgentProvider;
  requiresPreferredWorker: boolean;
};

export async function findIssueMessageMutationReceipt(
  db: D1Database,
  messageId: string,
) {
  const row = await db
    .prepare(
      `select message_id, organization_id, project_id, run_id, user_id,
              request_hash, attachment_upload_ids_json, response_json,
              created_at
       from briar_issue_message_mutation_receipts
       where message_id = ?`,
    )
    .bind(messageId)
    .first();
  return row === null ? null : decodeIssueMessageMutationReceiptRow(row);
}

export async function issueMessageAggregateExists(
  db: D1Database,
  messageId: string,
) {
  return (await db
    .prepare(`select 1 as present from briar_issue_messages where id = ?`)
    .bind(messageId)
    .first<{ present: number }>()) !== null;
}

const exactCountGuard = (
  table: "briar_organization_members" | "briar_project_agents",
  ids: readonly string[],
) => {
  if (ids.length === 0) return { sql: "", bindings: [] as unknown[] };
  const placeholders = ids.map(() => "?").join(", ");
  return table === "briar_organization_members"
    ? {
        sql: `and (
          select count(distinct membership.user_id)
          from briar_organization_members membership
          where membership.organization_id = project.organization_id
            and membership.user_id in (${placeholders})
        ) = ?`,
        bindings: [...ids, ids.length],
      }
    : {
        sql: `and (
          select count(distinct agent.id)
          from briar_project_agents agent
          where agent.project_id = run.project_id
            and agent.organization_id = project.organization_id
            and agent.id in (${placeholders})
        ) = ?`,
        bindings: [...ids, ids.length],
      };
};

/**
 * Commits the complete issue-message aggregate. All IDs and the response are
 * fixed before this function runs, so an exact retry can return the receipt
 * without creating a second message or a second set of Agent jobs.
 */
export async function commitIssueMessageMutation(
  db: D1Database,
  input: {
    organizationId: string;
    projectId: string;
    runId: string;
    userId: string;
    messageId: string;
    parentMessageId: string | null;
    authorAgentProvider: TeamAgentProvider | null;
    body: string;
    mentionedUserIds: readonly string[];
    targetAgentIds: readonly string[];
    attachments: readonly IssueAttachmentRow[];
    uploadIds: readonly string[];
    existingAttachmentIds: readonly string[];
    replies: readonly IssueMessageReplyPlan[];
    requestHash: string;
    response: IssueMessageMutationReceiptResponse;
    committedAt: string;
  },
) {
  const replyAgentIds = input.replies.map((reply) => reply.agentId);
  if (
    new Set(replyAgentIds).size !== replyAgentIds.length ||
    replyAgentIds.length !== input.targetAgentIds.length ||
    replyAgentIds.some((agentId) => !input.targetAgentIds.includes(agentId))
  ) {
    throw new Error("Issue message reply plan does not match its Agent targets");
  }
  const attachmentUploadIdsJson = encodeIssueMutationAttachmentUploadIdsJson(
    input.uploadIds,
  );
  const responseJson = encodeIssueMessageMutationReceiptResponseJson(
    input.response,
  );
  decodeIssueMessageMutationReceiptRow({
    message_id: input.messageId,
    organization_id: input.organizationId,
    project_id: input.projectId,
    run_id: input.runId,
    user_id: input.userId,
    request_hash: input.requestHash,
    attachment_upload_ids_json: attachmentUploadIdsJson,
    response_json: responseJson,
    created_at: input.committedAt,
  });
  const uploadScope = {
    purpose: "issue_message" as const,
    organizationId: input.organizationId,
    projectId: input.projectId,
    userId: input.userId,
    mutationId: input.messageId,
    runId: input.runId,
    uploadIds: input.uploadIds,
  };
  const uploadGuard = issueAttachmentUploadAvailabilityGuard({
    ...uploadScope,
    observedAt: input.committedAt,
  });
  const memberGuard = exactCountGuard(
    "briar_organization_members",
    input.mentionedUserIds,
  );
  const agentGuard = exactCountGuard(
    "briar_project_agents",
    input.targetAgentIds,
  );
  const existingAttachmentGuard = input.existingAttachmentIds.length === 0
    ? { sql: "", bindings: [] as unknown[] }
    : {
        sql: `and (
          select count(distinct attachment.id)
          from briar_issue_attachments attachment
          where attachment.project_id = run.project_id
            and attachment.run_id = run.id
            and attachment.id in (${
              input.existingAttachmentIds.map(() => "?").join(", ")
            })
        ) = ?`,
        bindings: [
          ...input.existingAttachmentIds,
          input.existingAttachmentIds.length,
        ],
      };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `insert into briar_issue_messages (
           id, project_id, run_id, parent_message_id, author_user_id,
           author_agent_id, author_agent_name, author_agent_provider,
           body, created_at, updated_at
         )
         select ?, run.project_id, run.id, parent.id, ?, null, null, ?, ?, ?, ?
         from briar_hunt_runs run
         join briar_projects project on project.id = run.project_id
         left join briar_issue_messages parent
           on parent.id = ? and parent.project_id = run.project_id
          and parent.run_id = run.id
         where run.id = ? and run.project_id = ?
           and project.organization_id = ?
           and (? is null or parent.id is not null)
           and exists (
             select 1 from briar_organization_members membership
             where membership.organization_id = project.organization_id
               and membership.user_id = ?
               and membership.role in (
                 'owner', 'co-owner', 'developer', 'editor'
               )
               and (
                 membership.role in ('owner', 'co-owner')
                 or exists (
                   select 1 from briar_project_members project_member
                   where project_member.project_id = project.id
                     and project_member.organization_id = project.organization_id
                     and project_member.user_id = membership.user_id
                 )
               )
           )
           ${memberGuard.sql}
           ${agentGuard.sql}
           ${existingAttachmentGuard.sql}
           ${uploadGuard.sql}`,
      )
      .bind(
        input.messageId,
        input.authorAgentProvider ? null : input.userId,
        input.authorAgentProvider,
        input.body,
        input.committedAt,
        input.committedAt,
        input.parentMessageId,
        input.runId,
        input.projectId,
        input.organizationId,
        input.parentMessageId,
        input.userId,
        ...memberGuard.bindings,
        ...agentGuard.bindings,
        ...existingAttachmentGuard.bindings,
        ...uploadGuard.bindings,
      ),
    ...input.mentionedUserIds.map((mentionedUserId) =>
      db
        .prepare(
          `insert into briar_issue_message_mentions (
             message_id, user_id, created_at
           )
           select message.id, membership.user_id, ?
           from briar_issue_messages message
           join briar_projects project on project.id = message.project_id
           join briar_organization_members membership
             on membership.organization_id = project.organization_id
            and membership.user_id = ?
           where message.id = ?
             and (message.author_user_id is null
               or message.author_user_id != membership.user_id)
           on conflict (message_id, user_id) do nothing`,
        )
        .bind(input.committedAt, mentionedUserId, input.messageId),
    ),
    ...input.attachments.map((attachment) =>
      db
        .prepare(
          `insert into briar_issue_attachments (
             id, run_id, project_id, object_key, filename, content_type,
             byte_size, created_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          attachment.id,
          input.runId,
          input.projectId,
          attachment.object_key,
          attachment.filename,
          attachment.content_type,
          attachment.byte_size,
          input.committedAt,
        ),
    ),
    ...input.replies.map((reply) =>
      db
        .prepare(
          `insert into briar_issue_agent_reply_jobs (
             id, project_id, run_id, trigger_message_id, parent_message_id,
             reply_message_id, agent_id, requires_preferred_worker,
             agent_name_snapshot, agent_responsibility_snapshot,
             preferred_worker_id, preferred_provider, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          reply.id,
          input.projectId,
          input.runId,
          input.messageId,
          input.parentMessageId ?? input.messageId,
          reply.replyMessageId,
          reply.agentId,
          reply.requiresPreferredWorker ? 1 : 0,
          reply.agentName,
          reply.agentResponsibility,
          reply.preferredWorkerId,
          reply.preferredProvider,
          input.committedAt,
          input.committedAt,
        ),
    ),
    db
      .prepare(
        `insert into briar_issue_message_mutation_receipts (
           message_id, organization_id, project_id, run_id, user_id,
           request_hash, attachment_upload_ids_json, response_json, created_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.messageId,
        input.organizationId,
        input.projectId,
        input.runId,
        input.userId,
        input.requestHash,
        attachmentUploadIdsJson,
        responseJson,
        input.committedAt,
      ),
    ...issueAttachmentUploadConsumeStatements(db, {
      ...uploadScope,
      consumedAt: input.committedAt,
    }),
  ];
  await db.batch(statements);
}
