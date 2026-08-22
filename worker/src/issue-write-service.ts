import { canonicalizeIssueAttachmentReferences } from "../../src/lib/issue-markdown";
import {
  prepareStoredAttachments,
  uploadStoredAttachments,
} from "./attachment-storage";
import {
  createIssueAttachments,
  getProjectSettings,
  listIssueAttachments,
  recordHuntEvent,
  rollbackNewAppIssue,
  updateIssueWithAttachmentMetadata,
} from "./db";
import { HttpError } from "./http-response";
import { deleteUnreferencedUploadedIssueObjects } from "./issue-attachment-service";
import type { IssueInput, IssueUpdateInput } from "./issue-request-contract";
import type { ProjectRow } from "./project-repository";

export async function createIssueWithAttachments(input: {
  db: D1Database;
  attachmentsBucket: R2Bucket;
  project: Pick<ProjectRow, "id" | "name">;
  issue: Omit<IssueInput, "fullAuto"> & {
    fullAuto?: boolean;
  };
  attachments: File[];
  attachmentReferences?: string[];
  sourceKey: string;
  actor: string;
  detail: string;
  context: Record<string, unknown>;
  issueId?: string;
  createdByUserId?: string | null;
  occurredAt?: string;
}) {
  const settings = await getProjectSettings(input.db, input.project.id);
  const issueStorageId = input.issueId ?? crypto.randomUUID();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const storedAttachments = prepareStoredAttachments(
    input.attachments,
    () => {
      const id = crypto.randomUUID();
      return {
        id,
        object_key: `issue-attachments/${input.project.id}/${issueStorageId}/${id}`,
      };
    },
  );
  const uploadedKeys: string[] = [];
  let phase = "upload_attachments";
  const issueDescription = canonicalizeIssueAttachmentReferences(
    input.issue.description,
    input.attachmentReferences ?? [],
    storedAttachments.map((attachment) => attachment.id),
  );
  let runId: string | null = null;
  try {
    await uploadStoredAttachments(
      input.attachmentsBucket,
      storedAttachments,
      uploadedKeys,
      (attachment) => ({
        attachmentId: attachment.id,
        projectId: input.project.id,
      }),
    );
    phase = "record_issue";
    runId = await recordHuntEvent(input.db, input.project.id, {
      source: "issue",
      sourceKey: input.sourceKey,
      title: input.issue.title,
      stage: "queued",
      status: input.issue.status,
      workflowStage: null,
      eventKey: `${input.sourceKey}:${input.issue.status}:intake`,
      occurredAt,
      actor: input.actor,
      repository: settings?.github_repository ?? input.project.name,
      detail: input.detail,
      priority: input.issue.priority ?? null,
      assigneeUserId: input.issue.assigneeUserId ?? null,
      issueCheckpoints: input.issue.checkpoints,
      fullAuto: input.issue.fullAuto ?? false,
      branch: null,
      commitSha: null,
      tracker: null,
      issueDescription,
      resultSummary: null,
      structuredResult: null,
      pullRequestUrls: [],
      targetSha: null,
      sourceCreatedAt: occurredAt,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: {
        ...input.context,
        issueId: issueStorageId,
        attachmentCount: storedAttachments.length,
        fullAuto: input.issue.fullAuto ?? false,
      },
      createdByUserId: input.createdByUserId,
      preferredAgentProvider: input.issue.preferredProvider ?? null,
      preferredAgentModel: input.issue.preferredModel ?? null,
      preferredAgentEffort: input.issue.preferredEffort ?? null,
    });
    phase = "store_attachment_metadata";
    await createIssueAttachments(
      input.db,
      input.project.id,
      runId,
      storedAttachments.map(({ file: _file, ...attachment }) => attachment),
    );
    return {
      runId,
      sourceKey: input.sourceKey,
      attachments: await listIssueAttachments(
        input.db,
        input.project.id,
        runId,
      ),
    };
  } catch (error) {
    console.error(JSON.stringify({
      message: "issue creation failed",
      phase,
      errorType: error instanceof Error ? error.name : "UnknownError",
      error: error instanceof Error ? error.message : String(error),
      projectId: input.project.id,
      issueStorageId,
      runId,
      attachmentCount: storedAttachments.length,
      uploadedAttachmentCount: uploadedKeys.length,
      attachmentContentTypes: [
        ...new Set(storedAttachments.map((attachment) => attachment.content_type)),
      ],
    }));
    if (runId) {
      try {
        await rollbackNewAppIssue(input.db, input.project.id, runId);
      } catch (rollbackError) {
        console.error(
          JSON.stringify({
            message: "issue creation rollback failed",
            error:
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError),
            runId,
          }),
        );
      }
    }
    if (uploadedKeys.length > 0) {
      try {
        await deleteUnreferencedUploadedIssueObjects(
          input.db,
          input.attachmentsBucket,
          uploadedKeys,
        );
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            message: "attachment cleanup failed",
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
            issueStorageId,
          }),
        );
      }
    }
    throw error;
  }
}

export async function updateIssueWithAttachments(input: {
  db: D1Database;
  attachmentsBucket: R2Bucket;
  project: Pick<ProjectRow, "id">;
  runId: string;
  issue: IssueUpdateInput;
  attachments: File[];
  attachmentReferences?: string[];
  keptAttachmentIds?: string[];
  updatedAt: string;
}) {
  const existing = await listIssueAttachments(
    input.db,
    input.project.id,
    input.runId,
  );
  const keptIds =
    input.keptAttachmentIds === undefined
      ? new Set(existing.map((attachment) => attachment.id))
      : new Set(input.keptAttachmentIds);
  const removed = existing.filter(
    (attachment) => !keptIds.has(attachment.id),
  );
  const storedAttachments = prepareStoredAttachments(
    input.attachments,
    () => {
      const id = crypto.randomUUID();
      return {
        id,
        object_key: `issue-attachments/${input.project.id}/${input.runId}/${id}`,
      };
    },
  );
  const uploadedKeys: string[] = [];
  let phase = "upload_attachments";
  const issueDescription = canonicalizeIssueAttachmentReferences(
    input.issue.description,
    input.attachmentReferences ?? [],
    storedAttachments.map((attachment) => attachment.id),
  );
  try {
    await uploadStoredAttachments(
      input.attachmentsBucket,
      storedAttachments,
      uploadedKeys,
      (attachment) => ({
        attachmentId: attachment.id,
        projectId: input.project.id,
      }),
    );
    const updated = await updateIssueWithAttachmentMetadata(
      input.db,
      input.project.id,
      input.runId,
      {
      title: input.issue.title,
      description: issueDescription ?? null,
      priority: input.issue.priority ?? null,
      assigneeUserId: input.issue.assigneeUserId,
      updatedAt: input.updatedAt,
        attachments: storedAttachments.map(
          ({ file: _file, ...attachment }) => attachment,
        ),
        removedAttachmentIds: removed.map((attachment) => attachment.id),
      },
    );
    if (!updated) throw new HttpError(404, "Run not found");
    if (updated.deletedObjectKeys.length > 0) {
      await input.attachmentsBucket
        .delete(updated.deletedObjectKeys)
        .catch(() => undefined);
    }
    return updated.run;
  } catch (error) {
    if (uploadedKeys.length > 0) {
      await deleteUnreferencedUploadedIssueObjects(
        input.db,
        input.attachmentsBucket,
        uploadedKeys,
      ).catch(() => undefined);
    }
    throw error;
  }
}
