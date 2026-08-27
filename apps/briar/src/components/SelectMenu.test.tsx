/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { describe, expect, it, vi } from "vitest";
import { SelectMenu } from "./SelectMenu";

describe("SelectMenu", () => {
  it("opens an accessible listbox, shows descriptions, and selects an option", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const onValueChange = vi.fn();

    await renderReactTestRoot(
      root,
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

    const trigger = container.querySelector<HTMLButtonElement>("#speed");
    expect(trigger?.getAttribute("role")).toBe("combobox");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.hasAttribute("aria-controls")).toBe(false);

    await act(async () => trigger?.click());
    const listbox = document.querySelector("#speed-listbox");
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger?.getAttribute("aria-controls")).toBe("speed-listbox");
    expect(listbox?.getAttribute("role")).toBe("listbox");
    expect(listbox?.textContent).toContain("1.5x speed, increased usage");

    const fast = listbox?.querySelector<HTMLButtonElement>('[data-value="fast"]');
    await act(async () => fast?.click());
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(onValueChange).toHaveBeenCalledWith("fast");
    expect(document.querySelector("#speed-listbox")).toBeNull();
    expect(trigger?.hasAttribute("aria-controls")).toBe(false);
    expect(document.activeElement).toBe(trigger);

    await cleanup();
  });

  it("opens from the keyboard and moves focus through enabled options", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
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

    await cleanup();
  });

  it("renders the portaled listbox above the trigger's ancestor layer", async () => {
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.zIndex = "1001";
    const { cleanup, root } = createReactTestRoot({
      attachToDocument: true,
      container,
    });

    await renderReactTestRoot(
      root,
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

    await act(async () => {
      container.querySelector<HTMLButtonElement>("#modal-select")?.click();
    });

    const listbox =
      document.querySelector<HTMLDivElement>("#modal-select-listbox");
    expect(
      listbox?.closest<HTMLDivElement>(".select-menu-popover")?.style.zIndex,
    ).toBe("1002");

    await cleanup();
  });

  it("keeps viewport coordinates inside an untransformed modal dialog", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
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

    await cleanup();
  });

  it("translates viewport coordinates for a transformed modal dialog", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
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

    await cleanup();
  });

  it("filters searchable options by label, value, and description", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const onValueChange = vi.fn();

    await renderReactTestRoot(
      root,
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

    await cleanup();
  });
});
