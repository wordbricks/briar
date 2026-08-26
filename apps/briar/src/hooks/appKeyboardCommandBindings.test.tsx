/** @vitest-environment jsdom */

import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keybindingsChangedEvent, saveKeybinding } from "../lib/keybindings";
import type { KeyboardCommandController } from "../lib/keyboard-command-controller";
import type { AppKeyboardCommandId } from "../lib/app-keyboard-command-catalog";
import {
  AppKeyboardCommandProvider,
  useAppKeyboardCommandController,
  useAppKeyboardCommandScope,
  useAppKeyboardCommandState,
} from "./appKeyboardCommands";

function dispatchKey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(event);
  return event;
}

describe("AppKeyboardCommandProvider", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    window.localStorage.clear();
    container.remove();
  });

  it("updates live keybindings without replacing the app controller", async () => {
    const controllers = new Set<KeyboardCommandController<AppKeyboardCommandId>>();
    const openPalette = vi.fn();

    function Harness() {
      const controller = useAppKeyboardCommandController();
      const state = useAppKeyboardCommandState();
      controllers.add(controller);
      useAppKeyboardCommandScope({
        fallthrough: true,
        handlers: {
          openCommandPalette: { run: openPalette },
        },
        id: "app",
        priority: 0,
      });
      return <output>{state.mode}</output>;
    }

    await act(async () =>
      root.render(
        <AppKeyboardCommandProvider>
          <Harness />
        </AppKeyboardCommandProvider>,
      )
    );
    expect(dispatchKey({ code: "KeyK", key: "k", metaKey: true }))
      .toHaveProperty("defaultPrevented", true);
    expect(openPalette).toHaveBeenCalledOnce();

    await act(async () => {
      saveKeybinding("commandPalette", {
        alt: false,
        code: "KeyP",
        ctrl: true,
        key: "p",
        meta: false,
        shift: false,
      });
    });

    expect(dispatchKey({ code: "KeyK", key: "k", metaKey: true }))
      .toHaveProperty("defaultPrevented", false);
    expect(dispatchKey({ code: "KeyP", ctrlKey: true, key: "p" }))
      .toHaveProperty("defaultPrevented", true);
    expect(openPalette).toHaveBeenCalledTimes(2);
    expect(controllers.size).toBe(1);
  });

  it("balances the live-keymap subscription through StrictMode cleanup", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");

    await act(async () =>
      root.render(
        <StrictMode>
          <AppKeyboardCommandProvider>
            <div />
          </AppKeyboardCommandProvider>
        </StrictMode>,
      )
    );
    await act(async () => root.unmount());

    const subscriptionAdds = addEventListener.mock.calls.filter(
      ([eventName]) => eventName === keybindingsChangedEvent,
    );
    const subscriptionRemoves = removeEventListener.mock.calls.filter(
      ([eventName]) => eventName === keybindingsChangedEvent,
    );
    expect(subscriptionAdds.length).toBeGreaterThan(0);
    expect(subscriptionRemoves).toHaveLength(subscriptionAdds.length);

    addEventListener.mockRestore();
    removeEventListener.mockRestore();
  });
});
