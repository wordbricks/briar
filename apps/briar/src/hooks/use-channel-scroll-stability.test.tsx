/** @vitest-environment jsdom */

import { act, useLayoutEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { useChannelScrollStability } from "./use-channel-scroll-stability";

type ScrollStability = ReturnType<typeof useChannelScrollStability>;

type HarnessSnapshot = {
  controls: ScrollStability;
  scroller: HTMLDivElement;
};

function setScrollMetrics(
  scroller: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: metrics.clientHeight },
    scrollHeight: { configurable: true, value: metrics.scrollHeight },
    scrollTop: { configurable: true, writable: true, value: metrics.scrollTop },
  });
}

function Harness({
  channelKey,
  onSnapshot,
}: {
  channelKey: string | null;
  onSnapshot: (snapshot: HarnessSnapshot) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const controls = useChannelScrollStability({
    channelKey,
    scrollerRef,
  });
  useLayoutEffect(() => {
    if (scrollerRef.current) {
      onSnapshot({ controls, scroller: scrollerRef.current });
    }
  }, [controls, onSnapshot]);
  return (
    <div ref={scrollerRef}>
      <div data-channel-scroll-row="message-1" />
    </div>
  );
}

describe("useChannelScrollStability", () => {
  let frame = 0;
  let pendingFrames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    pendingFrames = new Map();
    frame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++frame;
      pendingFrames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      pendingFrames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const flushFrames = async () => {
    await act(async () => {
      const callbacks = [...pendingFrames.values()];
      pendingFrames.clear();
      for (const callback of callbacks) callback(0);
      await Promise.resolve();
    });
  };

  it("keeps the latest message at the bottom after an async row height change", async () => {
    let snapshot: HarnessSnapshot | null = null;
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <Harness channelKey="channel-a" onSnapshot={(next) => snapshot = next} />,
    );
    const scroller = snapshot!.scroller;
    setScrollMetrics(scroller, {
      clientHeight: 500,
      scrollHeight: 1_000,
      scrollTop: 0,
    });
    await flushFrames();
    expect(scroller.scrollTop).toBe(500);

    const row = container.querySelector<HTMLElement>(
      "[data-channel-scroll-row]",
    )!;
    row.getBoundingClientRect = () => ({
      bottom: 600,
      height: 100,
      left: 0,
      right: 0,
      top: 500,
      width: 0,
      x: 0,
      y: 500,
      toJSON: () => ({}),
    });
    snapshot!.controls.reportRowResize(row, 100);
    setScrollMetrics(scroller, {
      clientHeight: 500,
      scrollHeight: 1_100,
      scrollTop: 500,
    });
    snapshot!.controls.reportRowResize(row, 200);
    await flushFrames();

    expect(scroller.scrollTop).toBe(600);
    await cleanup();
  });

  it("disables bottom sticking when the user scrolls up and preserves that position", async () => {
    let snapshot: HarnessSnapshot | null = null;
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <Harness channelKey="channel-a" onSnapshot={(next) => snapshot = next} />,
    );
    const scroller = snapshot!.scroller;
    setScrollMetrics(scroller, {
      clientHeight: 500,
      scrollHeight: 1_000,
      scrollTop: 500,
    });
    await flushFrames();
    scroller.scrollTop = 200;
    snapshot!.controls.onScroll(scroller);

    const row = container.querySelector<HTMLElement>(
      "[data-channel-scroll-row]",
    )!;
    row.getBoundingClientRect = () => ({
      bottom: 600,
      height: 100,
      left: 0,
      right: 0,
      top: 500,
      width: 0,
      x: 0,
      y: 500,
      toJSON: () => ({}),
    });
    snapshot!.controls.reportRowResize(row, 100);
    setScrollMetrics(scroller, {
      clientHeight: 500,
      scrollHeight: 1_100,
      scrollTop: 200,
    });
    snapshot!.controls.reportRowResize(row, 200);
    await flushFrames();

    expect(scroller.scrollTop).toBe(200);
    expect(snapshot!.controls.isAwayFromBottom).toBe(true);
    await cleanup();
  });

  it("keeps a reader's viewport anchored when content above it grows", async () => {
    let snapshot: HarnessSnapshot | null = null;
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <Harness channelKey="channel-a" onSnapshot={(next) => snapshot = next} />,
    );
    const scroller = snapshot!.scroller;
    setScrollMetrics(scroller, {
      clientHeight: 500,
      scrollHeight: 1_000,
      scrollTop: 300,
    });
    await flushFrames();
    scroller.scrollTop = 300;
    snapshot!.controls.onScroll(scroller);

    const row = container.querySelector<HTMLElement>(
      "[data-channel-scroll-row]",
    )!;
    let rowBottom = 100;
    row.getBoundingClientRect = () => ({
      bottom: rowBottom - scroller.scrollTop,
      height: 100,
      left: 0,
      right: 0,
      top: rowBottom - scroller.scrollTop - 100,
      width: 0,
      x: 0,
      y: rowBottom - scroller.scrollTop - 100,
      toJSON: () => ({}),
    });
    snapshot!.controls.reportRowResize(row, 100);
    rowBottom = 200;
    snapshot!.controls.reportRowResize(row, 200);
    await flushFrames();

    expect(scroller.scrollTop).toBe(400);
    await cleanup();
  });

  it("re-enables bottom sticking when a different channel is selected", async () => {
    let snapshot: HarnessSnapshot | null = null;
    const { cleanup, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <Harness channelKey="channel-a" onSnapshot={(next) => snapshot = next} />,
    );
    setScrollMetrics(snapshot!.scroller, {
      clientHeight: 500,
      scrollHeight: 1_000,
      scrollTop: 0,
    });
    await flushFrames();
    snapshot!.scroller.scrollTop = 200;
    snapshot!.controls.onScroll(snapshot!.scroller);

    await renderReactTestRoot(
      root,
      <Harness channelKey="channel-b" onSnapshot={(next) => snapshot = next} />,
    );
    setScrollMetrics(snapshot!.scroller, {
      clientHeight: 500,
      scrollHeight: 1_200,
      scrollTop: 200,
    });
    await flushFrames();

    expect(snapshot!.scroller.scrollTop).toBe(700);
    expect(snapshot!.controls.stickToBottomRef.current).toBe(true);
    await cleanup();
  });
});
