/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS, UpdateControl } from "./UpdateControl";

const { check, relaunch } = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));

describe("UpdateControl", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    container = document.createElement("div");
    document.body.append(container);
    check.mockReset();
    relaunch.mockReset();
  });

  afterEach(() => {
    container.remove();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.useRealTimers();
  });

  it("stays hidden when the signed channel is current", async () => {
    check.mockResolvedValue(null);
    const root = createRoot(container);
    await act(async () => root.render(<UpdateControl />));
    await act(async () => {
      await Promise.resolve();
    });
    expect(check).toHaveBeenCalledOnce();
    expect(container.querySelector("button")).toBeNull();
    await act(async () => root.unmount());
  });

  it("shows a compact install button only for a verified update", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    check.mockResolvedValue({ version: "1.0.1", downloadAndInstall });
    const root = createRoot(container);
    await act(async () => root.render(<UpdateControl />));
    await act(async () => {
      await Promise.resolve();
    });

    const button = container.querySelector("button");
    expect(container.textContent).toContain("v1.0.1 업데이트 사용 가능");
    expect(button?.className).toBe("sidebar-update-trigger");
    expect(button?.getAttribute("aria-label")).toContain("v1.0.1");

    await act(async () => {
      button?.click();
    });
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("rechecks the signed channel on a fixed interval", async () => {
    check.mockResolvedValue(null);
    const root = createRoot(container);
    await act(async () => root.render(<UpdateControl />));
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
    expect(container.textContent).toContain("v1.2.0 업데이트 사용 가능");
    expect(container.querySelector("button")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("stops rechecking after unmount", async () => {
    check.mockResolvedValue(null);
    const root = createRoot(container);
    await act(async () => root.render(<UpdateControl />));
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
