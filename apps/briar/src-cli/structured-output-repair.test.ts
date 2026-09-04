import { describe, expect, it } from "vitest";
import { ChannelAgentReplyProviderOutputSchema } from "../src/lib/channel-agent-reply-contract";
import { providerStructuredOutputContract } from "./structured-output-contract";
import {
  nextStructuredOutputRepairPrompt,
  ProviderOutputDecodeError,
  repairableDecoder,
  structuredOutputRepairLimit,
  structuredOutputRepairPrompt,
} from "./structured-output-repair";

const projectId = "11111111-1111-4111-8111-111111111111";

/** The exact drift observed in production: a server-owned member echoed back. */
const proposalWithStatus = JSON.stringify({
  body: "I prepared the issue for approval.",
  attachments: [],
  document: null,
  issueProposal: {
    projectId,
    executeAfterCreate: false,
    issue: {
      title: "Fix the reply contract",
      description: "Replies fail before they reach the channel.",
      priority: 2,
      status: "backlog",
    },
  },
  issueBatchProposal: null,
  executionProposal: null,
  skillExecutionProposal: null,
  delegation: null,
  contextRequests: null,
  memoryRequests: null,
  memoryCitations: null,
  memorySaveRequest: null,
});

describe("structured output repair", () => {
  it("marks a contract decode failure and keeps the original error", () => {
    const contract = providerStructuredOutputContract(
      "claude",
      ChannelAgentReplyProviderOutputSchema,
    );
    const decode = repairableDecoder(contract.decodeJson);

    let raised: unknown;
    try {
      contract.decodeJson(proposalWithStatus);
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(Error);
    expect((raised as Error).message).toMatch(/excess property/iu);

    expect(() => decode(proposalWithStatus)).toThrow(ProviderOutputDecodeError);
    try {
      decode(proposalWithStatus);
      expect.unreachable("the excess member must fail the decode");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderOutputDecodeError);
      const failure = (error as ProviderOutputDecodeError).failure;
      expect((failure as Error).message).toBe((raised as Error).message);
    }
  });

  it("passes a valid result through untouched", () => {
    const contract = providerStructuredOutputContract(
      "claude",
      ChannelAgentReplyProviderOutputSchema,
    );
    const decode = repairableDecoder(contract.decodeJson);
    const accepted = proposalWithStatus.replace(',"status":"backlog"', "");

    expect(decode(accepted)).toMatchObject({ case: "reply" });
  });

  it("tells the model which member to drop", () => {
    const contract = providerStructuredOutputContract(
      "claude",
      ChannelAgentReplyProviderOutputSchema,
    );
    const decode = repairableDecoder(contract.decodeJson);

    let prompt = "";
    try {
      decode(proposalWithStatus);
    } catch (error) {
      prompt = structuredOutputRepairPrompt(error);
    }

    expect(prompt).toContain('["issueProposal"]["issue"]["status"]');
    expect(prompt).toMatch(/excess property/iu);
    expect(prompt).toContain("never copy a server-owned member");
    expect(structuredOutputRepairLimit).toBeGreaterThan(0);
  });

  it("bounds a contract error that reports every failed path", () => {
    const prompt = structuredOutputRepairPrompt(
      new Error("x".repeat(20_000)),
    );

    expect(prompt.length).toBeLessThan(6_000);
    expect(prompt).toContain("…");
  });

  it("repairs a decode failure until the budget is spent", () => {
    const contract = providerStructuredOutputContract(
      "claude",
      ChannelAgentReplyProviderOutputSchema,
    );
    const decode = repairableDecoder(contract.decodeJson);
    let error: unknown;
    try {
      decode(proposalWithStatus);
    } catch (raised) {
      error = raised;
    }

    const continued = nextStructuredOutputRepairPrompt({
      error,
      rounds: 0,
      basePrompt: "REPLY PROMPT",
      conversationId: "claude:conversation-1",
    });
    expect(continued).not.toContain("REPLY PROMPT");

    // A provider that reports no conversation cannot see the rejected answer.
    const restarted = nextStructuredOutputRepairPrompt({
      error,
      rounds: structuredOutputRepairLimit - 1,
      basePrompt: "REPLY PROMPT",
      conversationId: null,
    });
    expect(restarted).toContain("REPLY PROMPT");

    // An exhausted budget still fails the reply with the contract's own error.
    expect(() =>
      nextStructuredOutputRepairPrompt({
        error,
        rounds: structuredOutputRepairLimit,
        basePrompt: "REPLY PROMPT",
        conversationId: "claude:conversation-1",
      })
    ).toThrow(/excess property/iu);
  });

  it("never repairs a rejection that is not a contract decode failure", () => {
    // An unauthorized Skill execution proposal must stay terminal.
    const policy = new Error("Agent Skill execution target is not authorized");

    expect(() =>
      nextStructuredOutputRepairPrompt({
        error: policy,
        rounds: 0,
        basePrompt: "REPLY PROMPT",
        conversationId: "claude:conversation-1",
      })
    ).toThrow(policy);
  });
});
