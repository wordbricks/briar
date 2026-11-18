/*
  Carries the conversation files an approved proposal named onto the issue it
  creates, so the Worker that later claims the run downloads them into its
  workspace instead of blocking on missing-source-attachments.

  The R2 object is shared rather than copied. One bucket backs both tables,
  `object_key` is unique per table so the two rows never collide, and
  `attachmentObjectIsReferencedSql` already counts `briar_issue_attachments`
  and `briar_channel_message_attachments` as independent owners — so deleting
  the DM message leaves the issue with a readable file rather than a dead key.
*/
import { HttpError } from "./http-response";
import { digestIssueAttachmentId } from "./run-identity";

/** One channel attachment, as the columns an issue attachment copies. */
export type ChannelIssueAttachmentSource = {
  id: string;
  filename: string;
  content_type: string;
  byte_size: number;
};

async function readChannelAttachmentSources(
  db: D1Database,
  input: {
    workspaceId: string;
    channelId: string;
    attachmentIds: readonly string[];
  },
) {
  const rows = await db
    .prepare(
      `select id, filename, content_type, byte_size
       from briar_channel_message_attachments
       where organization_id = ? and channel_id = ?
         and id in (select value from json_each(?))`,
    )
    .bind(
      input.workspaceId,
      input.channelId,
      JSON.stringify([...input.attachmentIds]),
    )
    .all<ChannelIssueAttachmentSource>();
  return rows.results;
}

/**
 * The rows the approved payload named, in the order it named them.
 *
 * An id that does not resolve fails the approval rather than quietly creating
 * an issue without it: the member approved a card that listed those files, and
 * an issue missing its source material is the bug this whole path exists to
 * fix.
 */
export async function resolveChannelIssueAttachmentSources(
  db: D1Database,
  input: {
    workspaceId: string;
    channelId: string;
    attachmentIds: readonly string[];
  },
): Promise<ChannelIssueAttachmentSource[]> {
  if (input.attachmentIds.length === 0) return [];
  const rows = await readChannelAttachmentSources(db, input);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = input.attachmentIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      409,
      `The approved proposal references attachments this channel no longer holds: ${
        missing.join(", ")
      }`,
      "CHANNEL_PROPOSAL_ATTACHMENT_MISSING",
    );
  }
  return input.attachmentIds.map((id) => byId.get(id)!);
}

/**
 * Copies the named channel attachments onto one run.
 *
 * The channel and organization scope is re-applied inside each statement, not
 * inherited from the read above: the id list travels through a stored payload,
 * so the write itself has to be the thing that cannot reach another channel's
 * files. The values are taken from the source row for the same reason.
 */
export async function channelIssueAttachmentStatements(
  db: D1Database,
  input: {
    projectId: string;
    runId: string;
    workspaceId: string;
    channelId: string;
    attachmentIds: readonly string[];
    createdAt: string;
  },
) {
  return Promise.all(
    input.attachmentIds.map(async (attachmentId) =>
      db
        .prepare(
          `insert into briar_issue_attachments (
             id, run_id, project_id, object_key, filename, content_type,
             byte_size, created_at
           )
           select ?, run.id, run.project_id, source.object_key, source.filename,
                  source.content_type, source.byte_size, ?
           from briar_channel_message_attachments source
           join briar_channels channel
             on channel.id = source.channel_id
            and channel.organization_id = source.organization_id
           join briar_hunt_runs run on run.id = ? and run.project_id = ?
           where source.id = ? and source.channel_id = ?
             and source.organization_id = ?
           returning id`,
        )
        .bind(
          await digestIssueAttachmentId(input.runId, attachmentId),
          input.createdAt,
          input.runId,
          input.projectId,
          attachmentId,
          input.channelId,
          input.workspaceId,
        )
    ),
  );
}
