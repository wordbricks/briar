/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentActivityTransport,
  reapExpiredAgentActivity,
  updateAgentActivity,
  useAgentActivity,
} from "./use-agent-activity";

type TestFrame = {
  replyJobId: string;
  attempt: number;
  sequence: number;
  activity: { headline: string } | null;
  expiresAt: string;
};

const frame = (
  sequence: number,
  input: Partial<TestFrame> = {},
): TestFrame => ({
  replyJobId: "reply-a",
  attempt: 1,
  sequence,
  activity: { headline: `activity-${sequence}` },
  expiresAt: "2026-08-26T00:00:30.000Z",
  ...input,
});

class FakeTransport implements AgentActivityTransport<TestFrame> {
  listener: ((frame: TestFrame) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  unsubscribe = vi.fn();

  subscribe(listener: (frame: TestFrame) => void) {
    this.listener = listener;
    return this.unsubscribe;
  }

  emit(value: TestFrame) {
    this.listener?.(value);
  }
}

function Probe({ transport }: { transport: FakeTransport | null }) {
  const activity = useAgentActivity(transport);
  const current = activity.get("reply-a");
  return (
    <output
      data-size={activity.size}
      data-attempt={current?.attempt ?? ""}
      data-sequence={current?.sequence ?? ""}
      data-activity={current?.activity?.headline ?? ""}
    />
  );
}

describe("agent activity state", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps attempt/sequence high-water tombstones and reaps expiration", () => {
    const initial = new Map<string, TestFrame>();
    const now = Date.parse("2026-08-26T00:00:00Z");
    const active = updateAgentActivity(initial, frame(2), now);
    expect(updateAgentActivity(active, frame(1), now)).toBe(active);

    const tombstone = updateAgentActivity(active, frame(Number.MAX_SAFE_INTEGER, {
      activity: null,
    }), now);
    expect(updateAgentActivity(tombstone, frame(3), now)).toBe(tombstone);

    const nextAttempt = updateAgentActivity(tombstone, frame(1, {
      attempt: 2,
    }), now);
    expect(nextAttempt.get("reply-a")).toMatchObject({ attempt: 2, sequence: 1 });
    expect(reapExpiredAgentActivity(
      nextAttempt,
      Date.parse("2026-08-26T00:00:30Z"),
    ).size).toBe(0);
  });

  it("starts by visibility, expires frames, and cleans up its listener and timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const transport = new FakeTransport();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => root.render(<Probe transport={transport} />));
    expect(transport.start).toHaveBeenCalledOnce();

    await act(async () => transport.emit(frame(1, {
      expiresAt: "2026-08-26T00:00:04.000Z",
    })));
    expect(container.querySelector("output")?.dataset).toMatchObject({
      size: "1",
      sequence: "1",
    });

    await act(async () => vi.advanceTimersByTime(5_000));
    expect(container.querySelector("output")?.dataset.size).toBe("0");

    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(transport.stop).toHaveBeenCalledOnce();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(transport.start).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    expect(transport.unsubscribe).toHaveBeenCalledOnce();
    expect(transport.stop).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
