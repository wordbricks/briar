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

  it("reports when the signed channel is current", async () => {
    check.mockResolvedValue(null);
    const root = createRoot(container);
    await act(async () => root.render(<UpdateControl />));
    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(container.textContent).toContain("최신 버전입니다");
    await act(async () => root.unmount());
  });

  it("installs a verified update and relaunches", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    check.mockResolvedValue({ version: "1.0.1", downloadAndInstall });
    const root = createRoot(container);
    await act(async () => root.render(<UpdateControl />));
    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(container.textContent).toContain("v1.0.1 업데이트 사용 가능");
    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
