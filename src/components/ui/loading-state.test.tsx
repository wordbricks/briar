/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import {
  formatElapsed,
  LoadingState,
  type LoadingStateVariant,
} from "./loading-state";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem("briar.locale.v1", "en");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem("briar.locale.v1");
    vi.useRealTimers();
  });

  async function renderLoader(variant?: LoadingStateVariant, label?: string) {
    await act(async () =>
      root.render(
        <I18nProvider>
          <LoadingState label={label} variant={variant} />
        </I18nProvider>,
      ),
    );
    return container.querySelector<HTMLElement>("[data-testid='loading-state']");
  }

  it("renders the Drive wavefront with label and timer", async () => {
    const status = await renderLoader();
    expect(status?.dataset.variant).toBe("Drive");
    expect(status?.textContent).toContain("Churning");
    expect(status?.textContent).toContain("0.0s");
    expect(
      status?.querySelector(".tabular-nums")?.getAttribute("aria-hidden"),
    ).toBe("true");

    const pixels = [
      ...(status?.querySelectorAll<HTMLElement>(".loading-state-pixel") ?? []),
    ];
    expect(pixels).toHaveLength(9);
    expect(pixels[0]?.className).toContain("rounded-[1px]");
    expect(pixels.every((pixel) => pixel.style.animation !== "none")).toBe(true);
  });

  it("uses circular cells for Dots and parks the Orbit center", async () => {
    const dots = await renderLoader("Dots", "Loading issues");
    expect(dots?.dataset.variant).toBe("Dots");
    expect(dots?.textContent).toContain("Loading issues");
    expect(
      [
        ...(dots?.querySelectorAll<HTMLElement>(".loading-state-pixel") ?? []),
      ].every((pixel) => pixel.className.includes("rounded-full")),
    ).toBe(true);

    const orbit = await renderLoader("Orbit");
    const pixels = [
      ...(orbit?.querySelectorAll<HTMLElement>(".loading-state-pixel") ?? []),
    ];
    expect(pixels[4]?.style.animation).toBe("none");
    expect(pixels[4]?.style.opacity).toBe("0.07");
    expect(
      pixels.filter((pixel) => pixel.style.animation !== "none"),
    ).toHaveLength(8);
  });

  it("ticks the elapsed timer while the wait continues", async () => {
    const status = await renderLoader(undefined, "Checking");
    expect(status?.textContent).toContain("0.0s");

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(status?.textContent).toContain("1.2s");
  });
});
