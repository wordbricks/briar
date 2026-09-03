import { describe, expect, it, vi } from "vitest";
import {
  startTeamRealtimeRefresh,
  type TeamRealtimeRefreshEnvironment,
} from "./team-realtime-refresh";
import type {
  RealtimeNotification,
  RealtimeTransport,
} from "./realtime-transport";

function transport() {
  let listener: ((notification: RealtimeNotification) => void) | null = null;
  return {
    value: {
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: vi.fn((next) => {
        listener = next;
        return vi.fn();
      }),
    } satisfies RealtimeTransport,
    publish(notification: RealtimeNotification) {
      listener?.(notification);
    },
  };
}

function environment() {
  let visible = true;
  let visibilityListener: (() => void) | null = null;
  let onlineListener: (() => void) | null = null;
  let interval: (() => void) | null = null;
  return {
    value: {
      isVisible: () => visible,
      setInterval: vi.fn((callback) => {
        interval = callback;
        return 1;
      }),
      clearInterval: vi.fn(),
      addVisibilityListener: vi.fn((listener) => {
        visibilityListener = listener;
        return vi.fn();
      }),
      addOnlineListener: vi.fn((listener) => {
        onlineListener = listener;
        return vi.fn();
      }),
    } satisfies TeamRealtimeRefreshEnvironment,
    setVisible(next: boolean) {
      visible = next;
      visibilityListener?.();
    },
    fallback() {
      interval?.();
    },
    reconnect() {
      onlineListener?.();
    },
  };
}

describe("project realtime refresh", () => {
  it("refreshes only the changed project and keeps a bounded fallback", () => {
    const currentTransport = transport();
    const currentEnvironment = environment();
    const refresh = vi.fn();
    const stop = startTeamRealtimeRefresh({
      token: "token",
      targets: [
        { id: "project-a", organizationId: "organization-1" },
        { id: "project-b", organizationId: "organization-1" },
      ],
      refresh,
      fallbackMs: 300_000,
      environment: currentEnvironment.value,
      createTransport: () => currentTransport.value,
    });

    expect(refresh).toHaveBeenCalledWith(["project-a", "project-b"]);
    currentTransport.publish({
      topic: "project-session",
      projectId: "project-b",
      version: 7,
    });
    expect(refresh).toHaveBeenLastCalledWith(["project-b"]);
    currentTransport.publish({ topic: "ready" });
    expect(refresh).toHaveBeenLastCalledWith(["project-a", "project-b"]);
    currentEnvironment.fallback();
    expect(refresh).toHaveBeenLastCalledWith(["project-a", "project-b"]);

    stop();
    expect(currentTransport.value.stop).toHaveBeenCalled();
  });

  it("stops foreground refreshes while hidden and catches up on resume", () => {
    const currentTransport = transport();
    const currentEnvironment = environment();
    const refresh = vi.fn();
    startTeamRealtimeRefresh({
      token: "token",
      targets: [{ id: "project-a", organizationId: "organization-1" }],
      refresh,
      fallbackMs: 300_000,
      environment: currentEnvironment.value,
      createTransport: () => currentTransport.value,
    });
    refresh.mockClear();

    currentEnvironment.setVisible(false);
    currentEnvironment.fallback();
    expect(refresh).not.toHaveBeenCalled();
    currentEnvironment.setVisible(true);
    expect(refresh).toHaveBeenCalledWith(["project-a"]);
  });
});
