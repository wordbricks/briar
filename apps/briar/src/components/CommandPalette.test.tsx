/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { commandPaletteRecentsStorageKey } from "../lib/command-palette";
import type { CommandPaletteItem } from "./CommandPalette";
import { CommandPalette } from "./CommandPalette";

const makeItems = (onSelect = vi.fn()): CommandPaletteItem[] => [
  {
    active: true,
    description: "Current project",
    id: "project:briar",
    label: "Briar",
    onSelect,
    scope: "projects",
    section: "projects",
    sectionLabel: "Projects",
  },
  {
    description: "BRI-123 · In progress",
    id: "issue:123",
    label: "Mélanie onboarding",
    onSelect,
    scope: "issues",
    section: "issues",
    sectionLabel: "Issues",
  },
  {
    id: "action:create",
    label: "Create issue",
    onSelect,
    scope: "actions",
    section: "context",
    sectionLabel: "Current context",
  },
];

describe("CommandPalette", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    window.localStorage.setItem("briar.locale.v1", "en");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const renderPalette = async ({
    items = makeItems(),
    onOpenChange = vi.fn(),
  }: {
    items?: CommandPaletteItem[];
    onOpenChange?: (open: boolean) => void;
  } = {}) => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <CommandPalette
            contextLabel="Briar project"
            items={items}
            onOpenChange={onOpenChange}
            open
            shortcutLabel="⌘K"
          />
        </I18nProvider>,
      );
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
  };

  it("opens as an accessible combobox and focuses its search input", async () => {
    await renderPalette();

    const dialog = document.querySelector('[role="dialog"]');
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
    const listbox = document.querySelector('[role="listbox"]');
    expect(
      document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "")
        ?.textContent,
    ).toBe("Command palette");
    expect(input?.getAttribute("aria-controls")).toBe(listbox?.id);
    expect(input?.getAttribute("aria-activedescendant")).toContain(
      "option-action:create",
    );
    expect(document.activeElement).toBe(input);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(
      [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        .every((option) => option.tabIndex === -1),
    ).toBe(true);
    expect(dialog?.textContent).toContain("Briar project");
    expect(dialog?.textContent).toContain("⌘K");
  });

  it("filters normalized text and shows a useful empty state", async () => {
    await renderPalette();
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "melanie");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "Mélanie onboarding",
    );

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "no such command");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "No matching commands or items.",
    );
  });

  it("keeps the default result cap when recent history is stale", async () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `action:${index}`,
      label: `Action ${index}`,
      onSelect: vi.fn(),
      scope: "actions" as const,
      section: "context",
      sectionLabel: "Current context",
    }));
    window.localStorage.setItem(
      commandPaletteRecentsStorageKey,
      JSON.stringify(["missing:0", "missing:1"]),
    );

    await renderPalette({ items });

    expect(document.querySelectorAll('[role="option"]')).toHaveLength(6);
    expect(document.querySelector('[role="listbox"]')?.textContent).not
      .toContain("Recent places");
  });

  it("keeps the highlighted command through live reordering and runs it", async () => {
    const onFirstSelect = vi.fn();
    const onSecondSelect = vi.fn();
    const onThirdSelect = vi.fn();
    const onOpenChange = vi.fn();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const makeOrderedItems = (priorities: [number, number, number]) => [
      {
        id: "action:first",
        label: "First action",
        onSelect: onFirstSelect,
        priority: priorities[0],
        scope: "actions" as const,
        section: "context",
        sectionLabel: "Current context",
      },
      {
        id: "action:second",
        label: "Second action",
        onSelect: onSecondSelect,
        priority: priorities[1],
        scope: "actions" as const,
        section: "context",
        sectionLabel: "Current context",
      },
      {
        id: "action:third",
        label: "Third action",
        onSelect: onThirdSelect,
        priority: priorities[2],
        scope: "actions" as const,
        section: "context",
        sectionLabel: "Current context",
      },
    ];
    function ControlledPalette({ items }: { items: CommandPaletteItem[] }) {
      const [open, setOpen] = useState(true);
      return (
        <I18nProvider>
          <CommandPalette
            contextLabel="Briar project"
            items={items}
            onOpenChange={(nextOpen) => {
              onOpenChange(nextOpen);
              setOpen(nextOpen);
            }}
            open={open}
            shortcutLabel="⌘K"
          />
        </I18nProvider>
      );
    }
    const renderControlledPalette = async (items: CommandPaletteItem[]) => {
      await act(async () => {
        root.render(<ControlledPalette items={items} />);
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      });
    };
    await renderControlledPalette(makeOrderedItems([30, 20, 10]));
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
      );
    });
    expect(input.getAttribute("aria-activedescendant")).toContain(
      "option-action:third",
    );

    await renderControlledPalette(makeOrderedItems([20, 10, 40]));
    expect(input.getAttribute("aria-activedescendant")).toContain(
      "option-action:third",
    );

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onFirstSelect).not.toHaveBeenCalled();
    expect(onSecondSelect).not.toHaveBeenCalled();
    expect(onThirdSelect).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("closes on Escape and restores the element focused before opening", async () => {
    const onOpenChange = vi.fn();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    function ControlledPalette() {
      const [open, setOpen] = useState(true);
      return (
        <I18nProvider>
          <CommandPalette
            contextLabel="Briar project"
            items={makeItems()}
            onOpenChange={(nextOpen) => {
              onOpenChange(nextOpen);
              setOpen(nextOpen);
            }}
            open={open}
            shortcutLabel="⌘K"
          />
        </I18nProvider>
      );
    }

    await act(async () => {
      root.render(<ControlledPalette />);
    });

    await act(async () => {
      const composingEscape = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      });
      Object.defineProperty(composingEscape, "isComposing", { value: true });
      Object.defineProperty(composingEscape, "keyCode", { value: 229 });
      document.querySelector('[role="combobox"]')?.dispatchEvent(
        composingEscape,
      );
    });
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
