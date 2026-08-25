import { useCallback, useReducer } from "react";

export type NavigationHistory<T extends string> = {
  entries: T[];
  index: number;
};

export const maxNavigationHistoryEntries = 100;

type NavigationAction<T extends string> =
  | { type: "navigate"; value: T }
  | { type: "back" }
  | { type: "forward" }
  | { type: "replace"; value: T }
  | { type: "reset"; value: T };

export function createNavigationHistory<T extends string>(
  initial: T,
): NavigationHistory<T> {
  return { entries: [initial], index: 0 };
}

export function reduceNavigationHistory<T extends string>(
  state: NavigationHistory<T>,
  action: NavigationAction<T>,
): NavigationHistory<T> {
  if (action.type === "back") {
    return state.index === 0 ? state : { ...state, index: state.index - 1 };
  }
  if (action.type === "forward") {
    return state.index === state.entries.length - 1
      ? state
      : { ...state, index: state.index + 1 };
  }
  if (action.type === "reset") {
    return createNavigationHistory(action.value);
  }
  if (action.type === "replace") {
    if (Object.is(state.entries[state.index], action.value)) return state;
    const entries = [...state.entries];
    entries[state.index] = action.value;
    let index = state.index;
    while (index > 0 && Object.is(entries[index - 1], entries[index])) {
      entries.splice(index, 1);
      index -= 1;
    }
    while (
      index < entries.length - 1 &&
      Object.is(entries[index], entries[index + 1])
    ) {
      entries.splice(index + 1, 1);
    }
    return { entries, index };
  }
  if (Object.is(state.entries[state.index], action.value)) return state;
  const entries = [...state.entries.slice(0, state.index + 1), action.value];
  if (entries.length > maxNavigationHistoryEntries) {
    return {
      entries: entries.slice(-maxNavigationHistoryEntries),
      index: maxNavigationHistoryEntries - 1,
    };
  }
  return {
    entries,
    index: state.index + 1,
  };
}

export function useNavigationHistory<T extends string>(initial: T) {
  const [history, dispatch] = useReducer(
    reduceNavigationHistory<T>,
    initial,
    createNavigationHistory,
  );
  const navigate = useCallback(
    (value: T) => dispatch({ type: "navigate", value }),
    [],
  );
  const goBack = useCallback(() => dispatch({ type: "back" }), []);
  const goForward = useCallback(() => dispatch({ type: "forward" }), []);
  const replace = useCallback(
    (value: T) => dispatch({ type: "replace", value }),
    [],
  );
  const reset = useCallback(
    (value: T) => dispatch({ type: "reset", value }),
    [],
  );

  return {
    current: history.entries[history.index],
    canGoBack: history.index > 0,
    canGoForward: history.index < history.entries.length - 1,
    navigate,
    goBack,
    goForward,
    replace,
    reset,
  };
}
