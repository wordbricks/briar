/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SelectMenu } from "./SelectMenu";

describe("SelectMenu", () => {
  it("opens an accessible listbox, shows descriptions, and selects an option", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        <SelectMenu
          id="speed"
          label="Speed"
          onValueChange={onValueChange}
          options={[
            {
              description: "Default speed",
              label: "Standard",
              value: "standard",
            },
            {
              description: "1.5x speed, increased usage",
              label: "Fast",
              value: "fast",
            },
          ]}
          value="standard"
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>("#speed");
    expect(trigger?.getAttribute("role")).toBe("combobox");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => trigger?.click());
    const listbox = document.querySelector("#speed-listbox");
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(listbox?.getAttribute("role")).toBe("listbox");
    expect(listbox?.textContent).toContain("1.5x speed, increased usage");

    const fast = listbox?.querySelector<HTMLButtonElement>('[data-value="fast"]');
    await act(async () => fast?.click());
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(onValueChange).toHaveBeenCalledWith("fast");
    expect(document.querySelector("#speed-listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () => root.unmount());
    container.remove();
  });

  it("opens from the keyboard and moves focus through enabled options", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SelectMenu
          id="keyboard-select"
          label="Choice"
          onValueChange={() => undefined}
          options={[
            { label: "First", value: "first" },
            { disabled: true, label: "Disabled", value: "disabled" },
            { label: "Last", value: "last" },
          ]}
          value="first"
        />,
      );
    });

    const trigger =
      container.querySelector<HTMLButtonElement>("#keyboard-select");
    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(
      document.activeElement?.getAttribute("data-value"),
    ).toBe("first");
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    expect(document.activeElement?.getAttribute("data-value")).toBe("last");
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement?.getAttribute("data-value")).toBe("last");

    await act(async () => root.unmount());
    container.remove();
  });
});
