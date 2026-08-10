import { describe, expect, it } from "vitest";

import {
  AGENT_EXECUTION_USD_TICKS_PER_DOLLAR,
  agentExecutionCostRecordSchema,
} from "./agent-execution-cost";

const record = {
  costKey: "grok:prompt:prompt-1:cost",
  usageKey: "grok:prompt:prompt-1:usage",
  sessionId: "session-1",
  scopeId: "prompt-1",
  turnId: "turn-1",
  agentProvider: "grok" as const,
  modelProvider: "xai",
  model: "grok-4.5",
  canonicalModel: "grok-4.5",
  modelSource: "providerReported" as const,
  source: "grok.prompt.metaCost",
  amountUsdTicks: 12_345_678,
  observedAt: "2026-08-10T03:00:00.000Z",
};

describe("agent execution cost records", () => {
  it("uses exact ten-decimal USD ticks", () => {
    expect(AGENT_EXECUTION_USD_TICKS_PER_DOLLAR).toBe(10_000_000_000);
    expect(agentExecutionCostRecordSchema.parse(record)).toEqual(record);
  });

  it("rejects fractional, negative, and unsafe tick amounts", () => {
    for (const amountUsdTicks of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        agentExecutionCostRecordSchema.safeParse({
          ...record,
          amountUsdTicks,
        }).success,
      ).toBe(false);
    }
  });

  it("allows costs without a matching token usage observation", () => {
    expect(
      agentExecutionCostRecordSchema.parse({ ...record, usageKey: null }),
    ).toMatchObject({ usageKey: null });
  });
});
