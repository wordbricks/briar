/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_AGENT_SCHEDULE_POLL_EVENT,
  startProjectAgentSchedulePolling,
  type ProjectAgentScheduleRunnerDependencies,
} from "./project-agent-schedule-runner";

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

const dependencies = (): ProjectAgentScheduleRunnerDependencies => ({
  claim: vi.fn(async () => null),
  complete: vi.fn(),
  renew: vi.fn(),
  execute: vi.fn(),
  log: vi.fn(),
});

afterEach(() => {
  delete (
    window as typeof window & {
      __TAURI_INTERNALS__?: unknown;
    }
  ).__TAURI_INTERNALS__;
  eventMocks.listen.mockReset();
  eventMocks.unlisten.mockReset();
});

describe("project agent schedule polling", () => {
  it("polls from the native timer while the desktop WebView is backgrounded", async () => {
    (
      window as typeof window & {
        __TAURI_INTERNALS__?: unknown;
      }
    ).__TAURI_INTERNALS__ = {};
    let nativeTick: unknown = null;
    eventMocks.listen.mockImplementation(async (eventName, callback) => {
      expect(eventName).toBe(PROJECT_AGENT_SCHEDULE_POLL_EVENT);
      nativeTick = callback as () => void;
      return eventMocks.unlisten;
    });
    const current = dependencies();
    const stop = startProjectAgentSchedulePolling(
      current,
      ["project-1"],
      60_000,
    );

    await vi.waitFor(() => expect(current.claim).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(nativeTick).not.toBeNull());
    (nativeTick as () => void)();
    await vi.waitFor(() => expect(current.claim).toHaveBeenCalledTimes(2));

    stop();
    expect(eventMocks.unlisten).toHaveBeenCalledOnce();
  });
});
