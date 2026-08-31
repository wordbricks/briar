import { describe, expect, it } from "vitest";
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
    const { decode } = providerStructuredOutputContract(
      "codex",
      IssueAgentReplyProviderOutputSchema,
    );

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
  });
});
