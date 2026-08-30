import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
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
  maxIssueAttachmentCount,
  maxIssueMultipartBytes,
  normalizeIssueAttachmentFile,
  validateIssueAttachments,
} from "../../src/lib/issue-attachments";
import {
  normalizeAgentReplyAttachmentFile,
  validateAgentReplyAttachments,
} from "../../src/lib/agent-reply-attachments";
import {
  isIssueAttachmentReference,
  issueAttachmentReferences,
} from "../../src/lib/issue-markdown";
import {
  channelMessageInputSchema,
  channelReplyCompleteInputSchema,
} from "../../src/lib/channels-contract";
import { HttpError } from "./http-response";
import {
  decodeIssueAgentReplyCompletion,
  decodeIssueInput,
  decodeIssueKeptAttachmentIds,
  decodeIssueMessageInput,
  decodeIssueUpdateInput,
} from "./issue-request-contract";
import { decodeRequestSync } from "./request-schema";
import { decodeRunEvidenceInput } from "./run-request-contract";
import { MAX_TRANSCRIPT_HTTP_BODY_BYTES } from "./transcript-limits";
import { decodeTranscriptRequestEffect } from "./transcript-request";

const decodeChannelReplyCompleteInput = decodeRequestSync(
  channelReplyCompleteInputSchema,
);
const decodeChannelMessageInput = decodeRequestSync(channelMessageInputSchema);

const jsonAttachmentEnvelope = (raw: unknown) => {
  if (!Predicate.isObject(raw)) {
    return { input: raw, attachmentReferences: [] as string[] };
  }
  const { attachmentReferences: rawReferences, ...input } = raw;
  if (rawReferences === undefined) {
    return { input, attachmentReferences: [] as string[] };
  }
  if (
    !Array.isArray(rawReferences) ||
    rawReferences.length > maxIssueAttachmentCount ||
    !rawReferences.every(isIssueAttachmentReference)
  ) {
    throw new HttpError(400, "Attachment references are invalid");
  }
  return { input, attachmentReferences: rawReferences };
};

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

function readMultipartJsonArray(
  form: FormData,
  fieldName: string,
  invalidMessage = `${fieldName} is invalid`,
) {
  const value = form.get(fieldName);
  if (typeof value !== "string" || !value) return [] as unknown[];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed;
  } catch {
    throw new HttpError(400, invalidMessage);
  }
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
export async function readRunEvidenceRequest(request: Request) {
  const form = await readBoundedMultipartForm(
    request,
    maxEvidenceMultipartBytes,
    "Evidence images exceed the 25MB total limit",
  );
  if (!form) {
    return {
      input: decodeRunEvidenceInput(await readJson(request)),
      images: [] as File[],
    };
  }
  const payload = form.get("evidence");
  if (typeof payload !== "string") {
    throw new HttpError(400, "Multipart evidence JSON is required");
  }
  let input: unknown;
  try {
    input = JSON.parse(payload);
  } catch {
    throw new HttpError(400, "Invalid multipart evidence JSON");
  }
  const images = readMultipartFiles(
    form,
    "images",
    "Evidence images must be files",
    validateEvidenceImages,
  );
  return { input: decodeRunEvidenceInput(input), images };
}

async function readReplyCompleteRequest<Input>(
  request: Request,
  input: {
    decode: (value: unknown) => Input;
    replyLabel: string;
  },
) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    `${input.replyLabel} attachments exceed the 25MB total limit`,
  );
  if (!form) {
    return {
      input: input.decode(await readJson(request)),
      attachments: [] as File[],
    };
  }
  const payload = form.get("complete");
  if (typeof payload !== "string") {
    throw new HttpError(400, `Multipart ${input.replyLabel.toLowerCase()} JSON is required`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new HttpError(400, `Invalid multipart ${input.replyLabel.toLowerCase()} JSON`);
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    `${input.replyLabel} attachments must be files`,
    validateAgentReplyAttachments,
    normalizeAgentReplyAttachmentFile,
  );
  const decoded = input.decode(parsed);
  if (
    typeof decoded === "object" && decoded !== null &&
    "error" in decoded && decoded.error && attachments.length > 0
  ) {
    throw new HttpError(400, "A failed reply cannot include attachments");
  }
  return { input: decoded, attachments };
}

export function readChannelReplyCompleteRequest(request: Request) {
  return readReplyCompleteRequest(request, {
    decode: decodeChannelReplyCompleteInput,
    replyLabel: "Channel reply",
  });
}

export function readIssueReplyCompleteRequest(request: Request) {
  return readReplyCompleteRequest(request, {
    decode: decodeIssueAgentReplyCompletion,
    replyLabel: "Issue reply",
  });
}

