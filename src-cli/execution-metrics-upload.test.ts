import { describe, expect, it, vi } from "vitest";

import {
  HttpRequestError,
  uploadExecutionMetricsWithCostCompatibility,
} from "./execution-metrics-upload";

describe("execution metrics upload compatibility", () => {
  const payload = {
    executionId: "execution-1",
    executionMetrics: { totalTokens: 15 },
    usageRecords: [{ usageKey: "usage-1" }],
    costRecords: [{ costKey: "cost-1", amountUsdTicks: 123 }],
    events: [{ sequence: 1, payload: { type: "execution.metrics" } }],
  };

  it("uses the cost-aware payload when the server accepts it", async () => {
    const send = vi.fn(async () => ({ stored: 1 }));
    const log = vi.fn();

    await expect(
      uploadExecutionMetricsWithCostCompatibility({
        payload,
        send,
        logCompatibilityFallback: log,
      }),
    ).resolves.toEqual({ stored: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(payload);
    expect(log).not.toHaveBeenCalled();
  });

  it("retries once with only costRecords removed for an older server", async () => {
    const send = vi
      .fn<(body: Record<string, unknown>) => Promise<{ stored: number }>>()
      .mockRejectedValueOnce(
        new HttpRequestError("Invalid request", 400, {
          message: "Invalid request",
          issues: [
            {
              code: "unrecognized_keys",
              keys: ["costRecords"],
              path: [],
            },
          ],
        }),
      )
      .mockResolvedValueOnce({ stored: 1 });
    const log = vi.fn();

    await expect(
      uploadExecutionMetricsWithCostCompatibility({
        payload,
        send,
        logCompatibilityFallback: log,
      }),
    ).resolves.toEqual({ stored: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toEqual(payload);
    expect(send.mock.calls[1]?.[0]).toEqual({
      executionId: payload.executionId,
      executionMetrics: payload.executionMetrics,
      usageRecords: payload.usageRecords,
      events: payload.events,
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("cost upload compatibility fallback"),
    );
  });

  it("does not retry unrelated payloads or hide a failed retry", async () => {
    const noCostError = new Error("network unavailable");
    const noCostSend = vi.fn(async () => {
      throw noCostError;
    });
    await expect(
      uploadExecutionMetricsWithCostCompatibility({
        payload: { ...payload, costRecords: [] },
        send: noCostSend,
      }),
    ).rejects.toBe(noCostError);
    expect(noCostSend).toHaveBeenCalledTimes(1);

    const retryError = new Error("legacy upload also failed");
    const retrySend = vi
      .fn<(body: Record<string, unknown>) => Promise<never>>()
      .mockRejectedValueOnce(
        new HttpRequestError("Invalid request", 400, {
          issues: [
            {
              code: "unrecognized_keys",
              keys: ["costRecords"],
              path: [],
            },
          ],
        }),
      )
      .mockRejectedValueOnce(retryError);
    await expect(
      uploadExecutionMetricsWithCostCompatibility({
        payload,
        send: retrySend,
        logCompatibilityFallback: vi.fn(),
      }),
    ).rejects.toBe(retryError);
    expect(retrySend).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["network", new TypeError("fetch failed")],
    ["forbidden", new HttpRequestError("Forbidden", 403, {})],
    ["server", new HttpRequestError("Internal server error", 500, {})],
    [
      "cost validation",
      new HttpRequestError("Invalid request", 400, {
        issues: [
          {
            code: "invalid_format",
            path: ["costRecords", 0, "observedAt"],
          },
        ],
      }),
    ],
    [
      "provider validation",
      new HttpRequestError("Invalid request", 400, {
        issues: [
          {
            code: "invalid_value",
            path: ["costRecords", 0, "agentProvider"],
          },
        ],
      }),
    ],
    [
      "another unknown key",
      new HttpRequestError("Invalid request", 400, {
        issues: [
          {
            code: "unrecognized_keys",
            keys: ["costRecords", "unexpected"],
            path: [],
          },
        ],
      }),
    ],
  ])("does not downgrade a %s failure", async (_label, failure) => {
    const send = vi.fn(async () => {
      throw failure;
    });
    await expect(
      uploadExecutionMetricsWithCostCompatibility({ payload, send }),
    ).rejects.toBe(failure);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
