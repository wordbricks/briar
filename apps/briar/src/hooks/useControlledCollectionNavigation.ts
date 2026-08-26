import {
  useCallback,
  useLayoutEffect,
  useRef,
  type RefCallback,
} from "react";

export type CollectionNavigationDirection =
  | "next"
  | "previous"
  | "up"
  | "down"
  | "left"
  | "right";

export type CollectionNavigationOrientation =
  | "vertical"
  | "horizontal"
  | "both";

export type CollectionSelectionBehavior = "follow-cursor" | "manual";

export type CollectionNavigationSource =
  | "keyboard"
  | "pointer"
  | "programmatic";

export type CollectionNavigationInvocation = {
  readonly repeat?: boolean;
  readonly source?: CollectionNavigationSource;
};

export type CollectionNavigationChange<Id extends string> = {
  readonly direction: CollectionNavigationDirection | null;
  readonly id: Id;
  readonly reason: "move" | "activate";
  readonly repeat: boolean;
  readonly source: CollectionNavigationSource;
};

export type CollectionNavigationResolverContext<Id extends string> = {
  readonly currentId: Id | null;
  readonly currentIndex: number;
  readonly direction: CollectionNavigationDirection;
  readonly itemIds: readonly Id[];
  readonly selectedId: Id | null;
};

export type CollectionNavigationResult<Id extends string> =
  | {
    readonly handled: false;
    readonly id: null;
    readonly status: "empty" | "unsupported";
  }
  | {
    readonly handled: true;
    readonly id: Id;
    readonly status: "activated" | "clamped" | "moved";
  };

type CollectionNavigationStrategy<Id extends string> =
  | {
    readonly orientation?: "vertical" | "horizontal";
    readonly resolveNextId?: (
      context: CollectionNavigationResolverContext<Id>,
    ) => Id | null;
  }
  | {
    readonly orientation: "both";
    readonly resolveNextId: (
      context: CollectionNavigationResolverContext<Id>,
    ) => Id | null;
  };

export type ControlledCollectionNavigationOptions<Id extends string> =
  CollectionNavigationStrategy<Id> & {
    /** Stable IDs in the consumer's current visual navigation order. */
    readonly itemIds: readonly Id[];
    /** Controlled keyboard cursor. It remains authoritative when DOM focus leaves. */
    readonly cursorId: Id | null;
    /** Controlled selection or preview ID, intentionally separate from cursor. */
    readonly selectedId: Id | null;
    readonly selectionBehavior: CollectionSelectionBehavior;
    readonly onActivate?: (
      id: Id,
      change: CollectionNavigationChange<Id>,
    ) => void;
    readonly onCursorIdChange: (
      id: Id,
      change: CollectionNavigationChange<Id>,
    ) => void;
    readonly onSelectedIdChange?: (
      id: Id,
      change: CollectionNavigationChange<Id>,
    ) => void;
    /** Set false for virtual-focus widgets such as aria-activedescendant lists. */
    readonly projectDomFocus?: boolean;
    readonly scrollIntoView?: boolean | ScrollIntoViewOptions;
  };

export type ControlledCollectionNavigation<
  Id extends string,
  ElementType extends HTMLElement,
> = {
  /** Explicit activation command, normally Enter or Space. */
  readonly activate: (
    invocation?: CollectionNavigationInvocation,
  ) => CollectionNavigationResult<Id>;
  /** Projects the controlled cursor (or selected fallback) into DOM focus. */
  readonly focusCursor: () => boolean;
  /** Returns a stable callback ref for one item ID. */
  readonly getItemRef: (id: Id) => RefCallback<ElementType>;
  /** Directional command. Repeated invocations are intentionally accepted. */
  readonly move: (
    direction: CollectionNavigationDirection,
    invocation?: CollectionNavigationInvocation,
  ) => CollectionNavigationResult<Id>;
};

const emptyResult = {
  handled: false,
  id: null,
  status: "empty",
} as const;

const unsupportedResult = {
  handled: false,
  id: null,
  status: "unsupported",
} as const;

function invocationDetails(
  invocation: CollectionNavigationInvocation | undefined,
) {
  return {
    repeat: invocation?.repeat === true,
    source: invocation?.source ?? "keyboard",
  } as const;
}

