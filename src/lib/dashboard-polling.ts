export const DASHBOARD_POLL_INTERVAL_MS = 15_000;

export type DashboardPollingEnvironment = {
  isVisible: () => boolean;
  setInterval: (callback: () => void, intervalMs: number) => number;
  clearInterval: (intervalId: number) => void;
  addVisibilityListener: (listener: () => void) => () => void;
};

const browserPollingEnvironment: DashboardPollingEnvironment = {
  isVisible: () => document.visibilityState === "visible",
  setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
  clearInterval: (intervalId) => window.clearInterval(intervalId),
  addVisibilityListener: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

export function startDashboardPolling(
  refresh: () => void,
  environment = browserPollingEnvironment,
) {
  let intervalId: number | null = null;

  const stopInterval = () => {
    if (intervalId === null) return;
    environment.clearInterval(intervalId);
    intervalId = null;
  };

  const syncWithVisibility = () => {
    stopInterval();
    if (!environment.isVisible()) return;
    refresh();
    intervalId = environment.setInterval(refresh, DASHBOARD_POLL_INTERVAL_MS);
  };

  const removeVisibilityListener =
    environment.addVisibilityListener(syncWithVisibility);
  syncWithVisibility();

  return () => {
    stopInterval();
    removeVisibilityListener();
  };
}
