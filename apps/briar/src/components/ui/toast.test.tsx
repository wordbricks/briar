/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot, type ReactTestRoot } from "../../test/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ERROR_TOAST_DURATION_MS,
  DEFAULT_TOAST_DURATION_MS,
  ToastProvider,
  type ToastOptions,
  useToast,
} from "./toast";

const mounted: Array<Pick<ReactTestRoot, "cleanup">> = [];

beforeAll(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!;
    await item.cleanup();
  }
  vi.useRealTimers();
  document.body.querySelectorAll("[data-testid='toast-viewport']").forEach((node) => {
    node.remove();
  });
});

function Probe({ message, options }: { message: string; options?: ToastOptions }) {
  const { toast } = useToast();
  return (
    <button
      onClick={() => toast(message, options ?? { tone: "success" })}
      type="button"
    >
      show
    </button>
  );
}

async function mountProbe(
  message = "링크가 복사되었습니다",
  options?: ToastOptions,
) {
  const { cleanup, container, root } = createReactTestRoot({
    attachToDocument: true,
  });
  mounted.push({ cleanup });
  await renderReactTestRoot(
    root,
    <ToastProvider>
      <Probe message={message} options={options} />
    </ToastProvider>,
  );
  return container;
}

describe("ToastProvider", () => {
  it("shows a toast and auto-dismisses it", async () => {
    const container = await mountProbe();
    await act(async () => {
      container.querySelector("button")?.click();
    });

    const toast = document.body.querySelector('[data-testid="app-toast"]');
    expect(toast?.textContent).toContain("링크가 복사되었습니다");
    expect(toast?.className).toContain("success");

    await act(async () => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS);
    });

    expect(document.body.querySelector('[data-testid="app-toast"]')).toBeNull();
  });

  it("keeps error toasts visible longer and copies diagnostic details", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const details = [
      "Briar error diagnostics",
      "Request method: GET",
      "Request path: /projects/project-1/dashboard",
    ].join("\n");
    const container = await mountProbe("Load failed", {
      details,
      tone: "error",
    });
    await act(async () => {
      container.querySelector("button")?.click();
    });

    const copyButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy error details"]',
    );
    expect(copyButton).not.toBeNull();
    await act(async () => {
      copyButton?.click();
    });
    expect(writeText).toHaveBeenCalledWith(details);
    expect(
      document.body.querySelector('button[aria-label="Error details copied"]'),
    ).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS);
    });
    expect(document.body.querySelector('[data-testid="app-toast"]')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(
        DEFAULT_ERROR_TOAST_DURATION_MS - DEFAULT_TOAST_DURATION_MS,
      );
    });
    expect(document.body.querySelector('[data-testid="app-toast"]')).toBeNull();
  });

  it("shows each diagnostic occurrence only once", async () => {
    const container = await mountProbe("Load failed", {
      dedupeKey: "error:1",
      tone: "error",
    });
    await act(async () => {
      container.querySelector("button")?.click();
      container.querySelector("button")?.click();
    });

    expect(
      document.body.querySelectorAll('[data-testid="app-toast"].error'),
    ).toHaveLength(1);
  });
});
