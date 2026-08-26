/** @vitest-environment jsdom */

import { act } from "react";
import type { Root } from "react-dom/client";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchIntro } from "./LaunchIntro";

describe("LaunchIntro", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("holds for five seconds before revealing and fading away", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const onReveal = vi.fn();

    await renderReactTestRoot(root, <LaunchIntro onComplete={onComplete} onReveal={onReveal} />);

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
