import { useCallback, useReducer } from "react";

export type NavigationHistory<T extends string> = {
  entries: T[];
  index: number;
};

export const maxNavigationHistoryEntries = 100;

type NavigationAction<T extends string> =
  | { type: "navigate"; value: T }
  | { type: "back" }
  | { type: "backTo"; predicate: (value: T) => boolean; fallback?: T }
  | { type: "forward" }
  | { type: "goTo"; index: number }
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
  if (action.type === "backTo") {
    for (let index = state.index - 1; index >= 0; index -= 1) {
      const entry = state.entries[index];
      if (entry !== undefined && action.predicate(entry)) {
        return { ...state, index };
      }
    }
    return action.fallback === undefined
      ? state
      : createNavigationHistory(action.fallback);
  }
  if (action.type === "forward") {
    return state.index === state.entries.length - 1
      ? state
      : { ...state, index: state.index + 1 };
  }
  if (action.type === "goTo") {
    return Number.isInteger(action.index) &&
        action.index >= 0 &&
        action.index < state.entries.length &&
        action.index !== state.index
      ? { ...state, index: action.index }
      : state;
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
  const goBackTo = useCallback(
    (predicate: (value: T) => boolean, fallback?: T) => {
      dispatch(
        fallback === undefined
          ? { type: "backTo", predicate }
          : { type: "backTo", predicate, fallback },
      );
    },
    [],
  );
  const goForward = useCallback(() => dispatch({ type: "forward" }), []);
  const goTo = useCallback(
    (index: number) => dispatch({ type: "goTo", index }),
    [],
  );
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
    entries: history.entries,
    index: history.index,
    canGoBack: history.index > 0,
    canGoForward: history.index < history.entries.length - 1,
    navigate,
    goBack,
    goBackTo,
    goForward,
    goTo,
    replace,
    reset,
  };
}
