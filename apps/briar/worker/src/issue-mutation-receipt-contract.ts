import { agentProviders } from "../../src/lib/agent-provider";
import { IsoDateTimeWithOffset } from "../../src/lib/date-time-schema";
import {
  issueAttachmentMimeTypes,
  maxIssueAttachmentBytes,
  maxIssueAttachmentCount,
} from "../../src/lib/issue-attachments";
import { issueDifficulties } from "../../src/lib/issue-difficulty";
import { issueAttachmentReferencePattern } from "../../src/lib/issue-markdown";
import {
  issueTitleAbsoluteMaxLength,
  issueTitleOverLimitMessage,
} from "../../src/lib/issue-title";
import * as Schema from "effect/Schema";
import {
  integerBetween,
  NonNegativeSafeInteger,
  strictSchema,
  strictSchemaOptions,
} from "./schema-codecs";

const storedText = (minimumLength: number, maximumLength: number) =>
  Schema.Trimmed.check(
    Schema.isLengthBetween(minimumLength, maximumLength),
  );

const StoredIdentifier = Schema.String.check(
  Schema.isLengthBetween(1, 128),
  Schema.isPattern(issueAttachmentReferencePattern),
);

const uniqueIdentifiers = (maximumLength: number) =>
  Schema.Array(StoredIdentifier).check(
    Schema.isMaxLength(maximumLength),
    Schema.makeFilter((values) =>
      new Set(values).size === values.length
        ? undefined
        : "identifiers must be unique"
    ),
  );

const IssueMutationAttachment = strictSchema(Schema.Struct({
  id: StoredIdentifier,
  filename: storedText(1, 255),
  contentType: Schema.Literals(issueAttachmentMimeTypes),
  byteSize: integerBetween(1, maxIssueAttachmentBytes),
  url: Schema.String.check(Schema.isLengthBetween(1, 1_000)),
}));

const StoredIssueTitle = Schema.Trimmed.check(
  Schema.isLengthBetween(1, issueTitleAbsoluteMaxLength),
  Schema.makeFilter((title) => issueTitleOverLimitMessage(title) ?? undefined),
);

const issueMutationAttachments = Schema.mutable(
  Schema.Array(IssueMutationAttachment),
).check(
  Schema.isMaxLength(maxIssueAttachmentCount),
  Schema.makeFilter((attachments) =>
    new Set(attachments.map(({ id }) => id)).size === attachments.length
      ? undefined
      : "attachment IDs must be unique"
  ),
);

export const IssueMutationAttachmentUploadIds = uniqueIdentifiers(
  maxIssueAttachmentCount,
);

export const IssueCreateMutationReceiptResponse = strictSchema(Schema.Struct({
  runId: StoredIdentifier,
  sourceKey: storedText(1, 200),
  stage: Schema.Literal("queued"),
  status: Schema.Literals(["backlog", "queued"]),
  assigneeUserId: Schema.NullOr(storedText(1, 200)),
  createdByUserId: storedText(1, 200),
  difficulty: Schema.NullOr(Schema.Literals(issueDifficulties)),
  parentRunId: Schema.NullOr(StoredIdentifier),
  attachments: issueMutationAttachments,
}));
export type IssueCreateMutationReceiptResponse =
  typeof IssueCreateMutationReceiptResponse.Type;

export const IssueUpdateMutationReceiptResponse = strictSchema(Schema.Struct({
  runId: StoredIdentifier,
  title: StoredIssueTitle,
  description: Schema.NullOr(
    Schema.Trimmed.check(Schema.isMaxLength(100_000)),
  ),
  priority: Schema.NullOr(integerBetween(1, 4)),
  difficulty: Schema.NullOr(Schema.Literals(issueDifficulties)),
  assigneeUserId: Schema.NullOr(storedText(1, 200)),
  attachments: issueMutationAttachments,
}));
export type IssueUpdateMutationReceiptResponse =
  typeof IssueUpdateMutationReceiptResponse.Type;

const IssueMessageMutationReceiptAuthor = strictSchema(Schema.Struct({
  id: Schema.NullOr(storedText(1, 200)),
  name: storedText(1, 200),
  image: Schema.NullOr(Schema.String.check(Schema.isLengthBetween(1, 4_096))),
  agentId: Schema.Null,
  provider: Schema.NullOr(Schema.Literals(agentProviders)),
}).check(
  Schema.makeFilter((author) =>
    author.provider === null
      ? author.id === null
        ? "user-authored messages require an author ID"
        : undefined
      : author.id !== null || author.image !== null
        ? "provider-authored messages cannot impersonate a user"
        : undefined
  ),
));

