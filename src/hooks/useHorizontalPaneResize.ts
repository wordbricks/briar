import {
  useCallback,
  useRef,
  useState,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type RefObject,
} from "react";
import type { PersistedWidth } from "../lib/persisted-width";

type HorizontalPaneResizeOptions = PersistedWidth & {
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
 * container. The caller owns the separator markup and CSS variable so its
 * accessible label and visual treatment remain specific to the screen.
 */
export function useHorizontalPaneResize({
  clamp,
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
  widthRef.current = width;

  const effectiveWidth = width ?? defaultWidth;

  const updateWidthFromPointer = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const availableWidth = Math.max(1, bounds.width);
      const paneRatio = Math.max(0, (bounds.right - clientX) / availableWidth);
      const nextWidth = clamp(paneRatio * 100);
      setWidth(nextWidth);
      widthRef.current = nextWidth;
    },
    [clamp],
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
      setIsResizing(false);
      if (widthRef.current !== null) save(widthRef.current);
    },
    [save],
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
