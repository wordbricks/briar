/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateControl } from "./UpdateControl";

const { check, relaunch } = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));

describe("UpdateControl", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    container = document.createElement("div");
    document.body.append(container);
    check.mockReset();
    relaunch.mockReset();
  });

  afterEach(() => {
    container.remove();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("stays hidden when the signed channel is current", async () => {
    check.mockResolvedValue(null);
    const root = createRoot(container);
    await act(async () => root.render(<UpdateControl />));
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
});
