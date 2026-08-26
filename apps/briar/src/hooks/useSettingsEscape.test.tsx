/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { setRecordingKeybinding } from "../lib/keybindings";
import { setRemoteDesktopKeyboardCapture } from "../lib/remote-desktop-focus";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useSettingsEscape } from "./useSettingsEscape";

describe("useSettingsEscape", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let onClose: Mock<() => void>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onClose = vi.fn<() => void>();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.querySelectorAll("[data-test-settings-overlay]").forEach((node) =>
      node.remove()
    );
    setRecordingKeybinding(null);
    setRemoteDesktopKeyboardCapture(false);
    vi.restoreAllMocks();
  });

  function Harness({ enabled = true }: { enabled?: boolean }) {
    useSettingsEscape({ enabled, onClose });
    return <input aria-label="Settings field" />;
  }

  function keydown(
    target: EventTarget,
    init: KeyboardEventInit = {},
  ): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Escape",
      key: "Escape",
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  it("closes settings from an editable field", async () => {
    await act(async () => root.render(<Harness />));
    const input = container.querySelector("input")!;

    const event = keydown(input);

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("lets an active sequence and nested overlay consume Escape first", async () => {
    function ShortcutHarness() {
      useKeyboardShortcuts({
        commands: [{
          id: "inbox",
          label: "Inbox",
          onTrigger: vi.fn(),
          sequence: ["g", "i"],
        }],
        enabled: true,
      });
      useSettingsEscape({ enabled: true, onClose });
      return null;
    }
    await act(async () => root.render(<ShortcutHarness />));

    await act(async () => {
      keydown(window, { code: "KeyG", key: "g" });
    });
    let cancel!: KeyboardEvent;
    await act(async () => {
      cancel = keydown(window);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    const overlay = document.createElement("div");
    overlay.dataset.testSettingsOverlay = "";
    overlay.setAttribute("role", "dialog");
    document.body.append(overlay);
    expect(keydown(window).defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    overlay.remove();
    expect(keydown(window).defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores disabled, reserved, and unavailable keyboard states", async () => {
    await act(async () => root.render(<Harness enabled={false} />));
    expect(keydown(window).defaultPrevented).toBe(false);

    await act(async () => root.render(<Harness />));
    const ignoredEvents = [
      keydown(window, { repeat: true }),
      keydown(window, { metaKey: true }),
      keydown(window, { isComposing: true }),
    ];
    const prevented = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    prevented.preventDefault();
    window.dispatchEvent(prevented);
    expect(prevented.defaultPrevented).toBe(true);

    setRecordingKeybinding("commandPalette");
    ignoredEvents.push(keydown(window));
    setRecordingKeybinding(null);
    setRemoteDesktopKeyboardCapture(true);
    ignoredEvents.push(keydown(window));

    expect(ignoredEvents.every((event) => event.defaultPrevented === false))
      .toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});
