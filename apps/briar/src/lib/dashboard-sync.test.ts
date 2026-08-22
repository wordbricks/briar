import { describe, expect, it } from "vitest";
import { demoDashboard } from "./demo-data";
import { mergeDashboardDelta } from "./dashboard-sync";
import type { DashboardDeltaPayload } from "../types";

const delta = (
  overrides: Partial<DashboardDeltaPayload> = {},
): DashboardDeltaPayload => ({
  cursor: 2,
  hasMore: false,
  runs: [],
  deletedRunIds: [],
  workers: demoDashboard.workers ?? [],
  organizationProviders: demoDashboard.organizationProviders ?? [],
  generatedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

describe("dashboard delta merge", () => {
  it("keeps the exact dashboard reference when a sync has no changes", () => {
    const result = mergeDashboardDelta(demoDashboard, delta());

    expect(result.changed).toBe(false);
    expect(result.dashboard).toBe(demoDashboard);
  });

  it("updates one run while preserving every unchanged run reference", () => {
    const target = demoDashboard.runs[0];
    const untouched = demoDashboard.runs[1];
    const result = mergeDashboardDelta(
      demoDashboard,
      delta({
        runs: [{
          ...target,
          detail: "Only this issue changed",
          updatedAt: "2026-08-01T00:00:00.000Z",
        }],
      }),
    );

    expect(result.changed).toBe(true);
    expect(result.dashboard.runs.find((run) => run.id === target.id)).not.toBe(target);
    expect(result.dashboard.runs.find((run) => run.id === untouched.id)).toBe(untouched);
  });

  it("applies run tombstones without rebuilding surviving entities", () => {
    const removed = demoDashboard.runs[0];
    const survivor = demoDashboard.runs[1];
    const result = mergeDashboardDelta(
      demoDashboard,
      delta({ deletedRunIds: [removed.id] }),
    );

    expect(result.dashboard.runs.some((run) => run.id === removed.id)).toBe(false);
    expect(result.dashboard.runs.find((run) => run.id === survivor.id)).toBe(survivor);
  });

  it("replaces conversation notifications only when that projection changes", () => {
    const notification = {
      id: "notification-1",
      runId: demoDashboard.runs[0].id,
      runTitle: demoDashboard.runs[0].title,
      rootMessageId: "message-1",
      body: "A reply arrived",
      author: { id: null, name: "Briar", image: null, provider: "codex" as const },
      reason: "thread_reply" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const result = mergeDashboardDelta(
      demoDashboard,
      delta({ conversationNotifications: [notification] }),
    );

    expect(result.dashboard.conversationNotifications).toEqual([notification]);
    expect(result.dashboard.runs[0]).toBe(demoDashboard.runs[0]);
  });

  it("replaces channel notifications from the organization projection", () => {
    const notification = {
      id: "channel-notification-1",
      channelId: "channel-1",
      channelName: "product",
      rootMessageId: "channel-root-1",
      body: "A channel reply arrived",
      author: { id: "member", name: "Sam", image: null, provider: null },
      reason: "thread_reply" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const result = mergeDashboardDelta(
      demoDashboard,
      delta({ channelNotifications: [notification] }),
    );

    expect(result.dashboard.channelNotifications).toEqual([notification]);
    expect(result.dashboard.runs[0]).toBe(demoDashboard.runs[0]);
  });
});
