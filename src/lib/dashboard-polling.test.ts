import { describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_POLL_INTERVAL_MS,
  startDashboardPolling,
  type DashboardPollingEnvironment,
} from "./dashboard-polling";

function pollingHarness(initiallyVisible: boolean) {
  let visible = initiallyVisible;
  let intervalCallback: (() => void) | null = null;
  let visibilityListener: (() => void) | null = null;
  let onlineListener: (() => void) | null = null;
  const clearInterval = vi.fn();
  const setInterval = vi.fn((callback: () => void) => {
    intervalCallback = callback;
    return 41;
  });
  const environment: DashboardPollingEnvironment = {
    isVisible: () => visible,
    setInterval,
    clearInterval,
    addVisibilityListener: (listener) => {
      visibilityListener = listener;
      return () => {
        visibilityListener = null;
      };
    },
    addOnlineListener: (listener) => {
      onlineListener = listener;
      return () => {
        onlineListener = null;
      };
    },
  };
  return {
    environment,
    clearInterval,
    setInterval,
    tick: () => intervalCallback?.(),
    setVisible(next: boolean) {
      visible = next;
      visibilityListener?.();
    },
    reconnect: () => onlineListener?.(),
  };
}

describe("dashboard polling", () => {
  it("refreshes immediately and every 15 seconds while visible", () => {
    const refresh = vi.fn();
    const harness = pollingHarness(true);

    const stop = startDashboardPolling(refresh, harness.environment);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(harness.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      DASHBOARD_POLL_INTERVAL_MS,
    );
    harness.tick();
    expect(refresh).toHaveBeenCalledTimes(2);

    stop();
    expect(harness.clearInterval).toHaveBeenCalledWith(41);
  });

  it("pauses while hidden and refreshes as soon as the app is visible", () => {
    const refresh = vi.fn();
    const harness = pollingHarness(false);

    const stop = startDashboardPolling(refresh, harness.environment);

    expect(refresh).not.toHaveBeenCalled();
    expect(harness.setInterval).not.toHaveBeenCalled();

    harness.setVisible(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(harness.setInterval).toHaveBeenCalledTimes(1);

    harness.setVisible(false);
    expect(harness.clearInterval).toHaveBeenCalledWith(41);

    stop();
  });

  it("requests a safe snapshot after reconnecting or returning to foreground", () => {
    const refresh = vi.fn();
    const harness = pollingHarness(true);

    const stop = startDashboardPolling(refresh, harness.environment);
    expect(refresh).toHaveBeenLastCalledWith("poll");

    harness.reconnect();
    expect(refresh).toHaveBeenLastCalledWith("reconnect");
    harness.setVisible(false);
    harness.setVisible(true);
    expect(refresh).toHaveBeenLastCalledWith("resume");

    stop();
  });

  it("supports a low-frequency fallback for realtime consumers", () => {
    const refresh = vi.fn();
    const harness = pollingHarness(true);

    const stop = startDashboardPolling(
      refresh,
      harness.environment,
      60_000,
    );

    expect(harness.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      60_000,
    );
    stop();
  });
});
