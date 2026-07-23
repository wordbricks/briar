/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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

  it("renders the localized intro with a skip control", () => {
    const markup = renderToStaticMarkup(
      <LaunchIntro onComplete={() => undefined} />,
    );

    expect(markup).toContain('data-testid="launch-intro"');
    expect(markup).toContain("Briar 시작 화면");
    expect(markup).toContain("Skip intro");
    expect(markup).toContain("--launch-character-index");
    expect(markup).toContain("launch-intro-content");
    expect(markup).not.toContain("launch-intro-window");
    expect(markup).not.toContain("launch-intro-gradient");
    expect(markup).not.toContain("launch-intro-grain");
    expect(markup).not.toContain("launch-intro-status");
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

  it("marks the full-screen native presentation", () => {
    const markup = renderToStaticMarkup(
      <LaunchIntro native onComplete={() => undefined} />,
    );

    expect(markup).toContain("launch-intro-native");
  });

  it("marks a persistent development preview", () => {
    const markup = renderToStaticMarkup(
      <LaunchIntro preview onComplete={() => undefined} />,
    );

    expect(markup).toContain("launch-intro-preview");
  });
});
