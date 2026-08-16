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

  it("renders a React leading mark on the trigger and option rows", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SelectMenu
          id="leading-select"
          label="Provider"
          onValueChange={() => undefined}
          options={[
            {
              label: "Claude",
              leading: <span data-testid="claude-mark">C</span>,
              value: "claude",
            },
            { label: "Codex", value: "codex" },
          ]}
          value="claude"
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>("#leading-select");
    expect(trigger?.querySelector("[data-testid='claude-mark']")?.textContent).toBe(
      "C",
    );

    await act(async () => trigger?.click());
    const listbox = document.querySelector("#leading-select-listbox");
    expect(listbox?.querySelectorAll(".select-menu-option-leading")).toHaveLength(1);
    expect(
      listbox?.querySelector("[data-value='claude'] [data-testid='claude-mark']"),
    ).not.toBeNull();

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

  it("keeps viewport coordinates inside an untransformed modal dialog", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <div role="dialog">
          <SelectMenu
            id="dialog-model-select"
            label="Model"
            onValueChange={() => undefined}
            options={Array.from({ length: 40 }, (_, index) => ({
              label: `Model ${index + 1}`,
              value: `provider/model-${index + 1}`,
            }))}
            searchPlaceholder="Search models"
            searchable
            value="provider/model-1"
          />
        </div>,
      );
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const trigger = container.querySelector<HTMLButtonElement>(
      "#dialog-model-select",
    )!;
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      bottom: 680,
      height: 600,
      left: 400,
      right: 970,
      top: 80,
      width: 570,
      x: 400,
      y: 80,
      toJSON: () => ({}),
    });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      bottom: 242,
      height: 42,
      left: 460,
      right: 760,
      top: 200,
      width: 300,
      x: 460,
      y: 200,
      toJSON: () => ({}),
    });

    await act(async () => {
      trigger.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const listbox = dialog?.querySelector<HTMLElement>(
      "#dialog-model-select-listbox",
    );
    const popover = listbox?.closest<HTMLElement>(".select-menu-popover");
    expect(listbox).not.toBeNull();
    expect(listbox?.querySelectorAll('[role="option"]')).toHaveLength(40);
    expect(popover?.style.left).toBe("460px");
    expect(popover?.style.top).toBe("249px");
    expect(document.activeElement).toBe(
      dialog?.querySelector('input[aria-label="Search models"]'),
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("translates viewport coordinates for a transformed modal dialog", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <div role="dialog" style={{ transform: "translate(-50%, -50%)" }}>
          <SelectMenu
            id="transformed-dialog-select"
            label="Provider"
            onValueChange={() => undefined}
            options={[
              { label: "Codex", value: "codex" },
              { label: "Claude", value: "claude" },
            ]}
            value="codex"
          />
        </div>,
      );
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const trigger = container.querySelector<HTMLButtonElement>(
      "#transformed-dialog-select",
    )!;
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      bottom: 680,
      height: 600,
      left: 400,
      right: 970,
      top: 80,
      width: 570,
      x: 400,
      y: 80,
      toJSON: () => ({}),
    });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      bottom: 242,
      height: 42,
      left: 460,
      right: 760,
      top: 200,
      width: 300,
      x: 460,
      y: 200,
      toJSON: () => ({}),
    });

    await act(async () => trigger.click());

    const popover = dialog.querySelector<HTMLElement>(".select-menu-popover");
    expect(popover?.style.left).toBe("60px");
    expect(popover?.style.top).toBe("169px");

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
