import type { UploadFileMetadata } from "@briar/contracts/gen/briar/types/v1/upload_pb";
import { isIssueAttachmentReference } from "../../src/lib/issue-markdown";
import {
  issueAttachmentMimeTypes,
  issueAttachmentMimeTypeFromName,
  validateIssueAttachments,
} from "../../src/lib/issue-attachments";
import { getHuntRunForProject } from "./db";
import { HttpError } from "./http-response";
import {
  prepareIssueAttachmentUploadRows,
  type IssueAttachmentUploadPurpose,
} from "./issue-attachment-upload-repository";
import { hasOrganizationCapability } from "./organization-access";
import { getTeam } from "./team-command-repository";
import { createUploadCapability, UPLOAD_CAPABILITY_MAX_TTL_MS } from "./upload-capability";
import type { UploadMetadata } from "./upload-repository";

export type IssueAttachmentUploadApplicationServices = {
  readonly getTeam: typeof getTeam;
  readonly getHuntRunForProject: typeof getHuntRunForProject;
  readonly prepareIssueAttachmentUploadRows:
    typeof prepareIssueAttachmentUploadRows;
  readonly createUploadCapability: typeof createUploadCapability;
};

const applicationServices: IssueAttachmentUploadApplicationServices = {
  getTeam,
  getHuntRunForProject,
  prepareIssueAttachmentUploadRows,
  createUploadCapability,
};

const allowedContentTypes = new Set<string>(issueAttachmentMimeTypes);

const normalizedContentType = (value: string, filename: string) => {
  const declared = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return allowedContentTypes.has(declared)
    ? declared
    : issueAttachmentMimeTypeFromName(filename) ?? declared;
};

export function issueAttachmentUploadMetadata(
  attachments: readonly UploadFileMetadata[],
): UploadMetadata[] {
  if (
    attachments.some(
      (attachment) => attachment.byteSize > BigInt(Number.MAX_SAFE_INTEGER),
    )
  ) {
    throw new HttpError(400, "Issue attachment metadata is invalid");
  }
  return normalizedIssueAttachmentUploadMetadata(
    attachments.map((attachment) => ({
      clientId: attachment.clientId,
      filename: attachment.filename,
      contentType: attachment.contentType,
      byteSize: Number(attachment.byteSize),
      sha256: attachment.sha256,
    })),
  );
}

export function normalizedIssueAttachmentUploadMetadata(
  attachments: readonly UploadMetadata[],
): UploadMetadata[] {
  if (attachments.length === 0) {
    throw new HttpError(400, "At least one issue attachment is required");
  }
  const files = attachments.map((attachment) => {
    const clientId = attachment.clientId.trim();
    const filename = attachment.filename.normalize("NFC").trim();
    if (
      !isIssueAttachmentReference(clientId) ||
      clientId.length > 128 ||
      attachment.sha256.byteLength !== 32 ||
      !Number.isSafeInteger(attachment.byteSize)
    ) {
      throw new HttpError(400, "Issue attachment metadata is invalid");
    }
    return {
      clientId,
      filename,
      contentType: normalizedContentType(attachment.contentType, filename),
      byteSize: attachment.byteSize,
      sha256: attachment.sha256,
    };
  });
  if (new Set(files.map((file) => file.clientId)).size !== files.length) {
    throw new HttpError(400, "Issue attachment client IDs must be unique");
  }
  const validationError = validateIssueAttachments(
    files.map((file) => ({
      name: file.filename,
      type: file.contentType,
      size: file.byteSize,
    })),
  );
  if (validationError) throw new HttpError(400, validationError);
  return files;
}

type PrepareIssueAttachmentContext = {
  db: D1Database;
  signingSecret: string;
  projectId: string;
  userId: string;
  preparationRequestId: string;
  mutationId: string;
  runId: string | null;
  observedAt?: string;
};

export type PrepareIssueAttachmentUploadsInput =
  & PrepareIssueAttachmentContext
  & { attachments: readonly UploadMetadata[] };

