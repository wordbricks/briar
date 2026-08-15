const nullableObject: Record<string, unknown> = {
  type: ["object", "null"],
};

/**
 * Structured-output contract for issue conversation replies.
 * Variant-specific fields stay loose so Codex/Claude/AGY can enforce the
 * object without `anyOf`. Mutual exclusivity, Skill authorization, and field
 * completeness remain in the existing parser and Worker validators.
 */
export const issueReplyOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "reply",
    "proposedAction",
    "executionProposal",
    "skillExecutionProposal",
  ],
  properties: {
    reply: { type: "string", minLength: 1 },
    proposedAction: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: [
            "request_issue_update",
            "request_issue_create",
            "request_issue_rework",
          ],
        },
        changes: { type: "object" },
        executeAfterCreate: { type: "boolean" },
        issue: { type: "object" },
        workflowStage: { type: "string" },
        reason: { type: "string" },
      },
    },
    executionProposal: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["request_issue_execute"] },
      },
    },
    skillExecutionProposal: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["request_agent_skill_execute"] },
      },
    },
  },
};

/**
 * Structured-output contract for channel conversation replies. Organization
 * Agents may return `contextRequests` instead of a reply. Existing Zod
 * validators still decide which shape is accepted and whether a proposal is
 * in scope.
 */
export const channelReplyOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    body: { type: "string", minLength: 1 },
    attachments: {
      type: "array",
      maxItems: 5,
      items: { type: "string", minLength: 1 },
    },
    document: nullableObject,
    issueProposal: nullableObject,
    executionProposal: nullableObject,
    skillExecutionProposal: nullableObject,
    delegation: nullableObject,
    contextRequests: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: { type: "object" },
    },
  },
};
