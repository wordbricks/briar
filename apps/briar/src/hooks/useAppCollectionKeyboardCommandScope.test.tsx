/** @vitest-environment jsdom */

import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveKeyboardNavigationPreferences } from "../lib/keybindings";
import { AppKeyboardCommandProvider } from "./appKeyboardCommands";
import {
  useAppCollectionKeyboardCommandScope,
  type AppCollectionKeyboardCommandScopeOptions,
} from "./useAppCollectionKeyboardCommandScope";

describe("useAppCollectionKeyboardCommandScope", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let move: ReturnType<
    typeof vi.fn<AppCollectionKeyboardCommandScopeOptions["move"]>
  >;
  let otherMove: ReturnType<
    typeof vi.fn<AppCollectionKeyboardCommandScopeOptions["move"]>
  >;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    move = vi.fn(() => ({ handled: true }));
    otherMove = vi.fn(() => ({ handled: true }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
    document.querySelectorAll("[data-test-overlay]").forEach((element) =>
      element.remove()
    );
  });

  function Harness({
    enabled = true,
    enableOther = false,
    orientation = "vertical",
    renderRoot = true,
  }: {
    readonly enabled?: boolean;
    readonly enableOther?: boolean;
    readonly orientation?: AppCollectionKeyboardCommandScopeOptions["orientation"];
    readonly renderRoot?: boolean;
  }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const otherRootRef = useRef<HTMLDivElement>(null);
    useAppCollectionKeyboardCommandScope({
      enabled,
      id: "test-collection",
      move,
      orientation,
      rootRef,
    });
    useAppCollectionKeyboardCommandScope({
      enabled: enableOther,
      id: "other-collection",
      move: otherMove,
      orientation,
      rootRef: otherRootRef,
    });
    return (
      <>
        <button data-testid="outside" type="button">Outside</button>
        {renderRoot
          ? (
            <div data-keyboard-list="" ref={rootRef}>
              <button data-testid="inside" type="button">Inside</button>
            </div>
          )
          : null}
        <div data-keyboard-list="" ref={otherRootRef}>
          <button data-testid="other-list" type="button">Other list</button>
        </div>
      </>
    );
  }

  async function renderHarness(
    props: Parameters<typeof Harness>[0] = {},
  ) {
    await act(async () =>
      root.render(
        <AppKeyboardCommandProvider>
          <Harness {...props} />
        </AppKeyboardCommandProvider>,
      )
    );
  }

  function target(testId: string): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>(
      `[data-testid="${testId}"]`,
    )!;
  }

  async function press(
    testId: string,
    init: KeyboardEventInit,
  ): Promise<KeyboardEvent> {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    await act(async () => target(testId).dispatchEvent(event));
    return event;
  }

  it("maps physical vertical commands and repeat into movement intents", async () => {
    await renderHarness();

    const down = await press("outside", {
      code: "KeyJ",
      key: "ㅓ",
      repeat: true,
    });
    expect(down.defaultPrevented).toBe(true);
    expect(move).toHaveBeenLastCalledWith("down", {
      repeat: true,
      source: "keyboard",
    });

    const up = await press("inside", { code: "ArrowUp", key: "ArrowUp" });
    expect(up.defaultPrevented).toBe(true);
    expect(move).toHaveBeenLastCalledWith("up", {
      repeat: false,
      source: "keyboard",
    });

    const unsupported = await press("inside", { code: "KeyH", key: "h" });
    expect(unsupported.defaultPrevented).toBe(false);
    expect(move).toHaveBeenCalledTimes(2);
  });

  it("supports both axes and passes an unhandled movement", async () => {
    move.mockReturnValue({ handled: false });
    await renderHarness({ orientation: "both" });

    const event = await press("inside", { code: "ArrowRight", key: "ArrowRight" });
    expect(event.defaultPrevented).toBe(false);
    expect(move).toHaveBeenCalledExactlyOnceWith("right", {
      repeat: false,
      source: "keyboard",
    });
  });

  it("yields to another collection but owns keys from outside any list", async () => {
    await renderHarness();

    const other = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyJ",
      key: "j",
    });
    await act(async () =>
      target("other-list").firstChild!.dispatchEvent(other)
    );
    expect(other.defaultPrevented).toBe(false);
    expect(move).not.toHaveBeenCalled();

    const outside = await press("outside", { code: "KeyJ", key: "j" });
    expect(outside.defaultPrevented).toBe(true);
    expect(move).toHaveBeenCalledOnce();
  });

  it("requires a connected collection root before claiming outside keys", async () => {
    await renderHarness({ renderRoot: false });

    const event = await press("outside", { code: "KeyJ", key: "j" });
    expect(event.defaultPrevented).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });

  it("routes an event to the collection containing its target", async () => {
    await renderHarness({ enableOther: true });

    expect(await press("inside", { code: "KeyJ", key: "j" }))
      .toHaveProperty("defaultPrevented", true);
    expect(move).toHaveBeenCalledOnce();
    expect(otherMove).not.toHaveBeenCalled();

    move.mockClear();
    expect(await press("other-list", { code: "KeyJ", key: "j" }))
      .toHaveProperty("defaultPrevented", true);
    expect(otherMove).toHaveBeenCalledOnce();
    expect(move).not.toHaveBeenCalled();
  });

  it("reads enabled, preference, and overlay availability at dispatch time", async () => {
    await renderHarness({ enabled: false });
    expect(await press("outside", { code: "KeyJ", key: "j" }))
      .toHaveProperty("defaultPrevented", false);

    await renderHarness();
    saveKeyboardNavigationPreferences({ sequenceShortcutsEnabled: false });
    expect(await press("outside", { code: "KeyJ", key: "j" }))
      .toHaveProperty("defaultPrevented", false);

    saveKeyboardNavigationPreferences({ sequenceShortcutsEnabled: true });
    const overlay = document.createElement("div");
    overlay.dataset.testOverlay = "";
    overlay.setAttribute("role", "dialog");
    document.body.append(overlay);
    expect(await press("outside", { code: "KeyJ", key: "j" }))
      .toHaveProperty("defaultPrevented", false);

    overlay.remove();
    expect(await press("outside", { code: "KeyJ", key: "j" }))
      .toHaveProperty("defaultPrevented", true);
    expect(move).toHaveBeenCalledOnce();
  });
});
