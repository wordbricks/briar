import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  conversationIsAwayFromBottom,
} from "../lib/conversation-scroll";
import { scrollContainerToEnd } from "../lib/scroll-container";

export type ChannelScrollStabilityOptions = {
  channelKey: string | null;
  scrollerRef: RefObject<HTMLElement | null>;
  rowContainerRef?: RefObject<HTMLElement | null>;
  rowCount?: number;
  rowSelector?: string;
  observeRows?: boolean;
};

export type ChannelScrollRowResize = (
  element: HTMLElement,
  height: number,
  previousHeight?: number,
) => void;

export type ChannelScrollRowMeasurement = {
  element: HTMLElement;
  height: number;
  previousHeight?: number;
};

export type ChannelScrollRowsResize = (
  rows: readonly ChannelScrollRowMeasurement[],
) => void;

const rowContentBottom = (row: HTMLElement, scroller: HTMLElement) => {
  const rowRect = row.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  return rowRect.bottom - scrollerRect.top + scroller.scrollTop;
};

const conversationIsAtBottom = (scroller: HTMLElement) =>
  scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 1;

export function resizeObserverEntryHeight(entry: ResizeObserverEntry) {
  const borderBox = entry.borderBoxSize;
  const borderBoxHeight = Array.isArray(borderBox)
    ? borderBox[0]?.blockSize
    : (borderBox as unknown as ResizeObserverSize | undefined)?.blockSize;
  return borderBoxHeight ?? entry.contentRect.height;
}

