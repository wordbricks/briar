import type { CollectionNavigationOrientation } from "./useControlledCollectionNavigation";
import { useAppKeyboardCommandScope } from "./appKeyboardCommands";
import { loadKeyboardNavigationPreferences } from "../lib/keybindings";
import { hasOpenKeyboardShortcutOverlay } from "../lib/keyboard-shortcuts";

export type AppCollectionKeyboardDirection =
  | "down"
  | "left"
  | "right"
  | "up";

export type AppCollectionKeyboardMoveResult = {
  readonly handled: boolean;
};

export type AppCollectionKeyboardRootRef = {
  readonly current: Element | null;
};

export type AppCollectionKeyboardCommandScopeOptions = {
  /** Whether this collection is the page's active navigation surface. */
  readonly enabled?: boolean;
  readonly id: string;
  /** Normally the stable `move` callback from controlled collection navigation. */
  readonly move: (
    direction: AppCollectionKeyboardDirection,
    invocation: { readonly repeat: boolean; readonly source: "keyboard" },
  ) => AppCollectionKeyboardMoveResult;
  readonly orientation: CollectionNavigationOrientation;
  readonly priority?: number;
  /** The element marked with `data-keyboard-list` for target ownership. */
  readonly rootRef: AppCollectionKeyboardRootRef;
};

const directionByCommand = {
  moveListDown: "down",
  moveListLeft: "left",
  moveListRight: "right",
  moveListUp: "up",
} as const;

function orientationSupportsDirection(
  orientation: CollectionNavigationOrientation,
  direction: AppCollectionKeyboardDirection,
): boolean {
  if (orientation === "both") return true;
  if (orientation === "vertical") {
    return direction === "up" || direction === "down";
  }
  return direction === "left" || direction === "right";
}

function eventTargetsAnotherCollection(
  event: KeyboardEvent | undefined,
  root: Element | null,
): boolean {
  const target = event?.target;
  const view = root?.ownerDocument.defaultView;
  const targetElement = view && target instanceof view.Element
    ? target as Element
    : view && target instanceof view.Node
    ? (target as Node).parentElement
    : null;
  if (targetElement === null) return false;
  const targetList = targetElement.closest("[data-keyboard-list]");
  return targetList !== null && targetList !== root;
}

/**
 * Registers the four app collection commands with shared ownership guards.
 *
 * The controller owns keys and mode; the collection remains the source of
 * truth for cursor/selection and receives only a serializable movement intent.
 */
export function useAppCollectionKeyboardCommandScope({
  enabled = true,
  id,
  move,
  orientation,
  priority = 200,
  rootRef,
}: AppCollectionKeyboardCommandScopeOptions): void {
  const isAvailable = (direction: AppCollectionKeyboardDirection) => {
    const root = rootRef.current;
    return enabled &&
      orientationSupportsDirection(orientation, direction) &&
      root?.isConnected === true;
  };
  const run = (
    direction: AppCollectionKeyboardDirection,
    input: { readonly nativeEvent?: KeyboardEvent; readonly repeat?: boolean },
  ) => {
    const root = rootRef.current;
    if (
      root?.isConnected !== true ||
      !loadKeyboardNavigationPreferences().sequenceShortcutsEnabled ||
      hasOpenKeyboardShortcutOverlay(root.ownerDocument) ||
      eventTargetsAnotherCollection(input.nativeEvent, root)
    ) {
      return "pass" as const;
    }
    const result = move(direction, {
      repeat: input.repeat === true,
      source: "keyboard",
    });
    return result.handled ? "handled" as const : "pass" as const;
  };

  useAppKeyboardCommandScope({
    fallthrough: true,
    handlers: {
      moveListDown: {
        isAvailable: () => isAvailable(directionByCommand.moveListDown),
        run: ({ input }) => run(directionByCommand.moveListDown, input),
      },
      moveListLeft: {
        isAvailable: () => isAvailable(directionByCommand.moveListLeft),
        run: ({ input }) => run(directionByCommand.moveListLeft, input),
      },
      moveListRight: {
        isAvailable: () => isAvailable(directionByCommand.moveListRight),
        run: ({ input }) => run(directionByCommand.moveListRight, input),
      },
      moveListUp: {
        isAvailable: () => isAvailable(directionByCommand.moveListUp),
        run: ({ input }) => run(directionByCommand.moveListUp, input),
      },
    },
    id,
    priority,
  });
}
