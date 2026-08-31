import type { IssueDifficulty } from "../../src/lib/issue-difficulty";
import type { IssueAttachmentRow } from "./issue-attachment-repository";
import type { ScopedUploadRow } from "./upload-repository";

export type IssueCreateMutationReceiptRow = {
  client_issue_id: string;
  organization_id: string;
  project_id: string;
  user_id: string;
  request_hash: string;
  attachment_upload_ids_json: string;
  response_json: string;
  created_at: string;
};

export type IssueUpdateMutationReceiptRow = {
  request_id: string;
  organization_id: string;
  project_id: string;
  run_id: string;
  user_id: string;
  request_hash: string;
  attachment_upload_ids_json: string;
  response_json: string;
  created_at: string;
};

export function findIssueCreateAggregateId(
  db: D1Database,
  input: { projectId: string; clientIssueId: string; sourceKey: string },
) {
  return db
    .prepare(
      `select id from briar_hunt_runs
       where id = ?
          or (project_id = ? and source = 'issue' and source_key = ?)
       limit 1`,
    )
    .bind(input.clientIssueId, input.projectId, input.sourceKey)
    .first<{ id: string }>();
}

export function findIssueCreateMutationReceipt(
  db: D1Database,
  clientIssueId: string,
) {
  return db
    .prepare(
      `select client_issue_id, organization_id, project_id, user_id,
              request_hash, attachment_upload_ids_json, response_json,
              created_at
       from briar_issue_create_mutation_receipts
       where client_issue_id = ?`,
    )
    .bind(clientIssueId)
    .first<IssueCreateMutationReceiptRow>();
}

export function findIssueUpdateMutationReceipt(
  db: D1Database,
  requestId: string,
) {
  return db
    .prepare(
      `select request_id, organization_id, project_id, run_id, user_id,
              request_hash, attachment_upload_ids_json, response_json,
              created_at
       from briar_issue_update_mutation_receipts
       where request_id = ?`,
    )
    .bind(requestId)
    .first<IssueUpdateMutationReceiptRow>();
}

export function issueAttachmentInsertStatements(
  db: D1Database,
  input: {
    projectId: string;
    runId: string;
    uploads: readonly ScopedUploadRow[];
    createdAt: string;
    expectedRunUpdatedAt?: string;
  },
) {
  return input.uploads.map((upload) =>
    db
      .prepare(
        `insert into briar_issue_attachments (
           id, run_id, project_id, object_key, filename, content_type,
           byte_size, created_at
         )
         select ?, run.id, run.project_id, ?, ?, ?, ?, ?
         from briar_hunt_runs run
         where run.id = ? and run.project_id = ?
           and (? is null or run.updated_at = ?)
         returning id`,
      )
      .bind(
        upload.upload_id,
        upload.object_key,
        upload.filename,
        upload.content_type,
        upload.byte_size,
        input.createdAt,
        input.runId,
        input.projectId,
        input.expectedRunUpdatedAt ?? null,
        input.expectedRunUpdatedAt ?? null,
      )
  );
}