export function useChannelScrollStability({
  channelKey,
  scrollerRef,
  rowContainerRef,
  rowCount = 0,
  rowSelector = "[data-channel-scroll-row]",
  observeRows = false,
}: ChannelScrollStabilityOptions) {
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  const stickToBottomRef = useRef(false);
  const correctionFrameRef = useRef<number | null>(null);
  const pendingScrollAdjustmentRef = useRef(0);
  const rowHeightsRef = useRef(new Map<HTMLElement, number>());
  const rowBottomsRef = useRef(new Map<HTMLElement, number>());

  const scheduleCorrection = useCallback(() => {
    if (correctionFrameRef.current !== null || typeof window === "undefined") {
      return;
    }
    correctionFrameRef.current = window.requestAnimationFrame(() => {
      correctionFrameRef.current = null;
      const scroller = scrollerRef.current;
      if (!scroller) {
        pendingScrollAdjustmentRef.current = 0;
        return;
      }
      if (stickToBottomRef.current) {
        pendingScrollAdjustmentRef.current = 0;
        scrollContainerToEnd(scroller);
        return;
      }
      const adjustment = pendingScrollAdjustmentRef.current;
      pendingScrollAdjustmentRef.current = 0;
      if (adjustment !== 0) {
        scroller.scrollTop += adjustment;
      }
    });
  }, [scrollerRef]);

  useLayoutEffect(() => {
    stickToBottomRef.current = Boolean(channelKey);
    pendingScrollAdjustmentRef.current = 0;
    rowHeightsRef.current.clear();
    rowBottomsRef.current.clear();
    if (correctionFrameRef.current !== null) {
      window.cancelAnimationFrame(correctionFrameRef.current);
      correctionFrameRef.current = null;
    }
    setIsAwayFromBottom(false);
    if (channelKey) scheduleCorrection();
  }, [channelKey, scheduleCorrection]);

  useLayoutEffect(
    () => () => {
      if (correctionFrameRef.current !== null) {
        window.cancelAnimationFrame(correctionFrameRef.current);
      }
    },
    [],
  );

  const setStickToBottom = useCallback(
    (next: boolean) => {
      stickToBottomRef.current = next;
      pendingScrollAdjustmentRef.current = 0;
      if (next) {
        setIsAwayFromBottom(false);
        scheduleCorrection();
        return;
      }
      const scroller = scrollerRef.current;
      if (scroller) {
        setIsAwayFromBottom(conversationIsAwayFromBottom(scroller));
      }
    },
    [scheduleCorrection, scrollerRef],
  );

  const requestStickToBottom = useCallback(() => {
    setStickToBottom(true);
  }, [setStickToBottom]);

  const requestStickToBottomIfAtBottom = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || conversationIsAtBottom(scroller)) {
      requestStickToBottom();
    }
  }, [requestStickToBottom, scrollerRef]);

  const onScroll = useCallback((scroller: HTMLElement) => {
    pendingScrollAdjustmentRef.current = 0;
    const away = conversationIsAwayFromBottom(scroller);
    stickToBottomRef.current = conversationIsAtBottom(scroller);
    setIsAwayFromBottom((current) => current === away ? current : away);
  }, []);

  const restoreScrollTop = useCallback(
    (scrollTop: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      pendingScrollAdjustmentRef.current = 0;
      scroller.scrollTop = scrollTop;
      for (const row of rowHeightsRef.current.keys()) {
        rowBottomsRef.current.set(row, rowContentBottom(row, scroller));
      }
      setIsAwayFromBottom(conversationIsAwayFromBottom(scroller));
    },
    [scrollerRef],
  );

  const scrollToBottom = useCallback(() => {
    requestStickToBottom();
  }, [requestStickToBottom]);

  const reportRowsResize = useCallback<ChannelScrollRowsResize>(
    (rows: readonly ChannelScrollRowMeasurement[]) => {
      const scroller = scrollerRef.current;
      const changes: Array<{
        element: HTMLElement;
        height: number;
        previousHeight: number | undefined;
        previousBottom: number | undefined;
      }> = [];
      for (const row of rows) {
        if (!Number.isFinite(row.height) || row.height <= 0) continue;
        const previousHeight = row.previousHeight ??
          rowHeightsRef.current.get(row.element);
        changes.push({
          element: row.element,
          height: row.height,
          previousHeight,
          previousBottom: rowBottomsRef.current.get(row.element),
        });
        rowHeightsRef.current.set(row.element, row.height);
      }
      if (!scroller) return;

      let pendingAdjustment = 0;
      let shouldStick = false;
      for (const change of changes) {
        if (change.previousHeight === undefined) continue;
        const delta = change.height - change.previousHeight;
        if (Math.abs(delta) < 1) continue;
        if (stickToBottomRef.current) {
          shouldStick = true;
          continue;
        }
        const wasAboveViewport =
          change.previousBottom !== undefined
            ? change.previousBottom <= scroller.scrollTop + 1
            : change.element.getBoundingClientRect().bottom <=
              scroller.getBoundingClientRect().top + 1;
        if (wasAboveViewport) pendingAdjustment += delta;
      }
      for (const row of rowHeightsRef.current.keys()) {
        rowBottomsRef.current.set(row, rowContentBottom(row, scroller));
      }
      if (shouldStick) {
        pendingScrollAdjustmentRef.current = 0;
        scheduleCorrection();
      } else if (pendingAdjustment !== 0) {
        pendingScrollAdjustmentRef.current += pendingAdjustment;
        scheduleCorrection();
      }
    },
    [scheduleCorrection, scrollerRef],
  );

  const reportRowResize = useCallback<ChannelScrollRowResize>(
    (element, height, previousHeight) => {
      reportRowsResize([{ element, height, previousHeight }]);
    },
    [reportRowsResize],
  );

  useLayoutEffect(() => {
    if (!observeRows || !rowContainerRef?.current) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      reportRowsResize(entries.map((entry) => ({
        element: entry.target as HTMLElement,
        height: resizeObserverEntryHeight(entry),
      })));
    });
    const rows = rowContainerRef.current.querySelectorAll<HTMLElement>(
      rowSelector,
    );
    for (const row of rows) observer.observe(row);
    return () => observer.disconnect();
  }, [
    observeRows,
    reportRowsResize,
    rowContainerRef,
    rowCount,
    rowSelector,
  ]);

  return {
    isAwayFromBottom,
    onScroll,
    reportRowResize,
    reportRowsResize,
    requestStickToBottom,
    requestStickToBottomIfAtBottom,
    restoreScrollTop,
    scrollToBottom,
    setStickToBottom,
    stickToBottomRef,
  };
}
