import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
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
      agentMessage: null,
      contextRequests: null,
      memoryRequests: null,
      memoryCitations: null,
      memorySaveRequest: null,
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
      agentMessage: null,
      memoryRequests: null,
      memoryCitations: null,
      memorySaveRequest: null,
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
          agentMessage: null,
          memoryCitations: null,
          memorySaveRequest: null,
        },
        attachmentPaths: ["auth.html"],
      });
      /*
        The Agent message rides the same reply turn as delegation and is
        exclusive from it, so the codec has to carry one without the other.
      */
      expect(contract.decode({
        ...replyOutput,
        delegation: null,
        agentMessage: {
          agentId: "22222222-2222-4222-8222-222222222222",
          body: "  Please check the ticker now.  ",
        },
      })).toMatchObject({
        case: "reply",
        result: {
          delegation: null,
          agentMessage: {
            agentId: "22222222-2222-4222-8222-222222222222",
            body: "Please check the ticker now.",
          },
        },
      });
      expect(() => contract.decode({
        ...replyOutput,
        agentMessage: {
          agentId: "22222222-2222-4222-8222-222222222222",
          body: "Check the ticker.",
        },
      })).toThrow();
      expect(() => contract.decode({
        ...contextOutput,
        agentMessage: {
          agentId: "22222222-2222-4222-8222-222222222222",
          body: "Check the ticker.",
        },
      })).toThrow();
      expect(contract.decode(contextOutput)).toEqual({
        case: "context",
        requests: { contextRequests: contextOutput.contextRequests },
      });
      expect(contract.decode({
        ...contextOutput,
        contextRequests: null,
        memoryRequests: [{ operation: "search", queries: ["metric units"] }],
      })).toEqual({
        case: "memory",
        request: { operation: "search", queries: ["metric units"] },
      });
      expect(() => contract.decode({
        ...contextOutput,
        body: "Mixed reply and context lookup",
      })).toThrow();
      const { attachments: _attachments, ...missingAttachments } = replyOutput;
      expect(() => contract.decode(missingAttachments)).toThrow();
    }
  });

  it("encodes a lookup turn with no Agent message", () => {
    /*
      A lookup turn is replayed to the provider through the same codec. An
      Agent message reappearing there would send a message the Agent never
      chose, so both lookup cases must encode it as null.
    */
    const encode = Schema.encodeSync(ChannelAgentReplyProviderOutputSchema);

    expect(encode({
      case: "context",
      requests: {
        contextRequests: [{
          resource: "issues",
          projectId: "project-1",
          detail: "summary",
          limit: 25,
          cursor: null,
        }],
      },
    })).toMatchObject({ agentMessage: null, delegation: null, body: null });
    expect(encode({
      case: "memory",
      request: { operation: "search", queries: ["metric units"] },
    })).toMatchObject({ agentMessage: null, delegation: null, body: null });
  });
});

describe("Claude Code provider schemas", () => {
  const replyOutput = {
    body: "The project Agent will inspect authentication.",
    attachments: [],
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
    agentMessage: null,
    contextRequests: null,
    memoryRequests: null,
    memoryCitations: null,
    memorySaveRequest: null,
  } as const;

  it("drops format while the codec keeps enforcing it", () => {
    const contract = providerStructuredOutputContract(
      "claude",
      ChannelAgentReplyProviderOutputSchema,
    );
    const serialized = JSON.stringify(contract.jsonSchema);

    expect(serialized).not.toContain('"format"');
    expect(serialized).toContain('"pattern"');
    expect(contract.decode(replyOutput)).toMatchObject({ case: "reply" });
    expect(() => contract.decode({
      ...replyOutput,
      delegation: { ...replyOutput.delegation, projectId: "not-a-uuid" },
    })).toThrow();
  });

  it("removes the keyword without touching a member named format", () => {
    const contract = providerStructuredOutputContract(
      "claude",
      Schema.Struct({ format: Schema.String.check(Schema.isUUID()) }),
    );

    expect(contract.jsonSchema).toHaveProperty(
      ["properties", "format", "type"],
      "string",
    );
    expect(JSON.stringify(contract.jsonSchema)).not.toContain('"format":"uuid"');
  });

  it("leaves other providers on their own adapter output", () => {
    const contract = providerStructuredOutputContract(
      "codex",
      ChannelAgentReplyProviderOutputSchema,
    );

    expect(JSON.stringify(contract.jsonSchema)).toContain('"format":"uuid"');
  });
});
