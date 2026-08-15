import { createProjectRealtimeTransport } from "./channel-realtime";
import type { RealtimeTransport } from "./realtime-transport";

export type ProjectRealtimeTarget = {
  id: string;
  organizationId?: string | null;
};

export type ProjectRealtimeRefreshEnvironment = {
  isVisible: () => boolean;
  setInterval: (callback: () => void, intervalMs: number) => number;
  clearInterval: (intervalId: number) => void;
  addVisibilityListener: (listener: () => void) => () => void;
  addOnlineListener: (listener: () => void) => () => void;
};

const browserEnvironment: ProjectRealtimeRefreshEnvironment = {
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

export type ProjectRealtimeRefreshOptions = {
  token: string;
  targets: readonly ProjectRealtimeTarget[];
  refresh: (projectIds: readonly string[]) => void;
  fallbackMs: number;
  pauseWhenHidden?: boolean;
  environment?: ProjectRealtimeRefreshEnvironment;
  createTransport?: (token: string, organizationId: string) => RealtimeTransport;
};

/**
 * Uses the organization socket as the primary project invalidation signal and
 * keeps one bounded fallback refresh for missed publishes or reconnect gaps.
 */
export function startProjectRealtimeRefresh({
  token,
  targets,
  refresh,
  fallbackMs,
  pauseWhenHidden = true,
  environment = browserEnvironment,
  createTransport = createProjectRealtimeTransport,
}: ProjectRealtimeRefreshOptions) {
  const projectIds = [...new Set(targets.map((target) => target.id))];
  const projectIdsByOrganization = new Map<string, Set<string>>();
  for (const target of targets) {
    if (!target.organizationId) continue;
    const ids = projectIdsByOrganization.get(target.organizationId) ?? new Set();
    ids.add(target.id);
    projectIdsByOrganization.set(target.organizationId, ids);
  }

  const transports = [...projectIdsByOrganization].map(
    ([organizationId, organizationProjectIds]) => {
      const transport = createTransport(token, organizationId);
      const unsubscribe = transport.subscribe((notification) => {
        if (
          notification.topic === "project-session" &&
          organizationProjectIds.has(notification.projectId)
        ) {
          refresh([notification.projectId]);
        } else if (
          notification.topic === "ready"
        ) {
          // Refreshing on the explicit ready frame closes any reconnect gap
          // without turning unrelated channel or Inbox traffic into session
          // reads for every project in the organization.
          refresh([...organizationProjectIds]);
        }
      });
      return { transport, unsubscribe };
    },
  );

  let intervalId: number | null = null;
  const stopInterval = () => {
    if (intervalId === null) return;
    environment.clearInterval(intervalId);
    intervalId = null;
  };
  const shouldRun = () => !pauseWhenHidden || environment.isVisible();
  const start = () => {
    stopInterval();
    if (!shouldRun()) {
      for (const { transport } of transports) transport.stop();
      return;
    }
    for (const { transport } of transports) transport.start();
    refresh(projectIds);
    intervalId = environment.setInterval(() => {
      if (shouldRun()) refresh(projectIds);
    }, fallbackMs);
  };
  const reconnect = () => {
    if (!shouldRun()) return;
    for (const { transport } of transports) {
      transport.stop();
      transport.start();
    }
    refresh(projectIds);
  };

  const removeVisibilityListener = environment.addVisibilityListener(start);
  const removeOnlineListener = environment.addOnlineListener(reconnect);
  start();
  return () => {
    stopInterval();
    removeVisibilityListener();
    removeOnlineListener();
    for (const { transport, unsubscribe } of transports) {
      unsubscribe();
      transport.stop();
    }
  };
}
