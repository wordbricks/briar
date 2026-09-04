import {
  Activity,
  useCallback,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";

/*
  One kept page's slot.

  The mechanism is React's own `<Activity>`: hidden content keeps its state and
  its DOM, and loses its effects. That last half is what makes keeping a page
  alive safe here rather than a source of ghosts — a hidden page unregisters its
  keyboard scope, stops subscribing to its atoms, drops its intervals and its
  listeners, exactly as an unmount would. It is also why nothing had to be
  re-plumbed page by page: "gate this effect on visibility" is what `<Activity>`
  already does to every effect underneath it.

  Two things it does not do, which this slot adds:

  - **Props stop reaching a hidden page.** `<Activity>` still re-renders hidden
    children when the parent renders, so a board kept under `board:teamA` would
    quietly redraw itself with team B's props while the user is on team B. The
    slot freezes the element it was last given while visible, and an unchanged
    element is a render React skips outright.
  - **Scroll survives.** Hiding sets `display:none`, which destroys the layout
    box and with it every scroll offset inside. The slot records offsets as they
    happen, from a capture listener that sees the whole subtree, and replays
    them the moment the page comes back. That is the point of the whole feature
    from where the user sits: the list is where they left it.

  The wrapper is `display:contents`, so the page below it stays a direct flex
  child of the content surface exactly as it was before there was a slot. React
  writes `display:none` on it to hide it, which wins over the class, and clears
  the inline value to show it, which gives the class back.
*/

interface ScrollPosition {
  readonly left: number;
  readonly top: number;
}

export interface KeepAliveSlotProps {
  readonly children: ReactNode;
  /** The kept page key, for tests and for devtools. */
  readonly pageKey: string;
  readonly visible: boolean;
}

export function KeepAliveSlot({
  children,
  pageKey,
  visible,
}: KeepAliveSlotProps) {
  /*
    The last children this slot was given while it was on screen. Assigning
    during render is what keeps it in step with the render that produced it: an
    effect would publish one commit late, and the hidden page would have redrawn
    with the new props by then.
  */
  const shown = useRef<ReactNode>(children);
  if (visible) shown.current = children;

  const positions = useRef<Map<Element, ScrollPosition>>(new Map());

  const record = useCallback((event: Event) => {
    const target = event.target;
    if (target instanceof Element) {
      positions.current.set(target, {
        left: target.scrollLeft,
        top: target.scrollTop,
      });
    }
  }, []);

  /*
    A capture listener, because `scroll` does not bubble: this is the only way
    one node above the page hears every scroller inside it without the pages
    having to declare which of their elements scroll.
  */
  const attachHost = useCallback(
    (host: HTMLDivElement | null) => {
      if (host === null) return;
      host.addEventListener("scroll", record, true);
      return () => host.removeEventListener("scroll", record, true);
    },
    [record],
  );

  useLayoutEffect(() => {
    if (!visible) return;
    for (const [element, position] of positions.current) {
      if (!element.isConnected) {
        positions.current.delete(element);
        continue;
      }
      element.scrollTop = position.top;
      element.scrollLeft = position.left;
    }
  }, [visible]);

  return (
    <Activity mode={visible ? "visible" : "hidden"} name={pageKey}>
      <div
        className="page-slot"
        data-page-slot={pageKey}
        inert={!visible}
        ref={attachHost}
      >
        {shown.current}
      </div>
    </Activity>
  );
}
