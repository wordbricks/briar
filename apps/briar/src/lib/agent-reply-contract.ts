import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { autoHuntWorkflowStageIdPattern } from "./auto-hunt-contract";
import {
  issueTitleAbsoluteMaxLength,
  issueTitleOverLimitMessage,
} from "./issue-title";

const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const strict = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: strictSchemaOptions });
const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));
const integerBetween = (minimum: number, maximum: number) =>
  Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(minimum),
    Schema.isLessThanOrEqualTo(maximum),
  );

/**
 * Keeps bounds on the provider-encoded string while also validating the
 * normalized value after trimming. Effect's provider codec transformers can
 * therefore expose the supported bounds without making them authoritative.
 */
const providerTrimmedText = (minimum: number, maximum: number) =>
  Schema.String.check(
    Schema.isMinLength(minimum),
    Schema.isMaxLength(maximum),
  ).pipe(
    Schema.decodeTo(
      Schema.String.check(
        Schema.isMinLength(minimum),
        Schema.isMaxLength(maximum),
      ),
      SchemaTransformation.trim(),
    ),
  );

export const IssueTitle = Schema.Trim.check(
  Schema.isLengthBetween(1, issueTitleAbsoluteMaxLength),
  Schema.makeFilter((title) => issueTitleOverLimitMessage(title) ?? undefined),
);

const IssueDescription = Schema.Trim.check(Schema.isMaxLength(100_000));
const IssuePriority = Schema.NullOr(integerBetween(1, 4));

const IssueUpdateChanges = strict(Schema.Struct({
  title: Schema.optional(IssueTitle),
  description: Schema.optional(Schema.NullOr(IssueDescription)),
  priority: Schema.optional(IssuePriority),
}).check(
  Schema.makeFilter((changes) =>
    Object.keys(changes).length > 0
      ? undefined
      : "At least one issue change is required"
  ),
));
type IssueUpdateChangesValue = typeof IssueUpdateChanges.Type;
type MutableIssueUpdateChanges = {
  -readonly [Field in keyof IssueUpdateChangesValue]: IssueUpdateChangesValue[Field];
};

export const issueUpdateChangeFields = [
  "title",
  "description",
  "priority",
] as const;

const IssueUpdateProposalPayloadFields = {
  changes: IssueUpdateChanges,
} as const;

export const IssueUpdateProposalPayload = strict(Schema.Struct(
  IssueUpdateProposalPayloadFields,
));

export const IssueUpdateProposalAction = strict(Schema.Struct({
  type: Schema.Literal("request_issue_update"),
  ...IssueUpdateProposalPayloadFields,
}));

const IssueDraft = strict(Schema.Struct({
  title: IssueTitle,
  description: Schema.NullOr(IssueDescription),
  priority: IssuePriority,
}));

const IssueCreateProposalPayloadFields = {
  issue: IssueDraft,
} as const;

export const IssueCreateProposalPayload = strict(Schema.Struct(
  IssueCreateProposalPayloadFields,
));

export const IssueCreateProposalAction = strict(Schema.Struct({
  type: Schema.Literal("request_issue_create"),
  executeAfterCreate: Schema.Boolean,
  ...IssueCreateProposalPayloadFields,
}));

const WorkflowStageId = Schema.Trim.check(
  Schema.isPattern(autoHuntWorkflowStageIdPattern),
);

const IssueReworkProposalAction = strict(Schema.Struct({
  type: Schema.Literal("request_issue_rework"),
  workflowStage: WorkflowStageId,
  reason: Schema.Trim.check(Schema.isLengthBetween(1, 4_000)),
}));

const IssueExecutionProposal = strict(Schema.Struct({
  type: Schema.Literal("request_issue_execute"),
}));

const AgentSkillExecutionProposal = strict(Schema.Struct({
  type: Schema.Literal("request_agent_skill_execute"),
}));

export const IssueAgentProposedAction = Schema.Union([
  IssueReworkProposalAction,
  IssueUpdateProposalAction,
  IssueCreateProposalAction,
]);