const maxProjectIconDataUrlLength = 400_000;
export const maxProjectIconRequestBytes = maxProjectIconDataUrlLength + 20;
export async function readIssueMessageRequest(request: Request) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Message attachments exceed the 25MB total limit",
  );
  if (!form) {
    const envelope = jsonAttachmentEnvelope(
      await readJson(request, 16_384),
    );
    return {
      input: decodeIssueMessageInput(envelope.input),
      attachments: [] as File[],
      attachmentReferences: envelope.attachmentReferences,
    };
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
  const attachmentReferences = readMultipartJsonArray(
    form,
    "attachmentReferences",
  );
  if (
    attachmentReferences.length !== attachments.length ||
    !attachmentReferences.every(isIssueAttachmentReference)
  ) {
    throw new HttpError(400, "Attachment references are invalid");
  }
  const rawBody = form.get("body");
  const bodyReferences = issueAttachmentReferences(
    typeof rawBody === "string" ? rawBody : null,
  );
  if (!attachmentReferences.every((reference) => bodyReferences.has(String(reference)))) {
    throw new HttpError(400, "Every message attachment must be referenced in the body");
  }
  const mentionedUserIds = readMultipartJsonArray(form, "mentionedUserIds");
  const mentionedAgentIds = readMultipartJsonArray(form, "mentionedAgentIds");
  const clientMessageId = form.get("clientMessageId");
  const parentMessageId = form.get("parentMessageId");
  const agentConversationId = form.get("agentConversationId");
  return {
    input: decodeIssueMessageInput({
      body: form.get("body"),
      clientMessageId:
        typeof clientMessageId === "string" && clientMessageId
          ? clientMessageId
          : undefined,
      parentMessageId:
        typeof parentMessageId === "string" && parentMessageId
          ? parentMessageId
          : null,
      mentionedUserIds,
      mentionedAgentIds,
      agentConversationId:
        typeof agentConversationId === "string" && agentConversationId
          ? agentConversationId
          : null,
    }),
    attachments,
    attachmentReferences: attachmentReferences as string[],
  };
}

export async function readChannelMessageRequest(request: Request) {
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
  const attachmentReferences = readMultipartJsonArray(
    form,
    "attachmentReferences",
  );
  if (
    attachmentReferences.length !== attachments.length ||
    !attachmentReferences.every(isIssueAttachmentReference)
  ) {
    throw new HttpError(400, "Attachment references are invalid");
  }
  const rawBody = form.get("body");
  const bodyReferences = issueAttachmentReferences(
    typeof rawBody === "string" ? rawBody : null,
  );
  if (!attachmentReferences.every((reference) => bodyReferences.has(String(reference)))) {
    throw new HttpError(400, "Every channel image must be referenced in the body");
  }
  const parentMessageId = form.get("parentMessageId");
  const clientMessageId = form.get("clientMessageId");
  const skillId = form.get("skillId");
  const preferredDeviceId = form.get("preferredDeviceId");
  return {
    input: decodeChannelMessageInput({
      body: rawBody,
      clientMessageId:
        typeof clientMessageId === "string" && clientMessageId
          ? clientMessageId
          : undefined,
      skillId:
        typeof skillId === "string" && skillId ? skillId : null,
      parentMessageId:
        typeof parentMessageId === "string" && parentMessageId
          ? parentMessageId
          : null,
      mentionedUserIds: readMultipartJsonArray(form, "mentionedUserIds"),
      mentionedAgentIds: readMultipartJsonArray(form, "mentionedAgentIds"),
      preferredDeviceId:
        typeof preferredDeviceId === "string" && preferredDeviceId
          ? preferredDeviceId
          : null,
    }),
    attachments,
    attachmentReferences: attachmentReferences as string[],
  };
}

