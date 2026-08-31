import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { agentReplyAttachmentPathsProviderSchema } from "./agent-reply-contract";
import {
  channelMessageBodySchema,
  channelMemoryCitationSchema,
  channelReplyCompletionFields,
  channelReplyCompletionSchema,
} from "./channels-contract";
import {
  OrganizationAgentContextRequests,
  OrganizationAgentContextRequestTurn,
} from "./organization-agent-context-contract";
import { dmMemoryRequestSchema } from "./dm-memory-query-contract";

const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const strict = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: strictSchemaOptions });
const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));

const ChannelAgentReplyTurnSchema = Schema.Union([
  strict(Schema.Struct({
    case: Schema.Literal("reply"),
    result: channelReplyCompletionSchema,
    attachmentPaths: mutableArray(Schema.String),
  })),
  strict(Schema.Struct({
    case: Schema.Literal("context"),
    requests: OrganizationAgentContextRequestTurn,
  })),
  strict(Schema.Struct({
    case: Schema.Literal("memory"),
    request: dmMemoryRequestSchema,
  })),
]);
export type ChannelAgentReplyTurn = typeof ChannelAgentReplyTurnSchema.Type;
export type ParsedChannelReplyAgentResult = Omit<
  Extract<ChannelAgentReplyTurn, { readonly case: "reply" }>,
  "case"
>;

const ChannelAgentReplyProviderSourceSchema = strict(Schema.Struct({
  body: Schema.NullOr(channelMessageBodySchema),
  attachments: agentReplyAttachmentPathsProviderSchema,
  ...channelReplyCompletionFields,
  contextRequests: Schema.NullOr(OrganizationAgentContextRequests),
  memoryRequests: Schema.NullOr(
    mutableArray(dmMemoryRequestSchema).check(Schema.isLengthBetween(1, 1)),
  ),
  memoryCitations: Schema.NullOr(
    mutableArray(channelMemoryCitationSchema).check(Schema.isMaxLength(10)),
  ),
}).check(
  Schema.makeFilter((output) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (output.contextRequests !== null) {
      if (output.body !== null) {
        issues.push({
          path: ["body"],
          issue: "A context lookup cannot include a channel reply",
        });
      }
      if (output.attachments.length > 0) {
        issues.push({
          path: ["attachments"],
          issue: "A context lookup cannot include attachments",
        });
      }
      for (const field of Object.keys(channelReplyCompletionFields) as Array<
        keyof typeof channelReplyCompletionFields
      >) {
        if (output[field] !== null) {
          issues.push({
            path: [field],
            issue: "A context lookup cannot include a proposal or delegation",
          });
        }
      }
      if (output.memoryRequests !== null || output.memoryCitations !== null) {
        issues.push({
          path: ["memoryRequests"],
          issue: "A context lookup cannot include memory data",
        });
      }
    } else if (output.memoryRequests !== null) {
      if (output.body !== null || output.attachments.length > 0) {
        issues.push({
          path: ["memoryRequests"],
          issue: "A memory lookup cannot include a channel reply",
        });
      }
      for (const field of Object.keys(channelReplyCompletionFields) as Array<
        keyof typeof channelReplyCompletionFields
      >) {
        if (output[field] !== null) {
          issues.push({
            path: [field],
            issue: "A memory lookup cannot include a proposal or delegation",
          });
        }
      }
      if (output.memoryCitations !== null) {
        issues.push({
          path: ["memoryCitations"],
          issue: "A memory lookup cannot cite a result before it is returned",
        });
      }
    } else if (output.body === null) {
      issues.push({
        path: ["body"],
        issue: "A completed channel reply requires a body",
      });
    }
    return issues.length > 0 ? issues : undefined;
  }),
));
type ChannelAgentReplyProviderSource =
  typeof ChannelAgentReplyProviderSourceSchema.Type;

/**
 * One codec owns both provider-visible structured output and the application
 * turn: a normal reply or an organization-context lookup, never both.
 */
export const ChannelAgentReplyProviderOutputSchema =
  ChannelAgentReplyProviderSourceSchema.pipe(
    Schema.decodeTo(
      ChannelAgentReplyTurnSchema,
      SchemaTransformation.transform<
        ChannelAgentReplyTurn,
        ChannelAgentReplyProviderSource
      >({
        decode: (output) => {
          if (output.contextRequests !== null) {
            return {
              case: "context",
              requests: { contextRequests: output.contextRequests },
            };
          }
          if (output.memoryRequests !== null) {
            return {
              case: "memory",
              request: output.memoryRequests[0]!,
            };
          }
          const {
            attachments,
            body,
            contextRequests: _contextRequests,
            memoryRequests: _memoryRequests,
            ...completion
          } = output;
          return {
            case: "reply",
            result: { body: body!, ...completion },
            attachmentPaths: attachments,
          };
        },
        encode: (turn) => {
          switch (turn.case) {
            case "context":
              return {
                body: null,
                attachments: [],
                document: null,
                issueProposal: null,
                issueBatchProposal: null,
                executionProposal: null,
                skillExecutionProposal: null,
                delegation: null,
                contextRequests: turn.requests.contextRequests,
                memoryRequests: null,
                memoryCitations: null,
              };
            case "memory":
              return {
                body: null,
                attachments: [],
                document: null,
                issueProposal: null,
                issueBatchProposal: null,
                executionProposal: null,
                skillExecutionProposal: null,
                delegation: null,
                contextRequests: null,
                memoryRequests: [turn.request],
                memoryCitations: null,
              };
            case "reply":
              return {
                body: turn.result.body,
                attachments: turn.attachmentPaths,
                document: turn.result.document,
                issueProposal: turn.result.issueProposal,
                issueBatchProposal: turn.result.issueBatchProposal,
                executionProposal: turn.result.executionProposal,
                skillExecutionProposal: turn.result.skillExecutionProposal,
                delegation: turn.result.delegation,
                contextRequests: null,
                memoryRequests: null,
                memoryCitations: turn.result.memoryCitations
                  ? [...turn.result.memoryCitations]
                  : null,
              };
          }
        },
      }),
    ),
  );
