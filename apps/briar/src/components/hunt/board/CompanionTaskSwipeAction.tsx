import { Play } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement, type PointerEvent as ReactPointerEvent } from "react";
import { useI18n } from "@/i18n";
export const companionSwipeActionWidth = 72;
export const companionSwipeOpenThreshold = 44;
export function CompanionTaskSwipeAction({
  children,
  disabled,
  enabled,
  onProcessNow
}: {
  children: ReactElement;
  disabled: boolean;
  enabled: boolean;
  onProcessNow: () => void;
}) {
  const {
    t
  } = useI18n();
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const gestureRef = useRef<{
    axis: "pending" | "horizontal" | "vertical";
    origin: number;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  useEffect(() => {
    if (!enabled) setOffset(0);
  }, [enabled]);
  if (!enabled) return children;
  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setIsDragging(false);
    if (gesture.axis !== "horizontal") return;
    event.preventDefault();
    suppressClickRef.current = true;
    setOffset(current => current >= companionSwipeOpenThreshold ? companionSwipeActionWidth : 0);
  };
  const cancelGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setIsDragging(false);
    setOffset(gesture.origin);
  };
  return <div className={`companion-task-swipe${offset > 0 ? " open" : ""}${isDragging ? " dragging" : ""}`} onClickCapture={event => {
    if ((event.target as Element).closest(".companion-task-swipe-action")) {
      suppressClickRef.current = false;
      return;
    }
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }} onPointerCancel={cancelGesture} onPointerDown={event => {
    if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest(".companion-task-swipe-action")) return;
    gestureRef.current = {
      axis: "pending",
      origin: offset,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }} onPointerMove={event => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    if (gesture.axis === "pending" && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 6) {
      gesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
    }
    if (gesture.axis !== "horizontal") return;
    event.preventDefault();
    setIsDragging(true);
    setOffset(Math.min(companionSwipeActionWidth, Math.max(0, gesture.origin - deltaX)));
  }} onPointerUp={finishGesture}>
      <button aria-hidden={offset < companionSwipeOpenThreshold} aria-label={t("issue.processNow")} className="companion-task-swipe-action" disabled={disabled} onClick={() => {
      setOffset(0);
      onProcessNow();
    }} tabIndex={offset >= companionSwipeOpenThreshold ? 0 : -1} type="button">
        <Play aria-hidden="true" fill="currentColor" size={22} />
      </button>
      <div className="companion-task-swipe-content" style={{
      transform: `translateX(${-offset}px)`
    }}>
        {children}
      </div>
    </div>;
}
