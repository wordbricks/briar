/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchIntro } from "./LaunchIntro";

describe("LaunchIntro", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("holds for five seconds before revealing and fading away", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const onReveal = vi.fn();

    await act(async () => root.render(
      <LaunchIntro onComplete={onComplete} onReveal={onReveal} />,
    ));

    await act(async () => vi.advanceTimersByTime(4_999));
    expect(onReveal).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(599));
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));
    expect(onComplete).toHaveBeenCalledOnce();
  });

});