function resolveCurrentId<Id extends string>(
  itemIds: readonly Id[],
  cursorId: Id | null,
  selectedId: Id | null,
): Id | null {
  if (cursorId !== null && itemIds.includes(cursorId)) return cursorId;
  if (selectedId !== null && itemIds.includes(selectedId)) return selectedId;
  return null;
}

function directionDelta(
  direction: CollectionNavigationDirection,
  orientation: CollectionNavigationOrientation,
): -1 | 1 | null {
  if (direction === "next") return 1;
  if (direction === "previous") return -1;
  if (orientation === "vertical") {
    if (direction === "down") return 1;
    if (direction === "up") return -1;
    return null;
  }
  if (orientation === "horizontal") {
    if (direction === "right") return 1;
    if (direction === "left") return -1;
  }
  return null;
}

function defaultNextId<Id extends string>(
  context: CollectionNavigationResolverContext<Id>,
  orientation: CollectionNavigationOrientation,
): Id | null {
  const delta = directionDelta(context.direction, orientation);
  if (delta === null) return null;
  if (context.currentIndex < 0) {
    return delta > 0
      ? context.itemIds[0] ?? null
      : context.itemIds.at(-1) ?? null;
  }
  const nextIndex = Math.min(
    context.itemIds.length - 1,
    Math.max(0, context.currentIndex + delta),
  );
  return context.itemIds[nextIndex] ?? null;
}

/**
 * Controlled collection navigation for command-driven React surfaces.
 *
 * The hook never infers state from `document.activeElement` and never calls
 * `element.click()`. Consumers own cursor and selection state, while callback
 * refs project an accepted command into focus and scroll after React commits.
 */
export function useControlledCollectionNavigation<
  Id extends string,
  ElementType extends HTMLElement = HTMLElement,
