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

  it("keeps holding past five seconds until the reveal resolves", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    let resolveReveal: () => void = () => {};
    const onReveal = vi
      .fn()
      .mockReturnValue(new Promise<void>((resolve) => {
        resolveReveal = resolve;
      }));

    await renderReactTestRoot(
      root,
      <LaunchIntro onComplete={onComplete} onReveal={onReveal} />,
    );
    const intro = () => container.querySelector("[data-testid='launch-intro']")!;
    expect(intro().classList.contains("launch-intro-gated")).toBe(true);

    await act(async () => vi.advanceTimersByTime(5_000));
    expect(onReveal).toHaveBeenCalledOnce();

    // The main window is still booting: no fade, no completion.
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(intro().classList.contains("launch-intro-fading")).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      resolveReveal();
    });
    expect(intro().classList.contains("launch-intro-fading")).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(599));
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("fades a rejected reveal instead of holding the intro forever", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const onReveal = vi.fn().mockRejectedValue(new Error("ipc unavailable"));

    await renderReactTestRoot(
      root,
      <LaunchIntro onComplete={onComplete} onReveal={onReveal} />,
    );

    await act(async () => vi.advanceTimersByTime(5_000));
    await act(async () => vi.advanceTimersByTime(600));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("runs the in-app intro on its CSS timing without a reveal", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();

    await renderReactTestRoot(root, <LaunchIntro onComplete={onComplete} />);
    const intro = container.querySelector("[data-testid='launch-intro']")!;
    expect(intro.classList.contains("launch-intro-gated")).toBe(false);

    await act(async () => vi.advanceTimersByTime(5_599));
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("skips straight to the reveal on Escape", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const onReveal = vi.fn();

    await renderReactTestRoot(
      root,
      <LaunchIntro onComplete={onComplete} onReveal={onReveal} />,
    );

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("skips straight to the reveal from the skip button", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const onReveal = vi.fn();

    await renderReactTestRoot(
      root,
      <LaunchIntro onComplete={onComplete} onReveal={onReveal} />,
    );

    const skip = container.querySelector<HTMLButtonElement>(
      ".launch-intro-skip",
    )!;
    await act(async () => {
      skip.click();
    });
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
