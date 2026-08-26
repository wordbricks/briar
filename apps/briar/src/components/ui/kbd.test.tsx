/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Kbd, KbdGroup } from "./kbd";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Kbd", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders a keyboard key and forwards attributes and class overrides", async () => {
    await act(async () => {
      root.render(
        <Kbd aria-label="Command" className="h-7 bg-card">
          ⌘
        </Kbd>,
      );
    });

    const key = container.querySelector<HTMLElement>("[data-slot='kbd']");
    expect(key?.tagName).toBe("KBD");
    expect(key?.getAttribute("aria-label")).toBe("Command");
    expect(key?.className).toContain("h-7");
    expect(key?.className).not.toContain("h-5");
    expect(key?.className).toContain("bg-card");
  });

  it("groups multiple keyboard keys", async () => {
    await act(async () => {
      root.render(
        <KbdGroup aria-label="Save shortcut" className="gap-2">
          <Kbd>⌘</Kbd>
          <Kbd>S</Kbd>
        </KbdGroup>,
      );
    });

    const group = container.querySelector<HTMLElement>(
      "[data-slot='kbd-group']",
    );
    expect(group?.tagName).toBe("KBD");
    expect(group?.getAttribute("aria-label")).toBe("Save shortcut");
    expect(group?.className).toContain("gap-2");
    expect(group?.className).not.toContain("gap-1");
    expect(group?.querySelectorAll("[data-slot='kbd']")).toHaveLength(2);
  });
});