export function issueCreateMutationReceiptStatement(
  db: D1Database,
  input: {
    clientIssueId: string;
    organizationId: string;
    projectId: string;
    userId: string;
    requestHash: string;
    attachmentUploadIds: readonly string[];
    responseJson: string;
    createdAt: string;
  },
) {
  return db
    .prepare(
      `insert into briar_issue_create_mutation_receipts (
         client_issue_id, organization_id, project_id, user_id, request_hash,
         attachment_upload_ids_json, response_json, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.clientIssueId,
      input.organizationId,
      input.projectId,
      input.userId,
      input.requestHash,
      JSON.stringify(input.attachmentUploadIds),
      input.responseJson,
      input.createdAt,
    );
}

export function updateIssueMutationStatements(
  db: D1Database,
  input: {
    organizationId: string;
    projectId: string;
    runId: string;
    userId: string;
    requestId: string;
    requestHash: string;
    title: string;
    description: string | null;
    priority: number | null;
    difficulty: IssueDifficulty | null;
    assigneeUserId: string | null;
    previousUpdatedAt: string;
    updatedAt: string;
    previousAttachmentIds: readonly string[];
    keptAttachments: readonly IssueAttachmentRow[];
    newUploads: readonly ScopedUploadRow[];
    removedAttachments: readonly IssueAttachmentRow[];
    responseJson: string;
  },
) {
  const finalAttachmentIds = [
    ...input.keptAttachments.map((attachment) => attachment.id),
    ...input.newUploads.map((upload) => upload.upload_id),
  ];
  const previousAttachmentIdsJson = JSON.stringify(input.previousAttachmentIds);
  const finalAttachmentIdsJson = JSON.stringify(finalAttachmentIds);
  const update = db
    .prepare(
      `update briar_hunt_runs as run
       set title = ?, issue_description = ?, priority = ?, difficulty = ?,
           assignee_user_id = ?, updated_at = ?
       where run.id = ? and run.project_id = ? and run.updated_at = ?
         and (
           select count(*) from briar_issue_attachments attachment
           where attachment.project_id = run.project_id
             and attachment.run_id = run.id
         ) = json_array_length(?)
         and not exists (
           select 1 from briar_issue_attachments attachment
           where attachment.project_id = run.project_id
             and attachment.run_id = run.id
             and attachment.id not in (select value from json_each(?))
         )
       returning *`,
    )
    .bind(
      input.title,
      input.description,
      input.priority,
      input.difficulty,
      input.assigneeUserId,
      input.updatedAt,
      input.runId,
      input.projectId,
      input.previousUpdatedAt,
      previousAttachmentIdsJson,
      previousAttachmentIdsJson,
    );
  const inserts = issueAttachmentInsertStatements(db, {
    projectId: input.projectId,
    runId: input.runId,
    uploads: input.newUploads,
    createdAt: input.updatedAt,
    expectedRunUpdatedAt: input.updatedAt,
  });
  const cleanup = input.removedAttachments.map((attachment) =>
    db
      .prepare(
        `insert into briar_upload_cleanup_queue (
           object_key, batch_request_id, queued_at, next_attempt_at
         )
         select attachment.object_key, ?, ?, ?
         from briar_issue_attachments attachment
         join briar_hunt_runs run
           on run.id = attachment.run_id
          and run.project_id = attachment.project_id
         where attachment.id = ? and attachment.project_id = ?
           and attachment.run_id = ? and run.updated_at = ?
         on conflict (object_key) do nothing`,
      )
      .bind(
        `issue-update:${input.requestId}`,
        input.updatedAt,
        input.updatedAt,
        attachment.id,
        input.projectId,
        input.runId,
        input.updatedAt,
      )
  );
  const removals = input.removedAttachments.map((attachment) =>
    db
      .prepare(
        `delete from briar_issue_attachments
         where id = ? and project_id = ? and run_id = ?
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = briar_issue_attachments.run_id
               and run.project_id = briar_issue_attachments.project_id
               and run.updated_at = ?
           )
         returning id`,
      )
      .bind(
        attachment.id,
        input.projectId,
        input.runId,
        input.updatedAt,
      )
  );
  // The scalar subquery deliberately feeds a NOT NULL column. If the guarded
  // run update or exact final attachment set did not commit earlier in this
  // batch, it returns NULL and aborts the complete D1 transaction.
  const receipt = db
    .prepare(
      `insert into briar_issue_update_mutation_receipts (
         request_id, organization_id, project_id, run_id, user_id,
         request_hash, attachment_upload_ids_json, response_json, created_at
       ) values (
         ?,
         (
           select project.organization_id
           from briar_hunt_runs run
           join briar_projects project on project.id = run.project_id
           where run.id = ? and run.project_id = ? and run.updated_at = ?
             and run.title = ? and run.issue_description is ?
             and run.priority is ? and run.difficulty is ?
             and run.assignee_user_id is ?
             and (
               select count(*) from briar_issue_attachments attachment
               where attachment.project_id = run.project_id
                 and attachment.run_id = run.id
             ) = json_array_length(?)
             and not exists (
               select 1 from briar_issue_attachments attachment
               where attachment.project_id = run.project_id
                 and attachment.run_id = run.id
                 and attachment.id not in (select value from json_each(?))
             )
         ),
         ?, ?, ?, ?, ?, ?, ?
       )`,
    )
    .bind(
      input.requestId,
      input.runId,
      input.projectId,
      input.updatedAt,
      input.title,
      input.description,
      input.priority,
      input.difficulty,
      input.assigneeUserId,
      finalAttachmentIdsJson,
      finalAttachmentIdsJson,
      input.projectId,
      input.runId,
      input.userId,
      input.requestHash,
      JSON.stringify(input.newUploads.map((upload) => upload.upload_id)),
      input.responseJson,
      input.updatedAt,
    );
  return { update, inserts, cleanup, removals, receipt };
}
