import {
  fromBinary,
  type DescMessage,
} from "@bufbuild/protobuf";
import {
  CreateChannelMessageRequestSchema,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import {
  CreateIssueMessageRequestSchema,
  CreateIssueRequestSchema,
  UpdateIssueRequestSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import {
  RecordRunEvidenceRequestSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
  type AutoHuntRunStatus,
  type AutoHuntWorkflowStageId,
  type DashboardStage,
} from "../../src/lib/auto-hunt-contract";
import {
  maxEvidenceMultipartBytes,
  validateEvidenceImages,
} from "../../src/lib/evidence-images";
import {
  maxIssueMultipartBytes,
  normalizeIssueAttachmentFile,
  validateIssueAttachments,
} from "../../src/lib/issue-attachments";
import {
  isIssueAttachmentReference,
  issueAttachmentReferences,
} from "../../src/lib/issue-markdown";
import { HttpError } from "./http-response";
import { decodeRequestSync } from "./request-schema";
import {
  recordRunEvidenceApplicationRequest,
} from "./run-evidence-request-mapper";
import {
  canonicalAppUuid,
  createChannelMessageApplicationRequest,
  createIssueApplicationRequest,
  createIssueMessageApplicationRequest,
  updateIssueApplicationRequest,
} from "./app-mutation-request-mappers";

async function readBoundedMultipartForm(
  request: Request,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<FormData | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return null;
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    throw new HttpError(411, "Multipart Content-Length is required");
  }
  if (declaredLength > maxBytes) {
    throw new HttpError(413, tooLargeMessage);
  }

  try {
    return await request.formData();
  } catch {
    throw new HttpError(400, "Invalid multipart form data");
  }
}

function readMultipartFiles(
  form: FormData,
  fieldName: string,
  invalidFilesMessage: string,
  validate: (files: readonly File[]) => string | null,
  normalize: (file: File) => File = normalizeIssueAttachmentFile,
) {
  const values = form.getAll(fieldName);
  if (values.some((value) => !(value instanceof File))) {
    throw new HttpError(400, invalidFilesMessage);
  }
  const files = (values as File[]).map(normalize);
  const validationError = validate(files);
  if (validationError) throw new HttpError(400, validationError);
  return files;
}

async function readMultipartProtobuf<Desc extends DescMessage>(
  form: FormData,
  schema: Desc,
  label: string,
): Promise<ReturnType<typeof fromBinary<Desc>>> {
  const parts = form.getAll("request");
  if (
    parts.length !== 1 || !(parts[0] instanceof File) ||
    parts[0].type.toLowerCase() !== "application/protobuf"
  ) {
    throw new HttpError(
      400,
      `Multipart ${label} protobuf request is required`,
    );
  }
  try {
    return fromBinary(
      schema,
      new Uint8Array(await parts[0].arrayBuffer()),
    );
  } catch {
    throw new HttpError(400, `Invalid multipart ${label} protobuf request`);
  }
}

function requireMultipartIdentity(
  identities: ReadonlyArray<{
    actual: string;
    expected: string;
    label: string;
  }>,
) {
  try {
    for (const identity of identities) {
      if (
        canonicalAppUuid(identity.actual) !==
          canonicalAppUuid(identity.expected)
      ) {
        throw new HttpError(
          400,
          `Multipart ${identity.label} does not match the request path`,
        );
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Multipart request identity is invalid");
  }
}

function validateMultipartAttachmentReferences(
  references: readonly string[],
  attachments: readonly File[],
  input: { required: boolean; message: string },
) {
  if (
    ((input.required || references.length > 0) &&
      references.length !== attachments.length) ||
    !references.every(isIssueAttachmentReference)
  ) {
    throw new HttpError(400, input.message);
  }
  return [...references];
}

export const dashboardStageForProgress = (
  status: AutoHuntRunStatus,
  workflowStage: AutoHuntWorkflowStageId | null,
): DashboardStage => {
  if (status === "backlog") return "queued";
  if (status === "paused") {
    return workflowStage &&
      [
        "analyzing",
        "implementing",
        "pr_open",
        "staging_qa",
        "production_qa",
      ].includes(workflowStage)
      ? (workflowStage as DashboardStage)
      : "implementing";
  }
  if (status !== "running") return status;
  return workflowStage &&
    [
      "analyzing",
      "implementing",
      "pr_open",
      "staging_qa",
      "production_qa",
    ].includes(workflowStage)
    ? (workflowStage as DashboardStage)
    : "implementing";
};
export async function readRunEvidenceRequest(
  request: Request,
  path: { projectId: string; runId: string },
) {
  const form = await readBoundedMultipartForm(
    request,
    maxEvidenceMultipartBytes,
    "Evidence images exceed the 25MB total limit",
  );
  if (!form) {
    throw new HttpError(415, "Evidence uploads must be multipart");
  }
  const images = readMultipartFiles(
    form,
    "images",
    "Evidence images must be files",
    validateEvidenceImages,
  );
  const evidence = await readMultipartProtobuf(
    form,
    RecordRunEvidenceRequestSchema,
    "run evidence",
  );
  requireMultipartIdentity([
    {
      actual: evidence.projectId,
      expected: path.projectId,
      label: "project ID",
    },
    {
      actual: evidence.runId,
      expected: path.runId,
      label: "run ID",
    },
  ]);
  return {
    input: recordRunEvidenceApplicationRequest(evidence),
    images,
  };
}

export async function readIssueMessageRequest(
  request: Request,
  path: { projectId: string; runId: string },
) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Message attachments exceed the 25MB total limit",
  );
  if (!form) {
    throw new HttpError(415, "Issue message uploads must be multipart");
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    "Attachments must be files",
    validateIssueAttachments,
  );
  if (attachments.some((attachment) => !attachment.type.startsWith("image/"))) {
    throw new HttpError(400, "Conversation attachments must be images");
  }
  const message = await readMultipartProtobuf(
    form,
    CreateIssueMessageRequestSchema,
    "issue message",
  );
  requireMultipartIdentity([
    {
      actual: message.projectId,
      expected: path.projectId,
      label: "project ID",
    },
    { actual: message.runId, expected: path.runId, label: "run ID" },
  ]);
  const attachmentReferences = validateMultipartAttachmentReferences(
    message.attachmentReferences,
    attachments,
    { required: true, message: "Attachment references are invalid" },
  );
  const bodyReferences = issueAttachmentReferences(message.body);
  if (!attachmentReferences.every((reference) => bodyReferences.has(reference))) {
    throw new HttpError(400, "Every message attachment must be referenced in the body");
  }
  return {
    input: createIssueMessageApplicationRequest(message),
    attachments,
    attachmentReferences,
  };
}

export async function readChannelMessageRequest(
  request: Request,
  path: { organizationId: string; channelId: string },
) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Channel images exceed the 25MB total limit",
  );
  if (!form) {
    throw new HttpError(415, "Channel message uploads must be multipart");
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    "Attachments must be files",
    validateIssueAttachments,
  );
  if (attachments.some((attachment) => !attachment.type.startsWith("image/"))) {
    throw new HttpError(400, "Channel attachments must be images");
  }
  const message = await readMultipartProtobuf(
    form,
    CreateChannelMessageRequestSchema,
    "channel message",
  );
  requireMultipartIdentity([
    {
      actual: message.organizationId,
      expected: path.organizationId,
      label: "organization ID",
    },
    {
      actual: message.channelId,
      expected: path.channelId,
      label: "channel ID",
    },
  ]);
  const attachmentReferences = validateMultipartAttachmentReferences(
    message.attachmentReferences,
    attachments,
    { required: true, message: "Attachment references are invalid" },
  );
  const bodyReferences = issueAttachmentReferences(message.body);
  if (!attachmentReferences.every((reference) => bodyReferences.has(reference))) {
    throw new HttpError(400, "Every channel image must be referenced in the body");
  }
  return {
    input: createChannelMessageApplicationRequest(message),
    attachments,
    attachmentReferences,
  };
}

