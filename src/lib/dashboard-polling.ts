export const DASHBOARD_POLL_INTERVAL_MS = 15_000;

export type DashboardPollingEnvironment = {
  isVisible: () => boolean;
  setInterval: (callback: () => void, intervalMs: number) => number;
  clearInterval: (intervalId: number) => void;
  addVisibilityListener: (listener: () => void) => () => void;
  addOnlineListener: (listener: () => void) => () => void;
};

export type DashboardRefreshReason = "poll" | "resume" | "reconnect";

const browserPollingEnvironment: DashboardPollingEnvironment = {
  isVisible: () => document.visibilityState === "visible",
  setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
  clearInterval: (intervalId) => window.clearInterval(intervalId),
  addVisibilityListener: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
  addOnlineListener: (listener) => {
    window.addEventListener("online", listener);
    return () => window.removeEventListener("online", listener);
  },
};

export function startDashboardPolling(
  refresh: (reason: DashboardRefreshReason) => void,
  environment = browserPollingEnvironment,
) {
  let intervalId: number | null = null;

  const stopInterval = () => {
    if (intervalId === null) return;
    environment.clearInterval(intervalId);
    intervalId = null;
  };

  let started = false;
  const poll = () => refresh("poll");
  const syncWithVisibility = () => {
    stopInterval();
    if (!environment.isVisible()) return;
    refresh(started ? "resume" : "poll");
    started = true;
    intervalId = environment.setInterval(poll, DASHBOARD_POLL_INTERVAL_MS);
  };

  const reconnect = () => {
    if (environment.isVisible()) refresh("reconnect");
  };

  const removeVisibilityListener =
    environment.addVisibilityListener(syncWithVisibility);
  const removeOnlineListener = environment.addOnlineListener(reconnect);
  syncWithVisibility();

  return () => {
    stopInterval();
    removeVisibilityListener();
    removeOnlineListener();
  };
}