export async function readIssueRequest(request: Request) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Issue attachments exceed the 25MB total limit",
  );
  if (!form) {
    const envelope = jsonAttachmentEnvelope(await readJson(request));
    return {
      input: decodeIssueInput(envelope.input),
      attachments: [] as File[],
      attachmentReferences: envelope.attachmentReferences,
    };
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    "Attachments must be files",
    validateIssueAttachments,
  );

  const rawAttachmentReferences = form.get("attachmentReferences");
  let attachmentReferences: string[] = [];
  if (typeof rawAttachmentReferences === "string" && rawAttachmentReferences) {
    const parsed = readMultipartJsonArray(
      form,
      "attachmentReferences",
      "Attachment references are invalid",
    );
    if (
      parsed.length !== attachments.length ||
      !parsed.every(isIssueAttachmentReference)
    ) {
      throw new HttpError(400, "Attachment references are invalid");
    }
    attachmentReferences = parsed as string[];
  }

  const description = form.get("description");
  const priority = form.get("priority");
  const difficulty = form.get("difficulty");
  const assigneeUserId = form.get("assigneeUserId");
  const status = form.get("status");
  const preferredProvider = form.get("preferredProvider");
  const preferredModel = form.get("preferredModel");
  const preferredEffort = form.get("preferredEffort");
  const fullAuto = form.get("fullAuto");
  const rawCheckpoints = form.get("checkpoints");
  const checkpoints = (() => {
    if (typeof rawCheckpoints !== "string" || !rawCheckpoints) return [];
    try {
      const parsed: unknown = JSON.parse(rawCheckpoints);
      return parsed;
    } catch {
      throw new HttpError(400, "Issue checkpoints are invalid");
    }
  })();
  return {
    input: decodeIssueInput({
      title: form.get("title"),
      description:
        typeof description === "string" && description.trim()
          ? description
          : null,
      priority:
        typeof priority === "string" && priority ? Number(priority) : null,
      difficulty:
        typeof difficulty === "string" && difficulty
          ? difficulty
          : undefined,
      assigneeUserId:
        typeof assigneeUserId === "string" && assigneeUserId.trim()
          ? assigneeUserId
          : null,
      status: typeof status === "string" && status ? status : undefined,
      preferredProvider:
        typeof preferredProvider === "string" && preferredProvider.trim()
          ? preferredProvider
          : null,
      preferredModel:
        typeof preferredModel === "string" && preferredModel.trim()
          ? preferredModel
          : null,
      preferredEffort:
        typeof preferredEffort === "string" && preferredEffort.trim()
          ? preferredEffort
          : null,
      fullAuto:
        fullAuto === null
          ? undefined
          : fullAuto === "true"
            ? true
            : fullAuto === "false"
              ? false
              : fullAuto,
      checkpoints,
    }),
    attachments,
    attachmentReferences,
  };
}

export async function readIssueUpdateRequest(request: Request) {
  const form = await readBoundedMultipartForm(
    request,
    maxIssueMultipartBytes,
    "Issue attachments exceed the 25MB total limit",
  );
  if (!form) {
    const raw = await readJson(request);
    const envelope = jsonAttachmentEnvelope(raw);
    const { fields, keptAttachmentIds } = (() => {
      if (!Predicate.isObject(envelope.input)) {
        return { fields: envelope.input, keptAttachmentIds: undefined };
      }
      const { keptAttachmentIds, ...fields } = envelope.input;
      return { fields, keptAttachmentIds };
    })();
    return {
      input: decodeIssueUpdateInput(fields),
      attachments: [] as File[],
      attachmentReferences: envelope.attachmentReferences,
      keptAttachmentIds:
        keptAttachmentIds === undefined
          ? undefined
          : decodeIssueKeptAttachmentIds(keptAttachmentIds),
    };
  }
  const attachments = readMultipartFiles(
    form,
    "attachments",
    "Attachments must be files",
    validateIssueAttachments,
  );

  const rawAttachmentReferences = form.get("attachmentReferences");
  let attachmentReferences: string[] = [];
  if (typeof rawAttachmentReferences === "string" && rawAttachmentReferences) {
    const parsed = readMultipartJsonArray(
      form,
      "attachmentReferences",
      "Attachment references are invalid",
    );
    if (
      parsed.length !== attachments.length ||
      !parsed.every(isIssueAttachmentReference)
    ) {
      throw new HttpError(400, "Attachment references are invalid");
    }
    attachmentReferences = parsed as string[];
  }

  const rawKeptAttachmentIds = form.get("keptAttachmentIds");
  let keptAttachmentIds: string[] | undefined;
  if (typeof rawKeptAttachmentIds === "string" && rawKeptAttachmentIds) {
    try {
      const parsed = readMultipartJsonArray(
        form,
        "keptAttachmentIds",
        "Kept attachment IDs are invalid",
      );
      if (!parsed.every((id) => typeof id === "string")) {
        throw new Error("invalid kept attachment ids");
      }
      keptAttachmentIds = decodeIssueKeptAttachmentIds(parsed);
    } catch {
      throw new HttpError(400, "Kept attachment IDs are invalid");
    }
  }

  const description = form.get("description");
  const priority = form.get("priority");
  const difficulty = form.get("difficulty");
  const assigneeUserId = form.get("assigneeUserId");
  return {
    input: decodeIssueUpdateInput({
      title: form.get("title"),
      description:
        typeof description === "string" && description.trim()
          ? description
          : null,
      priority:
        typeof priority === "string" && priority ? Number(priority) : null,
      difficulty:
        typeof difficulty === "string" && difficulty ? difficulty : null,
      ...(form.has("assigneeUserId")
        ? {
            assigneeUserId:
              typeof assigneeUserId === "string" && assigneeUserId.trim()
                ? assigneeUserId
                : null,
          }
        : {}),
    }),
    attachments,
    attachmentReferences,
    keptAttachmentIds,
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

export async function readTranscriptRequest(request: Request) {
  return Effect.runPromise(
    decodeTranscriptRequestEffect(
      await readJson(request, MAX_TRANSCRIPT_HTTP_BODY_BYTES),
    ),
  );
}
