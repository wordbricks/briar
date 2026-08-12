import { describe, expect, it } from "vitest";
import {
  channelIncomingWebhookMessageSchema,
  channelReplyCompletionSchema,
  channelWebhookInputSchema,
} from "./channels-contract";

const projectId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";

describe("channel webhook contract", () => {
  it("trims bounded names and message fields without accepting extra input", () => {
    expect(channelWebhookInputSchema.parse({ name: " Deploy notifier " }))
      .toEqual({ name: "Deploy notifier" });
    expect(channelIncomingWebhookMessageSchema.parse({
      text: " Deployment complete ",
      eventId: " deploy-42 ",
    })).toEqual({ text: "Deployment complete", eventId: "deploy-42" });
    expect(channelIncomingWebhookMessageSchema.safeParse({
      text: "Deployment complete",
      channelId: projectId,
    }).success).toBe(false);
  });
});

describe("channel reply completion contract", () => {
  it("keeps delegation null for rolling-compatible ordinary replies", () => {
    expect(channelReplyCompletionSchema.parse({
      body: "Answer",
      document: null,
      issueProposal: null,
    })).toEqual({
      body: "Answer",
      document: null,
      issueProposal: null,
      executionProposal: null,
      skillExecutionProposal: null,
      delegation: null,
    });
  });

  it("accepts only an isolated saved Skill execution marker", () => {
    expect(channelReplyCompletionSchema.parse({
      body: "I matched the release Skill and prepared an approval.",
      document: null,
      issueProposal: null,
      skillExecutionProposal: { type: "request_agent_skill_execute" },
    })).toMatchObject({
      skillExecutionProposal: { type: "request_agent_skill_execute" },
      executionProposal: null,
      delegation: null,
    });

    expect(channelReplyCompletionSchema.safeParse({
      body: "Unsafe combined proposal",
      document: null,
      issueProposal: null,
      executionProposal: { projectId, runId: projectId },
      skillExecutionProposal: { type: "request_agent_skill_execute" },
    }).success).toBe(false);
  });

  it("accepts one bounded structured Project Agent delegation", () => {
    expect(channelReplyCompletionSchema.parse({
      body: "I asked the project Agent to inspect the repository.",
      document: null,
      issueProposal: null,
      delegation: {
        projectId,
        agentId,
        request: "  Which module owns authentication?  ",
      },
    })).toMatchObject({
      delegation: {
        projectId,
        agentId,
        request: "Which module owns authentication?",
      },
    });
  });

  it("does not combine a delegation with an artifact or accept extra authority", () => {
    const combined = channelReplyCompletionSchema.safeParse({
      body: "Delegating and proposing.",
      document: {
        title: "Plan",
        markdown: "# Plan",
        projectId,
      },
      issueProposal: null,
      delegation: { projectId, agentId, request: "Inspect it." },
    });
    expect(combined.success).toBe(false);

    const expanded = channelReplyCompletionSchema.safeParse({
      body: "Delegating.",
      document: null,
      issueProposal: null,
      delegation: {
        projectId,
        agentId,
        request: "Inspect it.",
        provider: "codex",
      },
    });
    expect(expanded.success).toBe(false);
  });

  it("only lets new issue proposals request backlog creation", () => {
    const proposal = {
      body: "Create this after approval.",
      document: null,
      delegation: null,
      issueProposal: {
        projectId,
        issue: {
          title: "Safe proposal",
          description: null,
          priority: null,
          status: "backlog",
        },
      },
    };
    expect(channelReplyCompletionSchema.safeParse(proposal).success).toBe(true);
    expect(channelReplyCompletionSchema.safeParse({
      ...proposal,
      issueProposal: {
        ...proposal.issueProposal,
        issue: { ...proposal.issueProposal.issue, status: "queued" },
      },
    }).success).toBe(false);
  });
});
