/** @vitest-environment jsdom */

import { StrictMode, act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
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
import {
  createKeyboardCommandCatalog,
  type KeyboardCommandCatalog,
  type KeyboardCommandController,
} from "../lib/keyboard-command-controller";
import { setRemoteDesktopKeyboardCapture } from "../lib/remote-desktop-focus";
import { createKeyboardCommandBindings } from "./createKeyboardCommandBindings";

type CommandId = "bubble" | "capture" | "dynamic" | "goInbox";

const initialCatalog = createKeyboardCommandCatalog<CommandId>([
  {
    bindings: [{ kind: "plain", sequence: ["KeyX"] }],
    id: "capture",
    phase: "capture",
  },
  {
    bindings: [{ kind: "plain", sequence: ["KeyB"] }],
    id: "bubble",
    phase: "bubble",
  },
  {
    bindings: [{ kind: "plain", sequence: ["KeyD"] }],
    id: "dynamic",
    phase: "capture",
  },
  {
    bindings: [{ kind: "plain", sequence: ["KeyG", "KeyI"] }],
    id: "goInbox",
    phase: "capture",
  },
]);

const updatedCatalog = createKeyboardCommandCatalog<CommandId>([
  {
    bindings: [{ kind: "plain", sequence: ["KeyX"] }],
    id: "capture",
    phase: "capture",
  },
  {
    bindings: [{ kind: "plain", sequence: ["KeyB"] }],
    id: "bubble",
    phase: "bubble",
  },
  {
    bindings: [{ kind: "plain", sequence: ["KeyN"] }],
    id: "dynamic",
    phase: "capture",
  },
  {
    bindings: [{ kind: "plain", sequence: ["KeyG", "KeyI"] }],
    id: "goInbox",
    phase: "capture",
  },
]);

const bindings = createKeyboardCommandBindings<CommandId>();
const {
  KeyboardCommandProvider,
  useKeyboardCommandController,
  useKeyboardCommandScope,
  useKeyboardCommandState,
} = bindings;

type HarnessProps = {
  readonly onBubble?: () => void;
  readonly onCapture?: () => void;
  readonly onDynamic?: () => void;
  readonly onGoInbox?: () => void;
  readonly onController?: (
    controller: KeyboardCommandController<CommandId>,
  ) => void;
};

function Harness({
  onBubble = () => undefined,
  onCapture = () => undefined,
  onController,
  onDynamic = () => undefined,
  onGoInbox = () => undefined,
}: HarnessProps) {
  const controller = useKeyboardCommandController();
  const state = useKeyboardCommandState();
  onController?.(controller);
  useKeyboardCommandScope({
    fallthrough: true,
    handlers: {
      bubble: { run: onBubble },
      capture: { run: onCapture },
      dynamic: { run: onDynamic },
      goInbox: { run: onGoInbox },
    },
    id: "root",
    priority: 0,
  });
  return (
    <>
      <button data-testid="target" type="button">Target</button>
      <output data-testid="mode">{state.mode}</output>
      <output data-testid="pending">
        {state.pending?.sequence.join(" ") ?? "idle"}
      </output>
    </>
  );
}

describe("createKeyboardCommandBindings", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];
  let unmount: () => Promise<void>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    ({ cleanup, container, root, unmount } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    setRecordingKeybinding(null);
    setRemoteDesktopKeyboardCapture(false);
    vi.useRealTimers();
  });

  async function renderHarness(
    props: HarnessProps = {},
    catalog: KeyboardCommandCatalog<CommandId> = initialCatalog,
  ) {
    await renderReactTestRoot(
      root,
      <KeyboardCommandProvider catalog={catalog}>
        <Harness {...props} />
      </KeyboardCommandProvider>,
    );
  }

  function target(): HTMLButtonElement {
    const element = container.querySelector<HTMLButtonElement>(
      '[data-testid="target"]',
    );
    if (!element) throw new Error("Missing keyboard target");
    return element;
  }

  function dispatchKey(
    element: EventTarget,
    init: KeyboardEventInit,
  ): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    element.dispatchEvent(event);
    return event;
  }

  it("routes capture commands before the target and bubble commands after it", async () => {
    const order: string[] = [];
    await renderHarness({
      onBubble: () => order.push("bubble"),
      onCapture: () => order.push("capture"),
    });
    target().addEventListener("keydown", () => order.push("target"));

    const captureEvent = dispatchKey(target(), { code: "KeyX", key: "x" });
    expect(order).toEqual(["capture", "target"]);
    expect(captureEvent.defaultPrevented).toBe(true);

    order.length = 0;
    const bubbleEvent = dispatchKey(target(), { code: "KeyB", key: "b" });
    expect(order).toEqual(["target", "bubble"]);
    expect(bubbleEvent.defaultPrevented).toBe(true);
  });

  it("lets a local preventDefault win before document bubble dispatch", async () => {
    const onBubble = vi.fn();
    await renderHarness({ onBubble });
    const element = target();
    element.addEventListener("keydown", (event) => event.preventDefault());
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyB",
      key: "b",
    });
    const preventDefault = vi.spyOn(event, "preventDefault");

    element.dispatchEvent(event);

    expect(onBubble).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("projects editable focus into insert mode and non-editable focus into normal mode", async () => {
    await renderHarness();
    const input = document.createElement("input");
    container.append(input);

    await act(async () => input.focus());
    expect(container.querySelector('[data-testid="mode"]')?.textContent).toBe(
      "insert",
    );

    await act(async () => target().focus());
    expect(container.querySelector('[data-testid="mode"]')?.textContent).toBe(
      "normal",
    );
  });

  it("cancels a pending sequence on pointerdown and on its injected deadline", async () => {
    vi.useFakeTimers();
    await renderHarness();

    await act(async () => {
      dispatchKey(target(), { code: "KeyG", key: "g" });
    });
    expect(container.querySelector('[data-testid="pending"]')?.textContent)
      .toBe("KeyG");
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
      }));
    });
    expect(container.querySelector('[data-testid="pending"]')?.textContent)
      .toBe("idle");

    await act(async () => {
      dispatchKey(target(), { code: "KeyG", key: "g" });
      vi.advanceTimersByTime(1_500);
    });
    expect(container.querySelector('[data-testid="pending"]')?.textContent)
      .toBe("idle");
  });

  it("lets an invalid capture continuation reach bubble on the same event", async () => {
    const onBubble = vi.fn();
    await renderHarness({ onBubble });

    let prefix!: KeyboardEvent;
    await act(async () => {
      prefix = dispatchKey(target(), { code: "KeyG", key: "g" });
    });
    expect(prefix.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-testid="pending"]')?.textContent)
      .toBe("KeyG");

    let continuation!: KeyboardEvent;
    await act(async () => {
      continuation = dispatchKey(target(), { code: "KeyB", key: "b" });
    });
    expect(continuation.defaultPrevented).toBe(true);
    expect(onBubble).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="pending"]')?.textContent)
      .toBe("idle");
  });

  it("updates the catalog at runtime without replacing the controller", async () => {
    const controllers: KeyboardCommandController<CommandId>[] = [];
    const onDynamic = vi.fn();
    const props = {
      onController: (controller: KeyboardCommandController<CommandId>) => {
        controllers.push(controller);
      },
      onDynamic,
    };
    await renderHarness(props);
    dispatchKey(target(), { code: "KeyD", key: "d" });
    expect(onDynamic).toHaveBeenCalledOnce();

    await renderHarness(props, updatedCatalog);
    dispatchKey(target(), { code: "KeyD", key: "d" });
    dispatchKey(target(), { code: "KeyN", key: "n" });

    expect(onDynamic).toHaveBeenCalledTimes(2);
    expect(new Set(controllers).size).toBe(1);
  });

  it("skips recording, remote capture, composing, and already-consumed events", async () => {
    const onCapture = vi.fn();
    await renderHarness({ onCapture });

    setRecordingKeybinding("commandPalette");
    expect(dispatchKey(target(), { code: "KeyX" }).defaultPrevented).toBe(false);
    setRecordingKeybinding(null);

    setRemoteDesktopKeyboardCapture(true);
    expect(dispatchKey(target(), { code: "KeyX" }).defaultPrevented).toBe(false);
    setRemoteDesktopKeyboardCapture(false);

    expect(
      dispatchKey(target(), { code: "KeyX", isComposing: true })
        .defaultPrevented,
    ).toBe(false);
    const consumed = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyX",
    });
    consumed.preventDefault();
    target().dispatchEvent(consumed);

    expect(onCapture).not.toHaveBeenCalled();
  });

  it("keeps one live scope with latest callbacks through StrictMode replay and cleanup", async () => {
    const first = vi.fn();
    const latest = vi.fn();
    await renderReactTestRoot(
      root,
      <StrictMode>
        <KeyboardCommandProvider catalog={initialCatalog}>
          <Harness onCapture={first} />
        </KeyboardCommandProvider>
      </StrictMode>,
    );
    dispatchKey(target(), { code: "KeyX" });
    expect(first).toHaveBeenCalledOnce();

    await renderReactTestRoot(
      root,
      <StrictMode>
        <KeyboardCommandProvider catalog={initialCatalog}>
          <Harness onCapture={latest} />
        </KeyboardCommandProvider>
      </StrictMode>,
    );
    dispatchKey(target(), { code: "KeyX" });
    expect(first).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledOnce();

    await unmount();
    const afterUnmount = dispatchKey(document.body, { code: "KeyX" });
    expect(latest).toHaveBeenCalledOnce();
    expect(afterUnmount.defaultPrevented).toBe(false);
  });
});