const IssueMessageMutationReceiptMessage = strictSchema(Schema.Struct({
  id: StoredIdentifier,
  runId: StoredIdentifier,
  parentMessageId: Schema.NullOr(StoredIdentifier),
  body: storedText(1, 10_000),
  attachments: issueMutationAttachments,
  author: IssueMessageMutationReceiptAuthor,
  replyCount: Schema.Literal(0),
  proposedAction: Schema.Null,
  executionProposal: Schema.Null,
  skillExecutionProposal: Schema.Null,
  createdAt: IsoDateTimeWithOffset,
  updatedAt: IsoDateTimeWithOffset,
}).check(
  Schema.makeFilter((message) =>
    message.createdAt === message.updatedAt
      ? undefined
      : "receipt messages must preserve their creation snapshot"
  ),
));

const IssueMessageMutationReceiptAgentReply = strictSchema(Schema.Struct({
  id: StoredIdentifier,
  triggerMessageId: StoredIdentifier,
  parentMessageId: StoredIdentifier,
  agentId: StoredIdentifier,
  agentName: storedText(1, 100),
  status: Schema.Literal("queued"),
  attempts: Schema.Literal(0),
  workerId: Schema.Null,
  provider: Schema.Null,
  error: Schema.Null,
  updatedAt: IsoDateTimeWithOffset,
}));

const equivalentAgentReply = Schema.toEquivalence(
  IssueMessageMutationReceiptAgentReply,
);

export const IssueMessageMutationReceiptResponse = strictSchema(Schema.Struct({
  message: IssueMessageMutationReceiptMessage,
  agentReply: Schema.NullOr(IssueMessageMutationReceiptAgentReply),
  agentReplies: Schema.mutable(
    Schema.Array(IssueMessageMutationReceiptAgentReply),
  ).check(Schema.isMaxLength(20)),
}).check(
  Schema.makeFilter((response) => {
    const expectedParentId = response.message.parentMessageId ??
      response.message.id;
    if (
      new Set(response.agentReplies.map(({ id }) => id)).size !==
        response.agentReplies.length ||
      new Set(response.agentReplies.map(({ agentId }) => agentId)).size !==
        response.agentReplies.length
    ) {
      return "Agent reply identities must be unique";
    }
    if (response.agentReplies.some((reply) =>
      reply.triggerMessageId !== response.message.id ||
      reply.parentMessageId !== expectedParentId ||
      reply.updatedAt !== response.message.createdAt
    )) {
      return "Agent replies must belong to the stored message snapshot";
    }
    const singleton = response.agentReplies.length === 1
      ? response.agentReplies[0]!
      : null;
    return response.agentReply === null
      ? singleton === null
        ? undefined
        : "A single Agent reply requires the singular projection"
      : singleton !== null && equivalentAgentReply(response.agentReply, singleton)
        ? undefined
        : "The singular Agent reply must equal the only reply";
  }),
));
export type IssueMessageMutationReceiptResponse =
  typeof IssueMessageMutationReceiptResponse.Type;

const IssueMutationAttachmentUploadIdsJson = Schema.fromJsonString(
  IssueMutationAttachmentUploadIds,
);
const IssueCreateMutationReceiptResponseJson = Schema.fromJsonString(
  IssueCreateMutationReceiptResponse,
);
const IssueUpdateMutationReceiptResponseJson = Schema.fromJsonString(
  IssueUpdateMutationReceiptResponse,
);
const IssueMessageMutationReceiptResponseJson = Schema.fromJsonString(
  IssueMessageMutationReceiptResponse,
);

export const decodeIssueCreateMutationReceiptResponse =
  Schema.decodeUnknownSync(
    IssueCreateMutationReceiptResponse,
    strictSchemaOptions,
  );
export const decodeIssueUpdateMutationReceiptResponse =
  Schema.decodeUnknownSync(
    IssueUpdateMutationReceiptResponse,
    strictSchemaOptions,
  );
export const decodeIssueMessageMutationReceiptResponse =
  Schema.decodeUnknownSync(
    IssueMessageMutationReceiptResponse,
    strictSchemaOptions,
  );
export const encodeIssueMutationAttachmentUploadIdsJson = Schema.encodeSync(
  IssueMutationAttachmentUploadIdsJson,
  strictSchemaOptions,
);
export const decodeIssueCreateMutationReceiptResponseJson =
  Schema.decodeUnknownSync(
    IssueCreateMutationReceiptResponseJson,
    strictSchemaOptions,
  );
export const encodeIssueCreateMutationReceiptResponseJson = Schema.encodeSync(
  IssueCreateMutationReceiptResponseJson,
  strictSchemaOptions,
);
export const decodeIssueUpdateMutationReceiptResponseJson =
  Schema.decodeUnknownSync(
    IssueUpdateMutationReceiptResponseJson,
    strictSchemaOptions,
  );
