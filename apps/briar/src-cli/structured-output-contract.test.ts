import { describe, expect, it } from "vitest";
import { ChannelAgentReplyProviderOutputSchema } from "../src/lib/channel-agent-reply-contract";
import { IssueAgentReplyProviderOutputSchema } from "../src/lib/agent-reply-contract";
import { providerStructuredOutputContract } from "./structured-output-contract";

const providers = ["codex", "claude"] as const;

const updateOutput = {
  reply: "  I prepared the requested changes.  ",
  attachments: [" artifact.html "],
  proposedAction: {
    type: "request_issue_update",
    changes: [
      { field: "description", value: null },
      { field: "priority", value: 1 },
    ],
  },
  executionProposal: null,
  skillExecutionProposal: null,
} as const;

function expectStrictRequiredObjects(schema: unknown): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return;
  }
  const node = schema as Record<string, unknown>;
  if (
    node.type === "object" && node.properties &&
    typeof node.properties === "object" && !Array.isArray(node.properties)
  ) {
    const properties = Object.keys(node.properties);
    expect(node.additionalProperties).toBe(false);
    expect(new Set(node.required as ReadonlyArray<string>)).toEqual(
      new Set(properties),
    );
  }
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      child.forEach(expectStrictRequiredObjects);
    } else {
      expectStrictRequiredObjects(child);
    }
  }
}

describe("provider structured output contracts", () => {
  it("derives strict provider schemas and their matching issue codecs", () => {
    for (const provider of providers) {
      const contract = providerStructuredOutputContract(
        provider,
        IssueAgentReplyProviderOutputSchema,
      );

      expect(contract.jsonSchema).toMatchObject({ type: "object" });
      expect(contract.jsonSchema).not.toHaveProperty("anyOf");
      expectStrictRequiredObjects(contract.jsonSchema);
      expect(contract.decode(updateOutput)).toEqual({
        result: {
          body: "I prepared the requested changes.",
          proposedAction: {
            type: "request_issue_update",
            changes: { description: null, priority: 1 },
          },
          executionProposal: null,
          skillExecutionProposal: null,
        },
        attachmentPaths: ["artifact.html"],
      });
    }
  });

  it("rejects duplicate changes, excess authority, and excess fields", () => {
    const contract = providerStructuredOutputContract(
      "codex",
      IssueAgentReplyProviderOutputSchema,
    );
    const { decode } = contract;

    expect(() => decode({
      ...updateOutput,
      proposedAction: {
        type: "request_issue_update",
        changes: [
          { field: "priority", value: 1 },
          { field: "priority", value: 2 },
        ],
      },
    })).toThrow();
    expect(() => decode({
      ...updateOutput,
      executionProposal: { type: "request_issue_execute" },
    })).toThrow();
    expect(() => decode({ ...updateOutput, untrustedAuthority: true })).toThrow();
    expect(() => contract.decodeJson(
      `\`\`\`json\n${JSON.stringify(updateOutput)}\n\`\`\``,
    )).toThrow();
  });

  it("derives matching channel reply and context-turn codecs", () => {
    const replyOutput = {
      body: "  The project Agent will inspect authentication.  ",
      attachments: [" auth.html "],
      document: null,
      issueProposal: null,
      issueBatchProposal: null,
      executionProposal: null,
      skillExecutionProposal: null,
      delegation: {
        projectId: "11111111-1111-4111-8111-111111111111",
        agentId: "22222222-2222-4222-8222-222222222222",
        request: "  Inspect authentication.  ",
      },
      contextRequests: null,
    } as const;
    const contextOutput = {
      body: null,
      attachments: [],
      document: null,
      issueProposal: null,
      issueBatchProposal: null,
      executionProposal: null,
      skillExecutionProposal: null,
      delegation: null,
      contextRequests: [{
        resource: "issues",
        projectId: "project-1",
        detail: "summary",
        limit: 25,
        cursor: null,
      }],
    } as const;

    for (const provider of providers) {
      const contract = providerStructuredOutputContract(
        provider,
        ChannelAgentReplyProviderOutputSchema,
      );

      expect(contract.jsonSchema).toMatchObject({ type: "object" });
      expect(contract.jsonSchema).not.toHaveProperty("anyOf");
      expect(JSON.stringify(contract.jsonSchema)).toContain(
        '"pattern":"^[A-Za-z0-9][A-Za-z0-9._-]*$"',
      );
      expectStrictRequiredObjects(contract.jsonSchema);
      expect(contract.decode(replyOutput)).toEqual({
        case: "reply",
        result: {
          body: "The project Agent will inspect authentication.",
          document: null,
          issueProposal: null,
          issueBatchProposal: null,
          executionProposal: null,
          skillExecutionProposal: null,
          delegation: {
            projectId: "11111111-1111-4111-8111-111111111111",
            agentId: "22222222-2222-4222-8222-222222222222",
            request: "Inspect authentication.",
          },
        },
        attachmentPaths: ["auth.html"],
      });
      expect(contract.decode(contextOutput)).toEqual({
        case: "context",
        requests: { contextRequests: contextOutput.contextRequests },
      });
      expect(() => contract.decode({
        ...contextOutput,
        body: "Mixed reply and context lookup",
      })).toThrow();
      const { attachments: _attachments, ...missingAttachments } = replyOutput;
      expect(() => contract.decode(missingAttachments)).toThrow();
    }
  });
});
