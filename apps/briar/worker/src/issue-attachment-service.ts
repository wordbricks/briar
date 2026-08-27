import { issueAttachmentReferences } from "../../src/lib/issue-markdown";
import {
  htmlArtifactContentSecurityPolicy,
  isHtmlArtifactAttachment,
} from "../../src/lib/agent-reply-attachments";
import { contentDisposition } from "./attachment-storage";
import {
  deleteIssueAttachments,
  getHuntRunForProject,
  issueAttachmentObjectKeysInUse,
  listIssueAttachments,
  type IssueAttachmentRow,
} from "./db";
import { corsHeaders } from "./http-response";
import { listIssueMessagesWithArchive } from "./issue-conversation-service";

export function issueAttachmentResponse(
  attachment: Pick<
    IssueAttachmentRow,
    "filename" | "content_type" | "byte_size"
  >,
  object: R2Object,
  body: BodyInit | null,
) {
  const headers = new Headers(corsHeaders);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Content-Disposition", contentDisposition(attachment.filename));
  headers.set("Content-Length", String(object.size));
  headers.set("Content-Type", attachment.content_type);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  if (attachment.content_type.toLowerCase() === "image/svg+xml") {
    headers.set("Content-Security-Policy", "sandbox");
  } else if (
    isHtmlArtifactAttachment(attachment.content_type, attachment.filename)
  ) {
    headers.set(
      "Content-Security-Policy",
      `sandbox allow-scripts; ${htmlArtifactContentSecurityPolicy}`,
    );
  }
  return new Response(body, { headers });
}

export async function deleteUnreferencedUploadedIssueObjects(
  db: D1Database,
  attachmentsBucket: R2Bucket,
  objectKeys: string[],
) {
  if (objectKeys.length === 0) return;
  const inUse = await issueAttachmentObjectKeysInUse(db, objectKeys);
  const deletable = objectKeys.filter((objectKey) => !inUse.has(objectKey));
  if (deletable.length > 0) await attachmentsBucket.delete(deletable);
}

export async function removeOrphanedIssueAttachments(
  db: D1Database,
  archivesBucket: R2Bucket,
  attachmentsBucket: R2Bucket,
  projectId: string,
  runId: string,
) {
  const [run, messages, attachments] = await Promise.all([
    getHuntRunForProject(db, projectId, runId),
    listIssueMessagesWithArchive(db, archivesBucket, projectId, runId),
    listIssueAttachments(db, projectId, runId),
  ]);
  if (!run) return;
  const referenced = new Set<string>();
  for (const id of issueAttachmentReferences(run.issue_description ?? "")) {
    referenced.add(id);
  }
  for (const message of messages) {
    for (const id of issueAttachmentReferences(message.body)) {
      referenced.add(id);
    }
  }
  const orphaned = attachments.filter(
    (attachment) => !referenced.has(attachment.id),
  );
  if (orphaned.length === 0) return;
  const deletedObjectKeys = await deleteIssueAttachments(
    db,
    projectId,
    runId,
    orphaned.map((attachment) => attachment.id),
  );
  if (deletedObjectKeys.length === 0) return;
  await attachmentsBucket.delete(deletedObjectKeys).catch((error) => {
    console.error(
      JSON.stringify({
        message: "orphaned issue attachment cleanup failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
}
