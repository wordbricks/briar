import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { ModelEffort } from "../../src/lib/agent-provider-contract";
import { agentProviders } from "../../src/lib/agent-provider";
import {
  issueTitleAbsoluteMaxLength,
  issueTitleOverLimitMessage,
} from "../../src/lib/issue-title";
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
import { WorkflowCheckpoint, WorkflowStageId } from "./run-request-contract";

export const IssueTitle = Schema.Trim.check(
  Schema.isLengthBetween(1, issueTitleAbsoluteMaxLength),
  Schema.makeFilter((title) => issueTitleOverLimitMessage(title) ?? undefined),
);

const IssueInputBaseFields = {
  title: IssueTitle,
  description: Schema.optional(
    Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(100_000))),
  ),
  priority: Schema.optional(Schema.NullOr(integerBetween(1, 4))),
  assigneeUserId: Schema.optional(Schema.NullOr(trimmedText(1, 200))),
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

export const LinearApiKeyInput = strictSchema(Schema.Struct({
  apiKey: trimmedText(10, 500),
}));

export const LinearStatesInput = strictSchema(Schema.Struct({
  apiKey: trimmedText(10, 500),
  teamIds: mutableArray(trimmedText(1, 100)).check(
    Schema.isLengthBetween(1, 50),
  ),
}));

export const LinearImportInput = strictSchema(Schema.Struct({
  apiKey: trimmedText(10, 500),
  teamIds: mutableArray(trimmedText(1, 100)).check(
    Schema.isLengthBetween(1, 50),
  ),
  statusMapping: Schema.Record(trimmedText(1, 100), trimmedText(1, 100)).check(
    Schema.makeFilter((value) =>
      Object.keys(value).length > 0 ? undefined : "statusMapping is required"
    ),
  ),
}));

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
    mutableArray(UuidString).check(Schema.isMaxLength(20)),
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

const IssueUpdateChanges = strictSchema(Schema.Struct({
  title: Schema.optional(IssueTitle),
  description: Schema.optional(
    Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(100_000))),
  ),
  priority: Schema.optional(Schema.NullOr(integerBetween(1, 4))),
}).check(
  Schema.makeFilter((changes) =>
    Object.keys(changes).length > 0
      ? undefined
      : "At least one issue change is required"
  ),
));

export const IssueUpdateProposalAction = strictSchema(Schema.Struct({
  type: Schema.Literal("request_issue_update"),
  changes: IssueUpdateChanges,
}));

export const IssueCreateProposalAction = strictSchema(Schema.Struct({
  type: Schema.Literal("request_issue_create"),
  executeAfterCreate: defaulted(Schema.Boolean, false),
  issue: strictSchema(Schema.Struct({
    title: IssueTitle,
    description: Schema.NullOr(
      Schema.Trim.check(Schema.isMaxLength(100_000)),
    ),
    priority: Schema.NullOr(integerBetween(1, 4)),
    status: Schema.Literals(["backlog", "queued"]),
  })),
}));

export const IssueAgentProposedAction = Schema.Union([
  strictSchema(Schema.Struct({
    type: Schema.Literal("request_issue_rework"),
    workflowStage: WorkflowStageId,
    reason: trimmedText(1, 4_000),
  })),
  IssueUpdateProposalAction,
  IssueCreateProposalAction,
]);

export const IssueAgentReplyCompletion = strictSchema(Schema.Struct({
  projectId: UuidString,
  workerId: trimmedText(1, 128),
  claimToken: Schema.String.check(
    Schema.isStartsWith("briar_reply_claim_"),
  ),
  body: Schema.optional(trimmedText(1, 10_000)),
  proposedAction: Schema.optional(Schema.NullOr(IssueAgentProposedAction)),
  executionProposal: Schema.optional(Schema.NullOr(
    strictSchema(Schema.Struct({
      type: Schema.Literal("request_issue_execute"),
    })),
  )),
  skillExecutionProposal: Schema.optional(Schema.NullOr(
    strictSchema(Schema.Struct({
      type: Schema.Literal("request_agent_skill_execute"),
    })),
  )),
  error: Schema.optional(trimmedText(1, 4_000)),
}).check(
  Schema.makeFilter((input) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (Boolean(input.body) === Boolean(input.error)) {
      issues.push({
        path: [],
        issue: "Provide exactly one of body or error",
      });
    }
    if (input.executionProposal && input.proposedAction) {
      issues.push({
        path: ["executionProposal"],
        issue: "Use executeAfterCreate for a create-and-execute request",
      });
    }
    if (
      input.skillExecutionProposal &&
      (input.executionProposal || input.proposedAction)
    ) {
      issues.push({
        path: ["skillExecutionProposal"],
        issue: "Agent Skill execution cannot be combined with another proposal",
      });
    }
    return issues.length > 0 ? issues : undefined;
  }),
));

export const AgentSkillExecutionProposalAcceptInput = strictSchema(
  Schema.Struct({
    workerId: Schema.String.check(
      Schema.isLengthBetween(1, 128),
      Schema.makeFilter((workerId) =>
        workerId === workerId.trim()
          ? undefined
          : "workerId cannot contain leading or trailing whitespace"
      ),
    ),
  }),
);

export const IssueAgentReplyLease = strictSchema(Schema.Struct({
  projectId: UuidString,
  workerId: trimmedText(1, 128),
  claimToken: Schema.String.check(
    Schema.isStartsWith("briar_reply_claim_"),
  ),
}));

export const IssueKeptAttachmentIds = mutableArray(UuidString).check(
  Schema.isMaxLength(50),
);

export const decodeIssueInput = decodeRequestSync(IssueInput);
export const decodeIssueUpdateInput = decodeRequestSync(IssueUpdateInput);
export const decodeExecutionPreferences = decodeRequestSync(
  ExecutionPreferences,
);
export const decodeLinearApiKeyInput = decodeRequestSync(LinearApiKeyInput);
export const decodeLinearStatesInput = decodeRequestSync(LinearStatesInput);
export const decodeLinearImportInput = decodeRequestSync(LinearImportInput);
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
export const decodeIssueAgentReplyCompletion = decodeRequestSync(
  IssueAgentReplyCompletion,
);
export const decodeAgentSkillExecutionProposalAcceptInput = decodeRequestSync(
  AgentSkillExecutionProposalAcceptInput,
);
export const decodeIssueAgentReplyLease = decodeRequestSync(
  IssueAgentReplyLease,
);
export const decodeIssueKeptAttachmentIds = decodeRequestSync(
  IssueKeptAttachmentIds,
);
