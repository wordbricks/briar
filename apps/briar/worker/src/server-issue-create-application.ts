import {
  normalizedIssueAttachmentUploadMetadata,
  prepareCreateIssueAttachmentUploadsApplication,
} from "./issue-attachment-upload-application";
import { uploadReservedFileApplication } from "./upload-application";
import {
  abandonUploadBatch,
  getScopedUpload,
  type UploadMetadata,
} from "./upload-repository";
import {
  createProjectIssue,
  type IssueCreateAttribution,
} from "./issue-core-routes";
import { digestRunId } from "./run-identity";

export type ServerIssueCreateApplicationServices = {
  readonly prepareUploads:
    typeof prepareCreateIssueAttachmentUploadsApplication;
  readonly uploadReservedFile: typeof uploadReservedFileApplication;
  readonly getScopedUpload: typeof getScopedUpload;
  readonly abandonUploadBatch: typeof abandonUploadBatch;
  readonly createIssue: typeof createProjectIssue;
  readonly digestRunId: typeof digestRunId;
};

const applicationServices: ServerIssueCreateApplicationServices = {
  prepareUploads: prepareCreateIssueAttachmentUploadsApplication,
  uploadReservedFile: uploadReservedFileApplication,
  getScopedUpload,
  abandonUploadBatch,
  createIssue: createProjectIssue,
  digestRunId,
};

type MaterializedFile = {
  body: ArrayBuffer;
  metadata: UploadMetadata;
};

const materializeFiles = async (
  services: ServerIssueCreateApplicationServices,
  projectId: string,
  clientIssueId: string,
  files: readonly File[],
) =>
  Promise.all(files.map(async (file, position): Promise<MaterializedFile> => {
    const body = await file.arrayBuffer();
    return {
      body,
      metadata: {
        clientId: await services.digestRunId(
          projectId,
          "issue",
          `server-issue-upload:${clientIssueId}:${position}`,
        ),
        filename: file.name,
        contentType: file.type,
        byteSize: body.byteLength,
        sha256: new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
      },
    };
  }));

/**
 * Ingests files downloaded by a trusted server-side provider through the same
 * reservation, immutable metadata, R2 storage, receipt, and consumption
 * lifecycle used by Connect clients. Provider transport stays outside this
 * application boundary.
 */
export async function createIssueFromServerFilesApplication(
  input: {
    db: D1Database;
    attachmentsBucket: R2Bucket;
    signingSecret: string;
    projectId: string;
    userId: string;
    sourceKey: string;
    request: unknown;
    files: readonly File[];
    attribution: Omit<IssueCreateAttribution, "sourceKey">;
    observedAt?: string;
  },
  overrides: Partial<ServerIssueCreateApplicationServices> = {},
) {
  const services = { ...applicationServices, ...overrides };
  const clientIssueId = await services.digestRunId(
    input.projectId,
    "issue",
    input.sourceKey,
  );
  const create = (attachmentIds: readonly string[]) =>
    services.createIssue({
      db: input.db,
      projectId: input.projectId,
      userId: input.userId,
      clientIssueId,
      request: input.request,
      attachmentIds,
      attribution: { ...input.attribution, sourceKey: input.sourceKey },
    });
  if (input.files.length === 0) return create([]);

  const observedAt = input.observedAt ?? new Date().toISOString();
  const preparationRequestId = await services.digestRunId(
    input.projectId,
    "issue",
    `server-issue-upload-batch:${clientIssueId}`,
  );
  const materialized = await materializeFiles(
    services,
    input.projectId,
    clientIssueId,
    input.files,
  );
  const normalizedMetadata = normalizedIssueAttachmentUploadMetadata(
    materialized.map((file) => file.metadata),
  );
  const files = materialized.map((file, position) => ({
    ...file,
    metadata: normalizedMetadata[position]!,
  }));
  const prepared = await services.prepareUploads({
    db: input.db,
    signingSecret: input.signingSecret,
    projectId: input.projectId,
    userId: input.userId,
    preparationRequestId,
    mutationId: clientIssueId,
    attachments: files.map((file) => file.metadata),
    observedAt,
  });
  const uploadIds = prepared.uploads.map((upload) => upload.uploadId);
  try {
    const uploadRows = await Promise.all(
      uploadIds.map((uploadId) => services.getScopedUpload(input.db, uploadId)),
    );
    if (uploadRows.some((upload) => upload === null)) {
      throw new Error("Prepared issue upload disappeared");
    }
    if (uploadRows.some((upload) => upload!.consumed_at !== null)) {
      return create(uploadIds);
    }

    for (const [position, upload] of prepared.uploads.entries()) {
      const file = files[position]!;
      if (upload.clientId !== file.metadata.clientId) {
        throw new Error("Prepared issue upload order changed");
      }
      await services.uploadReservedFile({
        db: input.db,
        bucket: input.attachmentsBucket,
        signingSecret: input.signingSecret,
        uploadId: upload.uploadId,
        capability: upload.uploadCapability,
        contentType: file.metadata.contentType,
        body: file.body,
        observedAt,
      });
    }
    return await create(uploadIds);
  } catch (error) {
    try {
      await services.abandonUploadBatch(input.db, preparationRequestId);
    } catch (cleanupError) {
      console.error(JSON.stringify({
        message: "Server issue upload abandonment failed",
        error: cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError),
        preparationRequestId,
        clientIssueId,
      }));
    }
    throw error;
  }
}
