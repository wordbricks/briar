/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TOAST_DURATION_MS, ToastProvider, useToast } from "./toast";

const mounted: Array<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> = [];

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!;
    await act(async () => item.root.unmount());
    item.container.remove();
  }
  vi.useRealTimers();
  document.body.querySelectorAll("[data-testid='toast-viewport']").forEach((node) => {
    node.remove();
  });
});

function Probe({ message }: { message: string }) {
  const { toast } = useToast();
  return (
    <button onClick={() => toast(message, { tone: "success" })} type="button">
      show
    </button>
  );
}

async function mountProbe(message = "링크가 복사되었습니다") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => {
    root.render(
      <ToastProvider>
        <Probe message={message} />
      </ToastProvider>,
    );
  });
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
});
