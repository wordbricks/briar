export type IssueAttachmentRow = {
  id: string;
  run_id: string;
  project_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  created_at: string;
};

export type IssueAttachmentInput = Omit<
  IssueAttachmentRow,
  "run_id" | "project_id" | "created_at"
>;

export async function createIssueAttachments(
  db: D1Database,
  projectId: string,
  runId: string,
  attachments: IssueAttachmentInput[],
) {
  if (attachments.length === 0) return;
  const createdAt = new Date().toISOString();
  const results = await db.batch(
    attachments.map((attachment) =>
      db
        .prepare(
          `insert into briar_issue_attachments (
             id, run_id, project_id, object_key, filename, content_type,
             byte_size, created_at
           )
           select ?, run.id, run.project_id, ?, ?, ?, ?, ?
           from briar_hunt_runs run
           where run.id = ? and run.project_id = ?
           returning id`,
        )
        .bind(
          attachment.id,
          attachment.object_key,
          attachment.filename,
          attachment.content_type,
          attachment.byte_size,
          createdAt,
          runId,
          projectId,
        ),
    ),
  );
  if (
    results.some(
      (result) => !result.success || (result.results?.length ?? 0) !== 1,
    )
  ) {
    throw new Error("Issue attachment metadata could not be stored");
  }
}

export async function issueAttachmentObjectKeysInUse(
  db: D1Database,
  objectKeys: string[],
) {
  if (objectKeys.length === 0) return new Set<string>();
  const placeholders = objectKeys.map(() => "?").join(",");
  const result = await db
    .prepare(
      `select object_key from briar_issue_attachments
       where object_key in (${placeholders})`,
    )
    .bind(...objectKeys)
    .all<{ object_key: string }>();
  return new Set((result.results ?? []).map((row) => row.object_key));
}

export async function listIssueAttachments(
  db: D1Database,
  projectId: string,
  runId?: string,
) {
  const query = runId
    ? `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments attachment
       where attachment.project_id = ? and attachment.run_id = ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = attachment.run_id
             and run.project_id = attachment.project_id
         )
       order by created_at, id`
    : `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments attachment
       where attachment.project_id = ?
         and attachment.run_id in (
           select run.id from briar_hunt_runs run
           where run.project_id = ?
           order by
             case when run.status in ('completed', 'cancelled') then 1 else 0 end,
             run.last_event_at desc
           limit 200
         )
       order by created_at, id`;
  const statement = db.prepare(query);
  const result = runId
    ? await statement.bind(projectId, runId).all<IssueAttachmentRow>()
    : await statement.bind(projectId, projectId).all<IssueAttachmentRow>();
  return result.results;
}

export async function listIssueAttachmentsByRunIds(
  db: D1Database,
  projectId: string,
  runIds: readonly string[],
) {
  if (runIds.length === 0) return [];
  const result = await db
    .prepare(
      `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments attachment
       where attachment.project_id = ?
         and attachment.run_id in (select value from json_each(?))
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = attachment.run_id
             and run.project_id = attachment.project_id
         )
       order by created_at, id`,
    )
    .bind(projectId, JSON.stringify([...new Set(runIds)]))
    .all<IssueAttachmentRow>();
  return result.results;
}

export async function getIssueAttachment(
  db: D1Database,
  projectId: string,
  runId: string,
  attachmentId: string,
) {
  return db
    .prepare(
      `select id, run_id, project_id, object_key, filename, content_type,
              byte_size, created_at
       from briar_issue_attachments attachment
       where attachment.project_id = ? and attachment.run_id = ?
         and attachment.id = ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = attachment.run_id
             and run.project_id = attachment.project_id
         )`,
    )
    .bind(projectId, runId, attachmentId)
    .first<IssueAttachmentRow>();
}
