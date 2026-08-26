/** @vitest-environment jsdom */

import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keybindingsChangedEvent, saveKeybinding } from "../lib/keybindings";
import type { KeyboardCommandController } from "../lib/keyboard-command-controller";
import type { AppKeyboardCommandId } from "../lib/app-keyboard-command-catalog";
import {
  AppKeyboardCommandBoundary,
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

function SettingsKeyboardHarness({
  onClose,
}: {
  readonly onClose: () => void;
}) {
  const state = useAppKeyboardCommandState();
  useAppKeyboardCommandScope({
    fallthrough: true,
    handlers: {
      closeSettings: {
        run: () => {
          onClose();
          return "handled";
        },
      },
      goInbox: {
        run: () => "handled",
      },
    },
    id: "settings",
    priority: 100,
  });
  return (
    <>
      <input aria-label="Settings field" />
      <button type="button">Settings action</button>
      <output data-testid="mode">{state.mode}</output>
      <output data-testid="pending">
        {state.pending?.sequence.join(" ") ?? "idle"}
      </output>
    </>
  );
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

  it("reuses the root controller across an app command boundary", async () => {
    const controllers: KeyboardCommandController<AppKeyboardCommandId>[] = [];

    function Probe() {
      controllers.push(useAppKeyboardCommandController());
      return null;
    }

    await act(async () =>
      root.render(
        <AppKeyboardCommandProvider>
          <Probe />
          <AppKeyboardCommandBoundary>
            <Probe />
          </AppKeyboardCommandBoundary>
        </AppKeyboardCommandProvider>,
      )
    );

    expect(controllers).toHaveLength(2);
    expect(new Set(controllers).size).toBe(1);
  });

  it("closes settings with the first Escape, including from insert mode", async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <AppKeyboardCommandProvider>
          <SettingsKeyboardHarness onClose={onClose} />
        </AppKeyboardCommandProvider>,
      )
    );
    const input = container.querySelector("input")!;

    await act(async () => input.focus());
    expect(container.querySelector('[data-testid="mode"]')?.textContent).toBe(
      "insert",
    );

    let escape!: KeyboardEvent;
    await act(async () => {
      escape = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "Escape",
        key: "Escape",
      });
      input.dispatchEvent(escape);
    });

    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses Escape to cancel a pending go sequence before closing settings", async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <AppKeyboardCommandProvider>
          <SettingsKeyboardHarness onClose={onClose} />
        </AppKeyboardCommandProvider>,
      )
    );
    const button = container.querySelector("button")!;

    await act(async () => button.focus());
    let prefix!: KeyboardEvent;
    await act(async () => {
      prefix = dispatchKey({ code: "KeyG", key: "g" });
    });
    expect(prefix.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-testid="pending"]')?.textContent)
      .toBe("KeyG");

    let cancel!: KeyboardEvent;
    await act(async () => {
      cancel = dispatchKey({ code: "Escape", key: "Escape" });
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-testid="pending"]')?.textContent)
      .toBe("idle");
    expect(onClose).not.toHaveBeenCalled();

    let close!: KeyboardEvent;
    await act(async () => {
      close = dispatchKey({ code: "Escape", key: "Escape" });
    });
    expect(close.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("returns to normal mode when an editable settings control blurs", async () => {
    await act(async () =>
      root.render(
        <AppKeyboardCommandProvider>
          <SettingsKeyboardHarness onClose={() => undefined} />
        </AppKeyboardCommandProvider>,
      )
    );
    const input = container.querySelector("input")!;

    await act(async () => input.focus());
    expect(container.querySelector('[data-testid="mode"]')?.textContent).toBe(
      "insert",
    );

    await act(async () => input.blur());
    expect(container.querySelector('[data-testid="mode"]')?.textContent).toBe(
      "normal",
    );
  });
});