export const encodeIssueUpdateMutationReceiptResponseJson = Schema.encodeSync(
  IssueUpdateMutationReceiptResponseJson,
  strictSchemaOptions,
);
export const decodeIssueMessageMutationReceiptResponseJson =
  Schema.decodeUnknownSync(
    IssueMessageMutationReceiptResponseJson,
    strictSchemaOptions,
  );
export const encodeIssueMessageMutationReceiptResponseJson = Schema.encodeSync(
  IssueMessageMutationReceiptResponseJson,
  strictSchemaOptions,
);

const ReceiptRowBaseFields = {
  organization_id: storedText(1, 128),
  project_id: StoredIdentifier,
  user_id: storedText(1, 200),
  request_hash: Schema.String.check(
    Schema.isLengthBetween(64, 64),
    Schema.isPattern(/^[0-9a-f]{64}$/u),
  ),
  attachment_upload_ids_json: IssueMutationAttachmentUploadIdsJson,
  created_at: IsoDateTimeWithOffset,
} as const;

const expectedAttachmentUrl = (
  projectId: string,
  runId: string,
  attachmentId: string,
) => `/projects/${projectId}/runs/${runId}/attachments/${attachmentId}`;

export const IssueCreateMutationReceiptRow = strictSchema(Schema.Struct({
  client_issue_id: StoredIdentifier,
  ...ReceiptRowBaseFields,
  response_json: IssueCreateMutationReceiptResponseJson,
}).check(
  Schema.makeFilter((receipt) => {
    if (receipt.response_json.runId !== receipt.client_issue_id) {
      return "create receipt run identity does not match";
    }
    const uploadedIds = new Set(receipt.attachment_upload_ids_json);
    if (
      receipt.response_json.attachments.length !== uploadedIds.size ||
      receipt.response_json.attachments.some((attachment) =>
        !uploadedIds.has(attachment.id) ||
        attachment.url !== expectedAttachmentUrl(
          receipt.project_id,
          receipt.client_issue_id,
          attachment.id,
        )
      )
    ) {
      return "create receipt attachments do not match the committed aggregate";
    }
    return undefined;
  }),
));
export type IssueCreateMutationReceiptRow =
  typeof IssueCreateMutationReceiptRow.Type;

export const IssueUpdateMutationReceiptRow = strictSchema(Schema.Struct({
  request_id: StoredIdentifier,
  ...ReceiptRowBaseFields,
  run_id: StoredIdentifier,
  response_json: IssueUpdateMutationReceiptResponseJson,
}).check(
  Schema.makeFilter((receipt) => {
    if (receipt.response_json.runId !== receipt.run_id) {
      return "update receipt run identity does not match";
    }
    const responseAttachmentIds = new Set(
      receipt.response_json.attachments.map(({ id }) => id),
    );
    if (
      receipt.attachment_upload_ids_json.some((id) =>
        !responseAttachmentIds.has(id)
      ) ||
      receipt.response_json.attachments.some((attachment) =>
        attachment.url !== expectedAttachmentUrl(
          receipt.project_id,
          receipt.run_id,
          attachment.id,
        )
      )
    ) {
      return "update receipt attachments do not match the committed aggregate";
    }
    return undefined;
  }),
));
export type IssueUpdateMutationReceiptRow =
  typeof IssueUpdateMutationReceiptRow.Type;

export const IssueMessageMutationReceiptRow = strictSchema(Schema.Struct({
  message_id: StoredIdentifier,
  ...ReceiptRowBaseFields,
  run_id: StoredIdentifier,
  response_json: IssueMessageMutationReceiptResponseJson,
}).check(
  Schema.makeFilter((receipt) => {
    if (
      receipt.response_json.message.id !== receipt.message_id ||
      receipt.response_json.message.runId !== receipt.run_id ||
      receipt.response_json.message.createdAt !== receipt.created_at
    ) {
      return "message receipt aggregate identity does not match";
    }
    if (receipt.response_json.message.attachments.some((attachment) =>
      attachment.url !== expectedAttachmentUrl(
        receipt.project_id,
        receipt.run_id,
        attachment.id,
      )
    )) {
      return "message receipt attachments do not match the committed aggregate";
    }
    return undefined;
  }),
));
export type IssueMessageMutationReceiptRow =
  typeof IssueMessageMutationReceiptRow.Type;

export const decodeIssueCreateMutationReceiptRow = Schema.decodeUnknownSync(
  IssueCreateMutationReceiptRow,
  strictSchemaOptions,
);
export const decodeIssueUpdateMutationReceiptRow = Schema.decodeUnknownSync(
  IssueUpdateMutationReceiptRow,
  strictSchemaOptions,
);
export const decodeIssueMessageMutationReceiptRow = Schema.decodeUnknownSync(
  IssueMessageMutationReceiptRow,
  strictSchemaOptions,
);
