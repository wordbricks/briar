/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startTeamAgentSchedulePolling,
  type TeamAgentScheduleRunnerDependencies,
} from "./team-agent-schedule-runner";

type NativeTick = {
  current: (() => void) | null;
};

const dependencies = () => ({
  claim: vi.fn(async () => null),
  complete: vi.fn(),
  renew: vi.fn(),
  execute: vi.fn(),
  log: vi.fn(),
  listenForNativePoll: vi.fn(),
}) satisfies TeamAgentScheduleRunnerDependencies;

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("project Agent schedule polling", () => {
  it("uses the native tick while the desktop WebView is backgrounded", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const nativeTick: NativeTick = { current: null };
    const unlisten = vi.fn();
    const current = dependencies();
    current.listenForNativePoll.mockImplementation(async (callback) => {
      nativeTick.current = callback;
      return unlisten;
    });

    const stop = startTeamAgentSchedulePolling(
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
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
