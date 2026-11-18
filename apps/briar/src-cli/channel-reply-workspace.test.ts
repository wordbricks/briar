import { describe, expect, it } from "vitest";
import {
  channelReplyStartsWithoutWorktree,
  type ChannelReplyWorktreeGateInput,
} from "./channel-reply-workspace";

const gate = (
  overrides: Partial<ChannelReplyWorktreeGateInput> = {},
): ChannelReplyWorktreeGateInput => ({
  snapshot: { channel: { kind: "dm" }, messages: [] },
  activeSkill: null,
  skillExecutionTarget: null,
  delegation: null,
  agentMessageHop: 0,
  inboundAgentMessage: null,
  routing: null,
  ...overrides,
});

describe("channel reply worktree gate", () => {
  it("starts a plain DM conversation turn without a checkout", () => {
    expect(channelReplyStartsWithoutWorktree(gate())).toBe(true);
  });

  it("keeps the checkout for a channel that is not a DM", () => {
    expect(
      channelReplyStartsWithoutWorktree(
        gate({ snapshot: { channel: { kind: "public" }, messages: [] } }),
      ),
    ).toBe(false);
    // A snapshot without a channel object says nothing; it cannot unlock the
    // faster path.
    expect(channelReplyStartsWithoutWorktree(gate({ snapshot: {} }))).toBe(false);
  });

  it.each([
    ["a Skill turn", { activeSkill: { id: "skill" } }],
    ["an approved Skill execution", { skillExecutionTarget: { skillId: "skill" } }],
    ["a delegated turn", { delegation: { request: "look at the repo" } }],
    ["an Agent-to-Agent hop", { agentMessageHop: 1 }],
    ["an inbound Agent message", { inboundAgentMessage: { body: "hello" } }],
    ["a routing or execution turn", { routing: { action: "execute" } }],
  ])("keeps today's behaviour for %s", (_label, overrides) => {
    expect(
      channelReplyStartsWithoutWorktree(
        gate(overrides as Partial<ChannelReplyWorktreeGateInput>),
      ),
    ).toBe(false);
  });
});
