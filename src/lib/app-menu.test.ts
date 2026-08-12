/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_MENU_SETTINGS_EVENT,
  listenForAppMenuSettings,
  syncAppUpdateMenu,
} from "./app-menu";

const { invoke, listen, nativeListener, unlisten } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  nativeListener: {
    current: null as null | (() => void),
  },
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (eventName: string, listener: () => void) => {
    listen(eventName);
    nativeListener.current = listener;
    return Promise.resolve(unlisten);
  },
}));
vi.mock("./platform", () => ({
  isMacDesktopTauri: () => true,
}));

afterEach(() => {
  invoke.mockReset();
  listen.mockReset();
  unlisten.mockReset();
  nativeListener.current = null;
});

describe("macOS app menu bridge", () => {
  it("forwards the native Settings selection and removes its listener", async () => {
    const onSelect = vi.fn();
    const dispose = listenForAppMenuSettings(onSelect);

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith(APP_MENU_SETTINGS_EVENT);
    });
    nativeListener.current?.();
    expect(onSelect).toHaveBeenCalledOnce();

    dispose();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("synchronizes update availability with the native label", async () => {
    invoke.mockResolvedValue(undefined);
    await syncAppUpdateMenu(true);
    expect(invoke).toHaveBeenCalledWith("sync_app_update_menu", {
      updateAvailable: true,
    });
  });
});
