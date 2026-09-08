import { normalizeChannelAcknowledgementReaction } from "../src/lib/channel-acknowledgement-reaction";
import { describe, expect, it } from "vitest";
import { ChannelAgentReplyProviderOutputSchema } from "../src/lib/channel-agent-reply-contract";
import { providerStructuredOutputContract } from "./structured-output-contract";

const reply = {
  body: "함께 이야기해요.", attachments: [], document: null,
  issueProposal: null, issueBatchProposal: null, executionProposal: null,
  skillExecutionProposal: null, delegation: null, agentMessage: null,
  contextRequests: null, memoryRequests: null, memoryCitations: null,
  memorySaveRequest: null,
};

describe.each(["codex", "claude"] as const)("%s DM reaction output", (provider) => {
  const contract = providerStructuredOutputContract(provider, ChannelAgentReplyProviderOutputSchema, normalizeChannelAcknowledgementReaction);
  it.each(["🎉", "❤️", "🙏", "😄", "👩🏽‍💻", "🇰🇷"])("carries one emoji %s with the answer", (emoji) => {
    expect(contract.decode({ ...reply, acknowledgementReaction: emoji })).toMatchObject({
      case: "reply", result: { body: reply.body, acknowledgementReaction: emoji },
    });
  });
  it.each(["", "thanks", "🎉😄", " 🎉 ", "x".repeat(100), 42, {}, null])(
    "keeps the answer when reaction selection is invalid: %j", (value) => {
      const decoded = contract.decodeJson(JSON.stringify({ ...reply, acknowledgementReaction: value }));
      expect(decoded).toMatchObject({ case: "reply", result: { body: reply.body } });
      expect(decoded.case === "reply" && decoded.result.acknowledgementReaction == null).toBe(true);
    },
  );
  it("accepts older output without a reaction", () => {
    expect(contract.decode(reply)).toMatchObject({ case: "reply", result: { body: reply.body } });
  });
});
