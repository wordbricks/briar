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
import { keyboardShortcutSequenceTimeoutMs } from "../lib/keyboard-shortcuts";
import {
  useKeyboardShortcuts,
  type KeyboardShortcutAction,
} from "./useKeyboardShortcuts";

type CommandId = "help" | "inbox";

describe("useKeyboardShortcuts", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let onHelp: Mock<() => void>;
  let onInbox: Mock<() => void>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onHelp = vi.fn<() => void>();
    onInbox = vi.fn<() => void>();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function Harness({ enabled = true }: { enabled?: boolean }) {
    const commands: readonly KeyboardShortcutAction<CommandId>[] = [
      { id: "help", label: "Help", onTrigger: onHelp, sequence: ["?"] },
      {
        id: "inbox",
        label: "Inbox",
        onTrigger: onInbox,
        sequence: ["g", "i"],
      },
    ];
    const { pendingShortcut } = useKeyboardShortcuts({ commands, enabled });
    return (
      <output data-testid="pending">
        {pendingShortcut?.prefix.join("") ?? "idle"}
      </output>
    );
  }

  const dispatch = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    window.dispatchEvent(event);
    return event;
  };

  it("shows a pending prefix, consumes the sequence, and runs its command", async () => {
    await act(async () => root.render(<Harness />));

    let first!: KeyboardEvent;
    await act(async () => {
      first = dispatch({ code: "KeyG", key: "g" });
    });
    expect(first.defaultPrevented).toBe(true);
    expect(container.textContent).toBe("g");

    let second!: KeyboardEvent;
    await act(async () => {
      second = dispatch({ code: "KeyI", key: "i" });
    });
    expect(second.defaultPrevented).toBe(true);
    expect(onInbox).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("idle");
  });

  it("clears a pending prefix after the sequence timeout", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      dispatch({ code: "KeyG", key: "g" });
    });
    expect(container.textContent).toBe("g");

    await act(async () => {
      vi.advanceTimersByTime(keyboardShortcutSequenceTimeoutMs);
    });
    expect(container.textContent).toBe("idle");
    expect(onInbox).not.toHaveBeenCalled();
  });

  it("runs question mark directly but pauses in editable controls", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      dispatch({ code: "Slash", key: "?", shiftKey: true });
    });
    expect(onHelp).toHaveBeenCalledTimes(1);

    const input = document.createElement("input");
    document.body.append(input);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "Slash",
        key: "?",
        shiftKey: true,
      }));
    });
    expect(onHelp).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("does nothing while the preference is disabled", async () => {
    await act(async () => root.render(<Harness enabled={false} />));
    const event = dispatch({ code: "KeyG", key: "g" });
    expect(event.defaultPrevented).toBe(false);
    expect(container.textContent).toBe("idle");
  });

  it("captures global sequences before nested handlers stop propagation", async () => {
    await act(async () => root.render(<Harness />));
    const nestedTarget = document.createElement("button");
    nestedTarget.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    document.body.append(nestedTarget);

    await act(async () => {
      nestedTarget.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "KeyG",
        key: "g",
      }));
      nestedTarget.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "KeyI",
        key: "i",
      }));
    });

    expect(onInbox).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("idle");
    nestedTarget.remove();
  });
});
