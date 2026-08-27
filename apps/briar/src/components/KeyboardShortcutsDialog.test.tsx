/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import {
  KeyboardShortcutsDialog,
  type KeyboardShortcutHelpSection,
} from "./KeyboardShortcutsDialog";

const sections: KeyboardShortcutHelpSection[] = [
  {
    id: "general",
    label: "General",
    items: [
      { id: "create", keys: ["C"], label: "Create new issue" },
      { id: "palette", keys: ["⌘K"], label: "Open command palette" },
      {
        id: "palette-alternative",
        join: "or",
        keys: ["Ctrl+K", "/"],
        label: "Open command palette another way",
      },
    ],
  },
  {
    id: "go",
    label: "Go mode",
    items: [
      { id: "inbox", keys: ["G", "I"], label: "Go to inbox" },
    ],
  },
];

describe("KeyboardShortcutsDialog", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.setItem("briar.locale.v1", "en");
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("renders searchable shortcut sections and focuses search", async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <KeyboardShortcutsDialog
            onOpenChange={vi.fn()}
            open
            sections={sections}
          />
        </I18nProvider>,
      );
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    const dialog = document.querySelector('[role="dialog"]');
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Search shortcuts"]',
    );
    expect(dialog?.textContent).toContain("Keyboard shortcuts");
    expect(dialog?.textContent).toContain("Create new issue");
    expect(dialog?.textContent).toContain("Go to inbox");
    expect(document.activeElement).toBe(input);

    const singleKey = document.querySelector<HTMLElement>('dd[aria-label="C"]');
    expect(singleKey?.querySelectorAll('[data-slot="kbd-group"]')).toHaveLength(0);
    expect(singleKey?.querySelectorAll('[data-slot="kbd"]')).toHaveLength(1);

    const modifierGroup = [...document.querySelectorAll<HTMLElement>(
      '[data-slot="kbd-group"]',
    )].find((group) => group.textContent === "⌘K");
    expect(modifierGroup?.tagName).toBe("DIV");
    expect(modifierGroup?.querySelectorAll('[data-slot="kbd"]')).toHaveLength(2);

    const alternative = document.querySelector<HTMLElement>(
      'dd[aria-label="Ctrl+K or /"]',
    );
    expect(alternative?.querySelectorAll('[data-slot="kbd-group"]')).toHaveLength(1);
    const alternativeGroup = alternative?.querySelector<HTMLElement>(
      '[data-slot="kbd-group"]',
    );
    expect(alternativeGroup?.nextElementSibling?.textContent).toBe("or");
    expect(alternativeGroup?.parentElement).toBe(alternative);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "inbox");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(dialog?.textContent).not.toContain("Create new issue");
    expect(dialog?.textContent).toContain("Go to inbox");
    expect(dialog?.textContent).toContain("G");
    expect(dialog?.textContent).toContain("I");

    const sequence = document.querySelector<HTMLElement>('dd[aria-label="G → I"]');
    const sequenceSeparator = sequence?.querySelector<HTMLElement>(
      '[aria-hidden="true"]',
    );
    expect(sequence?.querySelectorAll('[data-slot="kbd-group"]')).toHaveLength(0);
    expect(sequenceSeparator?.textContent).toBe("→");
    expect(sequenceSeparator?.parentElement).toBe(sequence);
  });

  it("shows an empty result state", async () => {
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <KeyboardShortcutsDialog
          onOpenChange={vi.fn()}
          open
          sections={sections}
        />
      </I18nProvider>,
    );
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Search shortcuts"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "missing");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "No matching shortcuts.",
    );
  });
});
