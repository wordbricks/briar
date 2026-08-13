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

  it("renders an optional leading icon and can hide the chevron", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SelectMenu
          hideChevron
          id="badge-select"
          label="Status"
          leadingIcon={<span data-testid="leading-icon">icon</span>}
          onValueChange={() => undefined}
          options={[{ label: "Queued", value: "queued" }]}
          value="queued"
        />,
      );
    });

    expect(
      container.querySelector('[data-testid="leading-icon"]')?.textContent,
    ).toBe("icon");
    expect(container.querySelector(".select-menu-chevron")).toBeNull();
    expect(
      container.querySelector(".select-menu-leading-icon"),
    ).not.toBeNull();

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

  it("renders an optional icon on the trigger and the option rows", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SelectMenu
          id="icon-select"
          label="Project"
          onValueChange={() => undefined}
          options={[
            {
              label: "Briar",
              value: "project-1",
              icon: "data:image/png;base64,AA==",
            },
            { label: "Briar Mobile", value: "project-2", icon: null },
          ]}
          value="project-1"
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>("#icon-select");
    expect(trigger?.querySelector(".select-menu-trigger-icon")?.getAttribute("src"))
      .toBe("data:image/png;base64,AA==");

    await act(async () => trigger?.click());
    const listbox = document.querySelector("#icon-select-listbox");
    expect(listbox?.querySelectorAll(".select-menu-option-icon")).toHaveLength(1);

    await act(async () => root.unmount());
    container.remove();
  });

  it("renders the portaled listbox above the trigger's ancestor layer", async () => {
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.zIndex = "1001";
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SelectMenu
          id="modal-select"
          label="Recurrence"
          onValueChange={() => undefined}
          options={[
            { label: "Daily", value: "daily" },
            { label: "Weekdays", value: "weekdays" },
          ]}
          value="weekdays"
        />,
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("#modal-select")?.click();
    });

    const listbox =
      document.querySelector<HTMLDivElement>("#modal-select-listbox");
    expect(
      listbox?.closest<HTMLDivElement>(".select-menu-popover")?.style.zIndex,
    ).toBe("1002");

    await act(async () => root.unmount());
    container.remove();
  });

  it("filters searchable options by label, value, and description", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        <SelectMenu
          id="model-select"
          label="Model"
          onValueChange={onValueChange}
          options={[
            { label: "Provider default model", value: "" },
            {
              description: "anthropic/claude-opus-4-6",
              label: "Claude Opus",
              value: "anthropic/claude-opus-4-6",
            },
            { label: "GPT", value: "openai/gpt-5.6" },
          ]}
          searchEmptyMessage="No matching models"
          searchPlaceholder="Search models"
          searchable
          value=""
        />,
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("#model-select")?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const search = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search models"]',
    )!;
    expect(document.activeElement).toBe(search);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "anthropic");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelector('[data-value="anthropic/claude-opus-4-6"]'))
      .not.toBeNull();
    expect(document.querySelector('[data-value="openai/gpt-5.6"]')).toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "missing");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("No matching models");

    await act(async () => root.unmount());
    container.remove();
  });
});