>(
  options: ControlledCollectionNavigationOptions<Id>,
): ControlledCollectionNavigation<Id, ElementType> {
  const itemIdsRef = useRef(options.itemIds);
  const cursorIdRef = useRef(options.cursorId);
  const selectedIdRef = useRef(options.selectedId);
  const optionsRef = useRef(options);
  itemIdsRef.current = options.itemIds;
  cursorIdRef.current = options.cursorId;
  selectedIdRef.current = options.selectedId;
  optionsRef.current = options;

  const itemElementsRef = useRef(new Map<Id, ElementType>());
  const itemRefCallbacksRef = useRef(
    new Map<Id, RefCallback<ElementType>>(),
  );
  const pendingFocusIdRef = useRef<Id | null>(null);

  const projectFocus = useCallback((id: Id, element: ElementType) => {
    if (optionsRef.current.projectDomFocus === false) {
      if (pendingFocusIdRef.current === id) pendingFocusIdRef.current = null;
      return false;
    }
    if (!element.isConnected) return false;
    element.focus({ preventScroll: true });
    const scrollOption = optionsRef.current.scrollIntoView;
    if (scrollOption !== false) {
      element.scrollIntoView?.(
        typeof scrollOption === "object"
          ? scrollOption
          : { block: "nearest", inline: "nearest" },
      );
    }
    const focused = element.ownerDocument.activeElement === element;
    if (focused && pendingFocusIdRef.current === id) {
      pendingFocusIdRef.current = null;
    }
    return focused;
  }, []);

  const requestFocus = useCallback((id: Id) => {
    if (optionsRef.current.projectDomFocus === false) {
      pendingFocusIdRef.current = null;
      return false;
    }
    pendingFocusIdRef.current = id;
    const element = itemElementsRef.current.get(id);
    return element ? projectFocus(id, element) : false;
  }, [projectFocus]);

  const getItemRef = useCallback((id: Id): RefCallback<ElementType> => {
    const existing = itemRefCallbacksRef.current.get(id);
    if (existing) return existing;

    let currentElement: ElementType | null = null;
    const itemRef: RefCallback<ElementType> = (element) => {
      if (
        currentElement !== null &&
        itemElementsRef.current.get(id) === currentElement
      ) {
        itemElementsRef.current.delete(id);
      }
      currentElement = element;
      if (element === null) return;
      itemElementsRef.current.set(id, element);
      if (pendingFocusIdRef.current === id) projectFocus(id, element);
    };
    itemRefCallbacksRef.current.set(id, itemRef);
    return itemRef;
  }, [projectFocus]);

  useLayoutEffect(() => {
    const itemIdSet = new Set(itemIdsRef.current);
    for (const id of itemRefCallbacksRef.current.keys()) {
      if (!itemIdSet.has(id)) itemRefCallbacksRef.current.delete(id);
    }
    const pendingId = pendingFocusIdRef.current;
    if (pendingId === null) return;
    if (!itemIdSet.has(pendingId)) {
      pendingFocusIdRef.current = null;
      return;
    }
    const element = itemElementsRef.current.get(pendingId);
    if (element) projectFocus(pendingId, element);
  });

  const move = useCallback((
    direction: CollectionNavigationDirection,
    invocation?: CollectionNavigationInvocation,
  ): CollectionNavigationResult<Id> => {
    const itemIds = itemIdsRef.current;
    if (itemIds.length === 0) return emptyResult;

    const currentId = resolveCurrentId(
      itemIds,
      cursorIdRef.current,
      selectedIdRef.current,
    );
    const currentIndex = currentId === null ? -1 : itemIds.indexOf(currentId);
    const currentOptions = optionsRef.current;
    const orientation = currentOptions.orientation ?? "vertical";
    const resolverContext: CollectionNavigationResolverContext<Id> = {
      currentId,
      currentIndex,
      direction,
      itemIds,
      selectedId: selectedIdRef.current,
    };
    const nextId = currentOptions.resolveNextId
      ? currentOptions.resolveNextId(resolverContext)
      : defaultNextId(resolverContext, orientation);
    if (nextId === null || !itemIds.includes(nextId)) {
      return unsupportedResult;
    }

    if (nextId === currentId) {
      requestFocus(nextId);
      return { handled: true, id: nextId, status: "clamped" };
    }

    const details = invocationDetails(invocation);
    const change: CollectionNavigationChange<Id> = {
      direction,
      id: nextId,
      reason: "move",
      repeat: details.repeat,
      source: details.source,
    };
    cursorIdRef.current = nextId;
    currentOptions.onCursorIdChange(nextId, change);
    if (
      currentOptions.selectionBehavior === "follow-cursor" &&
      selectedIdRef.current !== nextId
    ) {
      selectedIdRef.current = nextId;
      currentOptions.onSelectedIdChange?.(nextId, change);
    }
    requestFocus(nextId);
    return { handled: true, id: nextId, status: "moved" };
  }, [requestFocus]);

  const activate = useCallback((
    invocation?: CollectionNavigationInvocation,
  ): CollectionNavigationResult<Id> => {
    const itemIds = itemIdsRef.current;
    if (itemIds.length === 0) return emptyResult;
    const currentOptions = optionsRef.current;
    const id = resolveCurrentId(
      itemIds,
      cursorIdRef.current,
      selectedIdRef.current,
    ) ?? itemIds[0];
    if (id === undefined) return emptyResult;

    const details = invocationDetails(invocation);
    const change: CollectionNavigationChange<Id> = {
      direction: null,
      id,
      reason: "activate",
      repeat: details.repeat,
      source: details.source,
    };
    if (cursorIdRef.current !== id) {
      cursorIdRef.current = id;
      currentOptions.onCursorIdChange(id, change);
    }
    if (selectedIdRef.current !== id) {
      selectedIdRef.current = id;
      currentOptions.onSelectedIdChange?.(id, change);
    }
    requestFocus(id);
    currentOptions.onActivate?.(id, change);
    return { handled: true, id, status: "activated" };
  }, [requestFocus]);

  const focusCursor = useCallback(() => {
    const itemIds = itemIdsRef.current;
    const id = resolveCurrentId(
      itemIds,
      cursorIdRef.current,
      selectedIdRef.current,
    ) ?? itemIds[0];
    return id === undefined ? false : requestFocus(id);
  }, [requestFocus]);

  return { activate, focusCursor, getItemRef, move };
}
