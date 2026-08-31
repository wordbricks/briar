export type AttachmentObjectKeySql =
  | "?"
  | "briar_archive_cleanup_queue.object_key"
  | "briar_upload_cleanup_queue.object_key";

/**
 * The aggregate metadata below is authoritative for objects in ATTACHMENTS.
 * Keep cleanup workers on this shared predicate so adding an owner cannot make
 * one queue delete an object that another queue still considers live.
 */
export const attachmentObjectIsReferencedSql = (
  objectKeySql: AttachmentObjectKeySql,
) => `exists (
  select 1 from briar_issue_attachments attachment
  where attachment.object_key = ${objectKeySql}
)
or exists (
  select 1 from briar_run_evidence_images image
  where image.object_key = ${objectKeySql}
)
or exists (
  select 1 from briar_channel_message_attachments attachment
  where attachment.object_key = ${objectKeySql}
)
or exists (
  select 1 from briar_project_agents agent
  where agent.avatar_spritesheet_object_key = ${objectKeySql}
)
or exists (
  select 1
  from briar_log_archives archive,
       json_each(archive.related_object_keys_json) related
  where related.type = 'text' and related.value = ${objectKeySql}
)`;

export const attachmentObjectReferenceBindings = (objectKey: string) => [
  objectKey,
  objectKey,
  objectKey,
  objectKey,
  objectKey,
] as const;
