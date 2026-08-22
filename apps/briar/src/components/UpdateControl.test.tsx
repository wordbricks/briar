/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppUpdateProvider,
  UPDATE_CHECK_INTERVAL_MS,
} from "./AppUpdateProvider";
import { UpdateControl } from "./UpdateControl";

const {
  appMenuUpdateListener,
  check,
  invoke,
  relaunch,
  syncAppUpdateMenu,
  updateLinkListener,
} = vi.hoisted(() => ({
  appMenuUpdateListener: {
    current: null as null | (() => void),
  },
  check: vi.fn(),
  invoke: vi.fn(),
  relaunch: vi.fn(),
  syncAppUpdateMenu: vi.fn(),
  updateLinkListener: {
    current: null as null | ((target: { targetVersion: string }) => void),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
vi.mock("../lib/app-menu", () => ({
  listenForAppMenuUpdate: (listener: () => void) => {
    appMenuUpdateListener.current = listener;
    return () => {
      appMenuUpdateListener.current = null;
    };
  },
  syncAppUpdateMenu,
}));
vi.mock("../lib/worker-update-links", () => ({
  listenForWorkerUpdateLinks: (
    listener: (target: { targetVersion: string }) => void,
  ) => {
    updateLinkListener.current = listener;
    return () => {
      updateLinkListener.current = null;
    };
  },
}));

describe("UpdateControl", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    container = document.createElement("div");
    document.body.append(container);
    check.mockReset();
    invoke.mockReset();
    invoke.mockResolvedValue(0);
    relaunch.mockReset();
    syncAppUpdateMenu.mockReset();
    syncAppUpdateMenu.mockResolvedValue(undefined);
    appMenuUpdateListener.current = null;
    updateLinkListener.current = null;
  });

  afterEach(() => {
    container.remove();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.useRealTimers();
  });

  const control = (
    <AppUpdateProvider>
      <UpdateControl />
    </AppUpdateProvider>
  );


  it("refreshes the bundled Worker runtime for a remote update link", async () => {
    check.mockResolvedValue(null);
    const root = createRoot(container);
    await act(async () => root.render(control));
    await act(async () => {
      updateLinkListener.current?.({ targetVersion: "1.2.84" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith("refresh_execution_worker_runtime");
    await act(async () => root.unmount());
  });

  it("checks first and changes the app menu before installing on the next selection", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    check
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version: "1.3.0", downloadAndInstall });
    const root = createRoot(container);
    await act(async () => root.render(control));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      appMenuUpdateListener.current?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(check).toHaveBeenCalledTimes(2);
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(syncAppUpdateMenu).toHaveBeenCalledWith(true);

    await act(async () => {
      appMenuUpdateListener.current?.();
      await Promise.resolve();
    });

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("prepare_for_app_update");
    expect(relaunch).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("shows a compact install button only for a verified update", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    check.mockResolvedValue({ version: "1.0.1", downloadAndInstall });
    const root = createRoot(container);
    await act(async () => root.render(control));
    await act(async () => {
      await Promise.resolve();
    });

    const button = container.querySelector("button");
    // Idle "update available" state: install button only, no prompt text.
    expect(container.textContent).not.toContain("업데이트 사용 가능");
    expect(container.querySelector(".sidebar-update-feedback")).toBeNull();
    expect(button?.className).toBe("sidebar-update-trigger is-available");
    expect(button?.getAttribute("aria-label")).toContain("v1.0.1");

    await act(async () => {
      button?.click();
    });
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("prepare_for_app_update");
    expect(relaunch).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("rechecks the signed channel on a fixed interval", async () => {
    check.mockResolvedValue(null);
    const root = createRoot(container);
    await act(async () => root.render(control));
    await act(async () => {
      await Promise.resolve();
    });
    expect(check).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 1);
    });
    expect(check).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(check).toHaveBeenCalledTimes(2);

    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    check.mockResolvedValue({ version: "1.2.0", downloadAndInstall });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(check).toHaveBeenCalledTimes(3);
    expect(container.textContent).not.toContain("업데이트 사용 가능");
    expect(container.querySelector(".sidebar-update-feedback")).toBeNull();
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.querySelector("button")?.getAttribute("aria-label")).toContain("v1.2.0");
    await act(async () => root.unmount());
  });

  it("stops rechecking after unmount", async () => {
    check.mockResolvedValue(null);
    const root = createRoot(container);
    await act(async () => root.render(control));
    await act(async () => {
      await Promise.resolve();
    });
    expect(check).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    });
    expect(check).toHaveBeenCalledOnce();
  });
});