export const IssueAgentReplyResultSchema = strict(Schema.Struct({
  body: Schema.Trim.check(Schema.isLengthBetween(1, 10_000)),
  proposedAction: Schema.NullOr(IssueAgentProposedAction),
  executionProposal: Schema.NullOr(IssueExecutionProposal),
  skillExecutionProposal: Schema.NullOr(AgentSkillExecutionProposal),
}).check(
  Schema.makeFilter((input) => {
    const issues: Array<Schema.FilterIssue> = [];
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
export type IssueAgentReplyResult = typeof IssueAgentReplyResultSchema.Type;

const ProviderIssueTitle = providerTrimmedText(
  1,
  issueTitleAbsoluteMaxLength,
).check(
  Schema.makeFilter((title) => issueTitleOverLimitMessage(title) ?? undefined),
);
const ProviderIssueDescription = providerTrimmedText(0, 100_000);

const ProviderIssueUpdateChange = Schema.Union([
  strict(Schema.Struct({
    field: Schema.Literal("title"),
    value: ProviderIssueTitle,
  })),
  strict(Schema.Struct({
    field: Schema.Literal("description"),
    value: Schema.NullOr(ProviderIssueDescription),
  })),
  strict(Schema.Struct({
    field: Schema.Literal("priority"),
    value: IssuePriority,
  })),
]);
type ProviderIssueUpdateChange = typeof ProviderIssueUpdateChange.Type;

const ProviderIssueUpdateChanges = mutableArray(
  ProviderIssueUpdateChange,
).check(
  Schema.isLengthBetween(1, issueUpdateChangeFields.length),
  Schema.makeFilter((changes) => {
    const seen = new Set<string>();
    const issues: Array<Schema.FilterIssue> = [];
    changes.forEach((change, index) => {
      if (seen.has(change.field)) {
        issues.push({
          path: [index, "field"],
          issue: `Issue change field ${change.field} is duplicated`,
        });
      }
      seen.add(change.field);
    });
    return issues.length > 0 ? issues : undefined;
  }),
).pipe(
  Schema.decodeTo(
    IssueUpdateChanges,
    SchemaTransformation.transform({
      decode: (entries) => {
        const changes: MutableIssueUpdateChanges = {};
        for (const entry of entries) {
          switch (entry.field) {
            case "title":
              changes.title = entry.value;
              break;
            case "description":
              changes.description = entry.value;
              break;
            case "priority":
              changes.priority = entry.value;
              break;
          }
        }
        return changes;
      },
      encode: (changes): ProviderIssueUpdateChange[] => {
        const entries: ProviderIssueUpdateChange[] = [];
        if (changes.title !== undefined) {
          entries.push({ field: "title", value: changes.title });
        }
        if (changes.description !== undefined) {
          entries.push({ field: "description", value: changes.description });
        }
        if (changes.priority !== undefined) {
          entries.push({ field: "priority", value: changes.priority });
        }
        return entries;
      },
    }),
  ),
);

const ProviderIssueProposedAction = Schema.Union([
  strict(Schema.Struct({
    type: Schema.Literal("request_issue_rework"),
    workflowStage: providerTrimmedText(1, 64).check(
      Schema.isPattern(autoHuntWorkflowStageIdPattern),
    ),
    reason: providerTrimmedText(1, 4_000),
  })),
  strict(Schema.Struct({
    type: Schema.Literal("request_issue_update"),
    changes: ProviderIssueUpdateChanges,
  })),
  strict(Schema.Struct({
    type: Schema.Literal("request_issue_create"),
    executeAfterCreate: Schema.Boolean,
    issue: strict(Schema.Struct({
      title: ProviderIssueTitle,
      description: Schema.NullOr(ProviderIssueDescription),
      priority: IssuePriority,
    })),
  })),
]);

export const agentReplyAttachmentPathsProviderSchema = mutableArray(
  providerTrimmedText(1, 4_096),
).check(Schema.isMaxLength(5));

const ParsedIssueAgentReply = strict(Schema.Struct({
  result: IssueAgentReplyResultSchema,
  attachmentPaths: mutableArray(Schema.String),
}));

/**
 * The encoded side is the fully-required object shown to the model. The
 * decoded side is the application result sent through the generated Worker
 * Queue client, with attachment paths split before workspace collection.
 */
export const IssueAgentReplyProviderOutputSchema = strict(Schema.Struct({
  reply: providerTrimmedText(1, 10_000),
  attachments: agentReplyAttachmentPathsProviderSchema,
  proposedAction: Schema.NullOr(ProviderIssueProposedAction),
  executionProposal: Schema.NullOr(IssueExecutionProposal),
  skillExecutionProposal: Schema.NullOr(AgentSkillExecutionProposal),
})).pipe(
  Schema.decodeTo(
    ParsedIssueAgentReply,
    SchemaTransformation.transform({
      decode: ({ reply, attachments, ...actions }) => ({
        result: { body: reply, ...actions },
        attachmentPaths: attachments,
      }),
      encode: ({ result, attachmentPaths }) => ({
        reply: result.body,
        attachments: attachmentPaths,
        proposedAction: result.proposedAction,
        executionProposal: result.executionProposal,
        skillExecutionProposal: result.skillExecutionProposal,
      }),
    }),
  ),
);
export type ParsedIssueAgentReply =
  typeof IssueAgentReplyProviderOutputSchema.Type;
