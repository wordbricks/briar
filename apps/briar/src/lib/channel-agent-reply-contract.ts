import { channelAcknowledgementReactionSchema } from "./channel-acknowledgement-reaction";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { agentReplyAttachmentPathsProviderSchema } from "./agent-reply-contract";
import {
  channelMessageBodySchema,
  channelMemoryCitationSchema,
  channelMemorySaveRequestSchema,
  channelReplyCompletionFields,
  channelReplyCompletionSchema,
} from "./channels-contract";
import {
  WorkspaceAgentContextRequests,
  WorkspaceAgentContextRequestTurn,
} from "./workspace-agent-context-contract";
import { dmMemoryRequestSchema } from "./dm-memory-query-contract";

const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const strict = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: strictSchemaOptions });
const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));

/**
 * A DM conversation turn starts without a repository checkout: a channel reply
 * never changes code, so the checkout is only worth its fetch when the Agent
 * says it actually has to read the project. This is that request, consumed on
 * the CLI exactly like a memory lookup and never sent to the server.
 */
export const channelRepositoryRequestSchema = strict(Schema.Struct({
  reason: Schema.String.check(Schema.isLengthBetween(1, 2_000)),
}));

const ChannelAgentReplyTurnSchema = Schema.Union([
  strict(Schema.Struct({
    case: Schema.Literal("reply"),
    result: channelReplyCompletionSchema,
    attachmentPaths: mutableArray(Schema.String),
  })),
  strict(Schema.Struct({
    case: Schema.Literal("context"),
    requests: WorkspaceAgentContextRequestTurn,
  })),
  strict(Schema.Struct({
    case: Schema.Literal("memory"),
    request: dmMemoryRequestSchema,
  })),
  strict(Schema.Struct({
    case: Schema.Literal("repository"),
    request: channelRepositoryRequestSchema,
  })),
]);
export type ChannelAgentReplyTurn = typeof ChannelAgentReplyTurnSchema.Type;
export type ParsedChannelReplyAgentResult = Omit<
  Extract<ChannelAgentReplyTurn, { readonly case: "reply" }>,
  "case"
>;

const ChannelAgentReplyProviderSourceSchema = strict(Schema.Struct({
  acknowledgementReaction: Schema.optional(channelAcknowledgementReactionSchema),
  body: Schema.NullOr(channelMessageBodySchema),
  attachments: agentReplyAttachmentPathsProviderSchema,
  ...channelReplyCompletionFields,
  contextRequests: Schema.NullOr(WorkspaceAgentContextRequests),
  memoryRequests: Schema.NullOr(
    mutableArray(dmMemoryRequestSchema).check(Schema.isLengthBetween(1, 1)),
  ),
  memoryCitations: Schema.NullOr(
    mutableArray(channelMemoryCitationSchema).check(Schema.isMaxLength(10)),
  ),
  memorySaveRequest: Schema.NullOr(channelMemorySaveRequestSchema),
  // Optional, not required: only a turn that may check the repository out is
  // told this member exists, and every other reply keeps its current shape.
  repositoryRequest: Schema.optional(
    Schema.NullOr(channelRepositoryRequestSchema),
  ),
}).check(
  Schema.makeFilter((output) => {
    const issues: Array<Schema.FilterIssue> = [];
    // Absent and explicitly null are the same statement: no repository is
    // being asked for on this turn.
    const repositoryRequest = output.repositoryRequest ?? null;
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
            issue:
              "A context lookup cannot include a proposal, delegation or Agent message",
          });
        }
      }
      if (
        output.memoryRequests !== null || output.memoryCitations !== null ||
        output.memorySaveRequest !== null
      ) {
        issues.push({
          path: ["memoryRequests"],
          issue: "A context lookup cannot include memory data",
        });
      }
      if (repositoryRequest !== null) {
        issues.push({
          path: ["repositoryRequest"],
          issue: "A context lookup cannot also request the repository",
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
            issue:
              "A memory lookup cannot include a proposal, delegation or Agent message",
          });
        }
      }
      if (output.memoryCitations !== null || output.memorySaveRequest !== null) {
        issues.push({
          path: ["memoryCitations"],
          issue: "A memory lookup cannot cite a result before it is returned",
        });
      }
      if (repositoryRequest !== null) {
        issues.push({
          path: ["repositoryRequest"],
          issue: "A memory lookup cannot also request the repository",
        });
      }
    } else if (repositoryRequest !== null) {
      if (output.body !== null || output.attachments.length > 0) {
        issues.push({
          path: ["repositoryRequest"],
          issue: "A repository request cannot include a channel reply",
        });
      }
      for (const field of Object.keys(channelReplyCompletionFields) as Array<
        keyof typeof channelReplyCompletionFields
      >) {
        if (output[field] !== null) {
          issues.push({
            path: [field],
            issue:
              "A repository request cannot include a proposal, delegation or Agent message",
          });
        }
      }
      if (output.memoryCitations !== null || output.memorySaveRequest !== null) {
        issues.push({
          path: ["memoryCitations"],
          issue: "A repository request cannot carry memory data",
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
 * turn: a normal reply or a workspace-context lookup, never both.
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
          if (output.repositoryRequest) {
            return {
              case: "repository",
              request: output.repositoryRequest,
            };
          }
          const {
            attachments,
            body,
            contextRequests: _contextRequests,
            memoryRequests: _memoryRequests,
            repositoryRequest: _repositoryRequest,
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
                agentMessage: null,
                contextRequests: turn.requests.contextRequests,
                memoryRequests: null,
                memoryCitations: null,
                memorySaveRequest: null,
                repositoryRequest: null,
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
                agentMessage: null,
                contextRequests: null,
                memoryRequests: [turn.request],
                memoryCitations: null,
                memorySaveRequest: null,
                repositoryRequest: null,
              };
            case "repository":
              return {
                body: null,
                attachments: [],
                document: null,
                issueProposal: null,
                issueBatchProposal: null,
                executionProposal: null,
                skillExecutionProposal: null,
                delegation: null,
                agentMessage: null,
                contextRequests: null,
                memoryRequests: null,
                memoryCitations: null,
                memorySaveRequest: null,
                repositoryRequest: turn.request,
              };
            case "reply":
              return {
                body: turn.result.body,
                ...(turn.result.acknowledgementReaction !== undefined
                  ? { acknowledgementReaction: turn.result.acknowledgementReaction }
                  : {}),
                attachments: turn.attachmentPaths,
                document: turn.result.document,
                issueProposal: turn.result.issueProposal,
                issueBatchProposal: turn.result.issueBatchProposal,
                executionProposal: turn.result.executionProposal,
                skillExecutionProposal: turn.result.skillExecutionProposal,
                delegation: turn.result.delegation,
                agentMessage: turn.result.agentMessage,
                contextRequests: null,
                memoryRequests: null,
                memoryCitations: turn.result.memoryCitations
                  ? [...turn.result.memoryCitations]
                  : null,
                memorySaveRequest: turn.result.memorySaveRequest ?? null,
                repositoryRequest: null,
              };
          }
        },
      }),
    ),
  );
