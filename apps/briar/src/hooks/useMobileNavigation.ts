import { useEffect, useRef } from "react";
import {
  isMobileBackSwipe,
  mobileNavigationBackEvent,
  registerMobileBackHandler,
  requestMobileNavigationBack,
  type MobileBackHandler,
} from "../lib/mobile-navigation";

export function useMobileBackHandler(
  handler: MobileBackHandler,
  {
    enabled,
    priority = 0,
  }: {
    enabled: boolean;
    priority?: number;
  },
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return registerMobileBackHandler(() => handlerRef.current(), priority);
  }, [enabled, priority]);
}

export function useMobileNavigationGestures(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    let gestureStart: {
      identifier: number;
      startedAt: number;
      x: number;
      y: number;
    } | null = null;

    const handleNativeBack = (event: Event) => {
      if (requestMobileNavigationBack()) event.preventDefault();
    };
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        gestureStart = null;
        return;
      }
      const touch = event.touches[0];
      gestureStart = {
        identifier: touch.identifier,
        startedAt: performance.now(),
        x: touch.clientX,
        y: touch.clientY,
      };
    };
    const handleTouchEnd = (event: TouchEvent) => {
      const start = gestureStart;
      gestureStart = null;
      if (!start) return;
      const touch = [...event.changedTouches].find(
        (candidate) => candidate.identifier === start.identifier,
      );
      if (
        touch &&
        isMobileBackSwipe({
          elapsedMs: performance.now() - start.startedAt,
          endX: touch.clientX,
          endY: touch.clientY,
          startX: start.x,
          startY: start.y,
        })
      ) {
        requestMobileNavigationBack();
      }
    };
    const cancelTouch = () => {
      gestureStart = null;
    };

    window.addEventListener(mobileNavigationBackEvent, handleNativeBack);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", cancelTouch, { passive: true });
    return () => {
      window.removeEventListener(mobileNavigationBackEvent, handleNativeBack);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", cancelTouch);
    };
  }, [enabled]);
}