export async function readIssueRequest(
  request: Request,
  path: { projectId: string },
) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Issue attachments exceed the 25MB total limit",
  );
  if (!form) {
    throw new HttpError(415, "Issue uploads must be multipart");
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    "Attachments must be files",
    validateIssueAttachments,
  );
  const message = await readMultipartProtobuf(
    form,
    CreateIssueRequestSchema,
    "issue",
  );
  requireMultipartIdentity([{
    actual: message.projectId,
    expected: path.projectId,
    label: "project ID",
  }]);
  const attachmentReferences = validateMultipartAttachmentReferences(
    message.attachmentReferences,
    attachments,
    { required: false, message: "Attachment references are invalid" },
  );
  return {
    input: createIssueApplicationRequest(message),
    attachments,
    attachmentReferences,
  };
}

export async function readIssueUpdateRequest(
  request: Request,
  path: { projectId: string; runId: string },
) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Issue attachments exceed the 25MB total limit",
  );
  if (!form) {
    throw new HttpError(415, "Issue update uploads must be multipart");
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    "Attachments must be files",
    validateIssueAttachments,
  );
  const message = await readMultipartProtobuf(
    form,
    UpdateIssueRequestSchema,
    "issue update",
  );
  requireMultipartIdentity([
    {
      actual: message.projectId,
      expected: path.projectId,
      label: "project ID",
    },
    { actual: message.runId, expected: path.runId, label: "run ID" },
  ]);
  const attachmentReferences = validateMultipartAttachmentReferences(
    message.attachmentReferences,
    attachments,
    { required: false, message: "Attachment references are invalid" },
  );
  return {
    input: updateIssueApplicationRequest(message),
    attachments,
    attachmentReferences,
    keptAttachmentIds: message.keptAttachmentIds?.values,
  };
}

export async function readJson(
  request: Request,
  maxBytes = 262_144,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes)
    throw new HttpError(413, "Request body too large");
  if (!request.body) throw new HttpError(400, "Request body is required");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
