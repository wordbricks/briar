import { describe, expect, it } from "vitest";
import {
  parseClaudeUsageResponse,
  parseCodexRateLimits,
  parseGrokBilling,
} from "./provider-usage";

describe("provider usage probes", () => {
  it("marks Codex as exhausted when any rate-limit window is 100%", () => {
    const ok = parseCodexRateLimits({
      id: 2,
      result: {
        rateLimits: {
          primary: {
            usedPercent: 81,
            windowDurationMins: 10_080,
            resetsAt: 1_800_000_000,
          },
          secondary: {
            usedPercent: 37.5,
            windowDurationMins: 300,
            resetsAt: 1_800_086_400,
          },
          planType: "plus",
        },
      },
    });
    expect(ok.exhausted).toBe(false);
    expect(ok.maxUsedPercent).toBe(81);

    const exhausted = parseCodexRateLimits({
      id: 2,
      result: {
        rateLimits: {
          primary: {
            usedPercent: 100,
            windowDurationMins: 10_080,
            resetsAt: 1_800_000_000,
          },
          secondary: {
            usedPercent: 12,
            windowDurationMins: 300,
            resetsAt: 1_800_086_400,
          },
        },
      },
    });
    expect(exhausted.exhausted).toBe(true);
    expect(exhausted.maxUsedPercent).toBe(100);
  });

  it("marks Claude as exhausted from utilization windows", () => {
    const result = parseClaudeUsageResponse({
      five_hour: { utilization: 40 },
      seven_day: { utilization: 100 },
    });
    expect(result.exhausted).toBe(true);
    expect(result.maxUsedPercent).toBe(100);
  });

  it("maps Grok weekly credit usage", () => {
    const weekly = parseGrokBilling(
      {
        config: {
          creditUsagePercent: 100,
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            end: "2026-08-17T00:00:00Z",
          },
        },
      },
      "weekly",
    );
    expect(weekly?.usedPercent).toBe(100);

    const monthly = parseGrokBilling(
      {
        monthlyLimit: { val: "100" },
        used: { val: 50 },
      },
      "monthly",
    );
    expect(monthly?.usedPercent).toBe(50);
  });

  it("fails open when usage payloads are incomplete", () => {
    expect(parseCodexRateLimits({ id: 2, result: {} }).exhausted).toBe(false);
    expect(parseClaudeUsageResponse({}).exhausted).toBe(false);
    expect(parseGrokBilling({}, "weekly")).toBeNull();
  });
});