type PrepareIssueAttachmentInput = PrepareIssueAttachmentContext & {
  attachments: readonly UploadFileMetadata[];
};

async function prepareIssueAttachmentsApplication(
  purpose: IssueAttachmentUploadPurpose,
  input: PrepareIssueAttachmentUploadsInput,
  overrides: Partial<IssueAttachmentUploadApplicationServices>,
) {
  const services = { ...applicationServices, ...overrides };
  const project = await services.getTeam(input.db, input.projectId, input.userId);
  const capability = purpose === "issue_message" ? "conversations:write" : "issues:write";
  if (!project) throw new HttpError(404, "Project not found");
  if (!hasOrganizationCapability(project.member_role, capability)) {
    throw new HttpError(403, "Issue attachment upload permission required");
  }
  if (
    input.runId !== null &&
    !(await services.getHuntRunForProject(input.db, project.id, input.runId))
  ) {
    throw new HttpError(404, "Run not found");
  }
  const attachments = normalizedIssueAttachmentUploadMetadata(input.attachments);
  const observedAt = input.observedAt ?? new Date().toISOString();
  const expiresAt = new Date(
    Date.parse(observedAt) + UPLOAD_CAPABILITY_MAX_TTL_MS,
  ).toISOString();
  let prepared;
  try {
    prepared = await services.prepareIssueAttachmentUploadRows(input.db, {
      purpose,
      organizationId: project.organization_id,
      projectId: project.id,
      userId: input.userId,
      mutationId: input.mutationId,
      runId: input.runId,
      preparationRequestId: input.preparationRequestId,
      attachments,
      createdAt: observedAt,
      expiresAt,
    });
  } catch {
    throw new HttpError(409, "Issue attachment reservation is no longer authorized");
  }
  if (!prepared) {
    throw new HttpError(
      409,
      "Issue attachment prepare request was reused with different metadata",
    );
  }
  if (prepared.batch.expires_at <= observedAt) {
    throw new HttpError(409, "Issue attachment prepare request expired; use a new request ID");
  }
  const capabilityExpiresAt = Date.parse(prepared.batch.expires_at);
  return {
    replayed: prepared.replayed,
    uploads: await Promise.all(
      prepared.uploads.map(async (upload) => ({
        clientId: upload.client_id,
        uploadId: upload.upload_id,
        uploadCapability: await services.createUploadCapability(input.signingSecret, {
          uploadId: upload.upload_id,
          expiresAt: capabilityExpiresAt,
        }),
        expiresAt: prepared.batch.expires_at,
      })),
    ),
  };
}

export function prepareCreateIssueAttachmentsApplication(
  input: Omit<PrepareIssueAttachmentInput, "runId">,
  overrides: Partial<IssueAttachmentUploadApplicationServices> = {},
) {
  return prepareCreateIssueAttachmentUploadsApplication({
    ...input,
    attachments: issueAttachmentUploadMetadata(input.attachments),
  }, overrides);
}

export function prepareCreateIssueAttachmentUploadsApplication(
  input: Omit<PrepareIssueAttachmentUploadsInput, "runId">,
  overrides: Partial<IssueAttachmentUploadApplicationServices> = {},
) {
  return prepareIssueAttachmentsApplication(
    "issue_create",
    { ...input, runId: null },
    overrides,
  );
}

export function prepareUpdateIssueAttachmentsApplication(
  input: PrepareIssueAttachmentInput & { runId: string },
  overrides: Partial<IssueAttachmentUploadApplicationServices> = {},
) {
  return prepareIssueAttachmentsApplication("issue_update", {
    ...input,
    attachments: issueAttachmentUploadMetadata(input.attachments),
  }, overrides);
}

export function prepareIssueMessageAttachmentsApplication(
  input: PrepareIssueAttachmentInput & { runId: string },
  overrides: Partial<IssueAttachmentUploadApplicationServices> = {},
) {
  return prepareIssueAttachmentsApplication("issue_message", {
    ...input,
    attachments: issueAttachmentUploadMetadata(input.attachments),
  }, overrides);
}
