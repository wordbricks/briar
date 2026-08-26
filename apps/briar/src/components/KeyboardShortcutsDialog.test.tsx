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
