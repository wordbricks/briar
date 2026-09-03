import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type RefObject,
} from "react";
import type { PersistedWidth } from "../lib/persisted-width";

type HorizontalPaneResizeOptions = PersistedWidth & {
  /** CSS custom property (e.g. "--inbox-detail-pane-width") the hook writes on the container. */
  cssVariable: string;
  defaultWidth: number;
  keyboardStep?: number;
  max: number;
  min: number;
};

type HorizontalPaneResizeResult = {
  containerRef: RefObject<HTMLDivElement | null>;
  effectiveWidth: number;
  isResizing: boolean;
  separatorProps: {
    onKeyDown: KeyboardEventHandler<HTMLDivElement>;
    onPointerCancel: PointerEventHandler<HTMLDivElement>;
    onPointerDown: PointerEventHandler<HTMLDivElement>;
    onPointerMove: PointerEventHandler<HTMLDivElement>;
    onPointerUp: PointerEventHandler<HTMLDivElement>;
  };
  width: number | null;
};

/**
 * Controls a right-hand pane whose width is expressed as a percentage of its
 * container. The caller owns the separator markup so its accessible label
 * and visual treatment remain specific to the screen; the hook owns writing
 * `cssVariable` onto the container so the caller never needs an inline style
 * for it.
 *
 * While dragging, the width is written straight to the CSS custom property
 * on `pointermove` (coalesced into one write per animation frame) instead of
 * going through React state, so a drag no longer re-renders the surrounding
 * tree on every pixel of movement. React state — and persistence via `save`
 * — is committed exactly once, when the drag ends.
 */
export function useHorizontalPaneResize({
  clamp,
  cssVariable,
  defaultWidth,
  keyboardStep = 5,
  load,
  max,
  min,
  save,
}: HorizontalPaneResizeOptions): HorizontalPaneResizeResult {
  const [width, setWidth] = useState<number | null>(() => load());
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef<number | null>(width);
  const activePointerRef = useRef<number | null>(null);
  const pendingClientXRef = useRef<number | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  widthRef.current = width;

  const effectiveWidth = width ?? defaultWidth;

  // The container owns the live value of `cssVariable`. Keep it in sync with
  // committed width here so unrelated re-renders (e.g. from an ancestor)
  // never need to touch it, and so it falls back to the CSS default exactly
  // like the old inline `style` prop did.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (width === null) {
      container.style.removeProperty(cssVariable);
    } else {
      container.style.setProperty(cssVariable, `${width}%`);
    }
  }, [cssVariable, width]);

  // Discard (without applying) any frame still queued when the hook unmounts.
  useEffect(
    () => () => {
      if (pendingFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
    },
    [],
  );

  const applyPendingFrame = useCallback(() => {
    pendingFrameRef.current = null;
    const clientX = pendingClientXRef.current;
    if (clientX === null) return;
    const container = containerRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const availableWidth = Math.max(1, bounds.width);
    const paneRatio = Math.max(0, (bounds.right - clientX) / availableWidth);
    const nextWidth = clamp(paneRatio * 100);
    widthRef.current = nextWidth;
    container.style.setProperty(cssVariable, `${nextWidth}%`);
  }, [clamp, cssVariable]);

  const updateWidthFromPointer = useCallback(
    (clientX: number) => {
      pendingClientXRef.current = clientX;
      if (pendingFrameRef.current !== null) return;
      pendingFrameRef.current = window.requestAnimationFrame(applyPendingFrame);
    },
    [applyPendingFrame],
  );

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      activePointerRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);
      event.preventDefault();
    },
    [],
  );

  const onPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      if (activePointerRef.current !== event.pointerId) return;
      updateWidthFromPointer(event.clientX);
    },
    [updateWidthFromPointer],
  );

  const finishPointerResize = useCallback<
    PointerEventHandler<HTMLDivElement>
  >(
    (event) => {
      if (activePointerRef.current !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      activePointerRef.current = null;
      // pointerup/pointercancel can arrive before the browser ever runs a
      // queued frame (they aren't synchronized to animation frames), so
      // apply it synchronously here first — otherwise the drag's last few
      // pixels of movement would be silently dropped. Then drop the
      // now-redundant scheduled frame.
      if (pendingFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingFrameRef.current);
        applyPendingFrame();
      }
      pendingClientXRef.current = null;
      setIsResizing(false);
      // Commit the drag's final width to React state (and persist it) once,
      // instead of on every pointermove.
      if (widthRef.current !== null) {
        setWidth(widthRef.current);
        save(widthRef.current);
      }
    },
    [applyPendingFrame, save],
  );

  const onKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>(
    (event) => {
      let nextWidth: number | null = null;
      if (event.key === "ArrowLeft") {
        nextWidth = effectiveWidth - keyboardStep;
      } else if (event.key === "ArrowRight") {
        nextWidth = effectiveWidth + keyboardStep;
      } else if (event.key === "Home") {
        nextWidth = min;
      } else if (event.key === "End") {
        nextWidth = max;
      }
      if (nextWidth === null) return;
      event.preventDefault();
      const clampedWidth = clamp(nextWidth);
      setWidth(clampedWidth);
      widthRef.current = clampedWidth;
      save(clampedWidth);
    },
    [clamp, effectiveWidth, keyboardStep, max, min, save],
  );

  return {
    containerRef,
    effectiveWidth,
    isResizing,
    separatorProps: {
      onKeyDown,
      onPointerCancel: finishPointerResize,
      onPointerDown,
      onPointerMove,
      onPointerUp: finishPointerResize,
    },
    width,
  };
}
