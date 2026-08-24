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

type NativeTick = {
  current: (() => void) | null;
};

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
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  eventMocks.listen.mockReset();
  eventMocks.unlisten.mockReset();
});

describe("project agent schedule polling", () => {
  it("polls from the native timer while the desktop WebView is backgrounded", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const nativeTick: NativeTick = { current: null };
    eventMocks.listen.mockImplementation(async (eventName, callback) => {
      expect(eventName).toBe(PROJECT_AGENT_SCHEDULE_POLL_EVENT);
      nativeTick.current = () => callback();
      return eventMocks.unlisten;
    });
    const current = dependencies();
    const stop = startProjectAgentSchedulePolling(
      current,
      ["project-1"],
      60_000,
    );

    await vi.waitFor(() => expect(current.claim).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(nativeTick.current).not.toBeNull());
    const triggerNativeTick = nativeTick.current;
    if (triggerNativeTick === null) {
      throw new Error("native schedule listener was not registered");
    }
    triggerNativeTick();
    await vi.waitFor(() => expect(current.claim).toHaveBeenCalledTimes(2));

    stop();
    expect(eventMocks.unlisten).toHaveBeenCalledOnce();
  });
});
