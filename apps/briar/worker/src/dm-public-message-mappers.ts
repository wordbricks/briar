import { DmMessagePurpose } from "@briar/contracts/gen/briar/app/v1/channel_pb";
import {
  DmMessagePublicationKind,
  type PublishDmMessageBatchRequest,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import {
  replyWireClaim,
  ReplyCompletionMappingError,
  type ReplyWireClaim,
} from "./worker-reply-completion-mappers";
import type {
  DmPublicMessagePartInput,
  DmPublicMessagePublicationKind,
  DmPublicMessagePurpose,
} from "./dm-public-message-model";

const canonicalUuid = decodeRequestSync(UuidString);

const uuid = (value: string, field: string) => {
  try {
    return canonicalUuid(value).toLowerCase();
  } catch (cause) {
    throw new ReplyCompletionMappingError(`${field} is invalid`, { cause });
  }
};

const text = (value: string, field: string, maximum: number) => {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new ReplyCompletionMappingError(
      `${field} must contain 1-${maximum} characters`,
    );
  }
  return normalized;
};

const safeInteger = (value: bigint, field: string) => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ReplyCompletionMappingError(`${field} is invalid`);
  }
  return Number(value);
};

const purposes = new Map<DmMessagePurpose, DmPublicMessagePurpose>([
  [DmMessagePurpose.ACKNOWLEDGEMENT, "acknowledgement"],
  [DmMessagePurpose.PROGRESS, "progress"],
  [DmMessagePurpose.DISCOVERY, "discovery"],
  [DmMessagePurpose.QUESTION, "question"],
  [DmMessagePurpose.RESULT, "result"],
  [DmMessagePurpose.CONVERSATION, "conversation"],
]);

const publicationKinds = new Map<
  DmMessagePublicationKind,
  DmPublicMessagePublicationKind
>([
  [DmMessagePublicationKind.INTERMEDIATE, "intermediate"],
  [DmMessagePublicationKind.FINAL, "final"],
]);

export type PublishDmPublicMessageBatchInput = {
  requestId: string;
  projectId: string;
  workerId: string;
  claim: ReplyWireClaim & { replyKind: "channel"; organizationId: string };
  expectedInputRevision: number;
  publicationKind: DmPublicMessagePublicationKind;
  parts: DmPublicMessagePartInput[];
};

export function publishDmPublicMessageBatchInputFromProto(
  request: PublishDmMessageBatchRequest,
): PublishDmPublicMessageBatchInput {
  const claim = replyWireClaim(request.work, "channel");
  if (claim.replyKind !== "channel" || claim.organizationId === null) {
    throw new ReplyCompletionMappingError("Channel reply claim is required");
  }
  const publicationKind = publicationKinds.get(request.publicationKind);
  if (!publicationKind) {
    throw new ReplyCompletionMappingError("DM publication kind is invalid");
  }
  if (request.parts.length < 1 || request.parts.length > 8) {
    throw new ReplyCompletionMappingError(
      "DM publication must contain 1-8 parts",
    );
  }
  const parts = request.parts.map((part): DmPublicMessagePartInput => {
    const purpose = purposes.get(part.purpose);
    if (!purpose) {
      throw new ReplyCompletionMappingError("DM message purpose is invalid");
    }
    return {
      body: text(part.body, "DM message body", 50_000),
      purpose,
    };
  });
  return {
    requestId: uuid(request.requestId, "DM publication request ID"),
    projectId: uuid(request.projectId, "DM publication project ID"),
    workerId: text(request.workerId, "Worker ID", 128),
    claim: {
      ...claim,
      replyKind: "channel",
      organizationId: claim.organizationId,
    },
    expectedInputRevision: safeInteger(
      request.expectedInputRevision,
      "DM input revision",
    ),
    publicationKind,
    parts,
  };
}
