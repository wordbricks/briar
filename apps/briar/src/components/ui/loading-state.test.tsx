/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import {
  formatElapsed,
  LoadingState,
  type LoadingStateVariant,
} from "./loading-state";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("formatElapsed", () => {
  it("formats sub-minute waits with one decimal second", () => {
    expect(formatElapsed(0)).toBe("0.0s");
    expect(formatElapsed(12)).toBe("1.2s");
    expect(formatElapsed(599)).toBe("59.9s");
  });

  it("formats minute-plus waits with remaining tenths", () => {
    expect(formatElapsed(600)).toBe("1m 0.0s");
    expect(formatElapsed(705)).toBe("1m 10.5s");
  });
});

describe("LoadingState", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem("briar.locale.v1", "en");
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    localStorage.removeItem("briar.locale.v1");
    vi.useRealTimers();
  });

  async function renderLoader(variant?: LoadingStateVariant, label?: string) {
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <LoadingState label={label} variant={variant} />
      </I18nProvider>,
    );
    return container.querySelector<HTMLElement>("[data-testid='loading-state']");
  }

  it("ticks the elapsed timer while the wait continues", async () => {
    const status = await renderLoader(undefined, "Checking");
    expect(status?.textContent).toContain("0.0s");

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(status?.textContent).toContain("1.2s");
  });

});
