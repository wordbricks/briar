import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import {
  IssueAgentReplyResultSchema,
  IssueCreateProposalAction,
  IssueCreateProposalPayload,
  IssueTitle,
  IssueUpdateProposalAction,
  IssueUpdateProposalPayload,
  issueUpdateChangeFields,
} from "../../src/lib/agent-reply-contract";
import { ModelEffort } from "../../src/lib/agent-provider-contract";
import { agentProviders } from "../../src/lib/agent-provider";
import { issueDifficulties } from "../../src/lib/issue-difficulty";
import {
  defaulted,
  defaultedWith,
  integerBetween,
  mutableArray,
  strictSchema,
  trimmedText,
  UuidString,
} from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";
import { WorkflowCheckpoint } from "./run-request-contract";

export {
  IssueCreateProposalAction,
  IssueCreateProposalPayload,
  IssueTitle,
  IssueUpdateProposalAction,
  IssueUpdateProposalPayload,
  issueUpdateChangeFields,
};

const IssueInputBaseFields = {
  title: IssueTitle,
  description: Schema.optional(
    Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(100_000))),
  ),
  priority: Schema.optional(Schema.NullOr(integerBetween(1, 4))),
  difficulty: defaulted(
    Schema.NullOr(Schema.Literals(issueDifficulties)),
    null,
  ),
  assigneeUserId: Schema.optional(Schema.NullOr(trimmedText(1, 200))),
  parentRunId: Schema.optional(Schema.NullOr(UuidString)),
  status: defaulted(Schema.Literals(["backlog", "queued"]), "queued"),
  preferredProvider: Schema.optional(
    Schema.NullOr(Schema.Literals(agentProviders)),
  ),
  preferredModel: Schema.optional(Schema.NullOr(trimmedText(1, 100))),
  preferredEffort: Schema.optional(Schema.NullOr(ModelEffort)),
  fullAuto: defaulted(Schema.Boolean, false),
  checkpoints: defaultedWith(
    mutableArray(WorkflowCheckpoint).check(Schema.isMaxLength(100)),
    () => [],
  ),
} as const;

export const IssueInput = strictSchema(Schema.Struct(IssueInputBaseFields).check(
  Schema.makeFilter((input) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (!input.preferredProvider && input.preferredModel) {
      issues.push({
        path: [],
        issue: "A provider is required for a model preference",
      });
    }
    if (!input.preferredProvider && input.preferredEffort) {
      issues.push({
        path: [],
        issue: "A provider is required for an effort preference",
      });
    }
    if (!input.preferredModel && input.preferredEffort) {
      issues.push({
        path: [],
        issue: "A model is required for an effort preference",
      });
    }
    return issues.length > 0 ? issues : undefined;
  }),
));
export type IssueInput = typeof IssueInput.Type;

export const IssueUpdateInput = strictSchema(Schema.Struct({
  title: IssueTitle,
  description: Schema.NullOr(
    Schema.Trim.check(Schema.isMaxLength(100_000)),
  ),
  priority: Schema.NullOr(integerBetween(1, 4)),
  difficulty: Schema.NullOr(Schema.Literals(issueDifficulties)),
  assigneeUserId: Schema.optional(Schema.NullOr(trimmedText(1, 200))),
}));
export type IssueUpdateInput = typeof IssueUpdateInput.Type;

export const ExecutionPreferences = strictSchema(Schema.Struct({
  provider: Schema.NullOr(Schema.Literals(agentProviders)),
  model: Schema.NullOr(trimmedText(1, 100)),
  effort: Schema.NullOr(ModelEffort),
}).check(
  Schema.makeFilter((input) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (!input.provider && (input.model || input.effort)) {
      issues.push({
        path: [],
        issue: "A provider is required for a model or effort preference",
      });
    }
    if (!input.model && input.effort) {
      issues.push({
        path: [],
        issue: "A model is required for an effort preference",
      });
    }
    return issues.length > 0 ? issues : undefined;
  }),
));

const CanonicalUuid = UuidString.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((value) => value.toLowerCase()),
    encode: SchemaGetter.transform((value) => value.toLowerCase()),
  }),
);

export const IssueMessageInput = strictSchema(Schema.Struct({
  body: trimmedText(1, 10_000),
  clientMessageId: Schema.optional(CanonicalUuid),
  parentMessageId: Schema.optional(Schema.NullOr(UuidString)),
  mentionedUserIds: Schema.optional(
    mutableArray(Schema.String.check(Schema.isLengthBetween(1, 200))).check(
      Schema.isMaxLength(50),
    ),
  ),
  mentionedAgentIds: Schema.optional(
    mutableArray(CanonicalUuid).check(Schema.isMaxLength(20)),
  ),
  agentConversationId: Schema.optional(
    Schema.NullOr(trimmedText(1, 1_000)),
  ),
}));

export const IssueMessageEditInput = strictSchema(Schema.Struct({
  body: trimmedText(1, 10_000),
  mentionedUserIds: Schema.optional(
    mutableArray(Schema.String.check(Schema.isLengthBetween(1, 200))).check(
      Schema.isMaxLength(50),
    ),
  ),
}));

export const AgentSkillExecutionProposalAcceptInput = strictSchema(
  Schema.Struct({
    workerId: Schema.optional(Schema.String.check(
      Schema.isLengthBetween(1, 128),
      Schema.makeFilter((workerId) =>
        workerId === workerId.trim()
          ? undefined
          : "workerId cannot contain leading or trailing whitespace"
      ),
    )),
  }),
);

export const IssueKeptAttachmentIds = mutableArray(UuidString).check(
  Schema.isMaxLength(50),
);

export const decodeIssueInput = decodeRequestSync(IssueInput);
export const decodeIssueUpdateInput = decodeRequestSync(IssueUpdateInput);
export const decodeExecutionPreferences = decodeRequestSync(
  ExecutionPreferences,
);
export const decodeIssueMessageInput = decodeRequestSync(IssueMessageInput);
export const decodeIssueMessageEditInput = decodeRequestSync(
  IssueMessageEditInput,
);
export const decodeIssueUpdateProposalAction = decodeRequestSync(
  IssueUpdateProposalAction,
);
export const decodeIssueCreateProposalAction = decodeRequestSync(
  IssueCreateProposalAction,
);
export const decodeIssueAgentReplyResult = decodeRequestSync(
  IssueAgentReplyResultSchema,
);
export const decodeAgentSkillExecutionProposalAcceptInput = decodeRequestSync(
  AgentSkillExecutionProposalAcceptInput,
);
export const decodeIssueKeptAttachmentIds = decodeRequestSync(
  IssueKeptAttachmentIds,
);
