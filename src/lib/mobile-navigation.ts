export const mobileNavigationBackEvent = "briar-navigation-back";

export type MobileBackHandler = () => boolean;

type MobileBackHandlerEntry = {
  handler: MobileBackHandler;
  id: number;
  priority: number;
};

export type MobileBackSwipe = {
  elapsedMs: number;
  endX: number;
  endY: number;
  startX: number;
  startY: number;
};

const edgeWidth = 32;
const minimumHorizontalTravel = 72;
const maximumDuration = 700;
let nextHandlerId = 0;
const backHandlers = new Map<number, MobileBackHandlerEntry>();

export function isMobileBackSwipe(gesture: MobileBackSwipe) {
  const horizontalTravel = gesture.endX - gesture.startX;
  const verticalTravel = Math.abs(gesture.endY - gesture.startY);

  return (
    gesture.startX >= 0 &&
    gesture.startX <= edgeWidth &&
    gesture.elapsedMs >= 0 &&
    gesture.elapsedMs <= maximumDuration &&
    horizontalTravel >= minimumHorizontalTravel &&
    horizontalTravel >= verticalTravel * 1.5
  );
}

export function registerMobileBackHandler(
  handler: MobileBackHandler,
  priority = 0,
) {
  const id = nextHandlerId++;
  backHandlers.set(id, { handler, id, priority });

  return () => {
    backHandlers.delete(id);
  };
}

export function requestMobileNavigationBack() {
  const orderedHandlers = [...backHandlers.values()].sort(
    (left, right) =>
      right.priority - left.priority || right.id - left.id,
  );
  for (const entry of orderedHandlers) {
    if (entry.handler()) return true;
  }
  return false;
}
