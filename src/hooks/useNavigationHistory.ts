import { useCallback, useReducer } from "react";

export type NavigationHistory<T> = {
  entries: T[];
  index: number;
};

type NavigationAction<T> =
  | { type: "navigate"; value: T }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reset"; value: T };

export function createNavigationHistory<T>(initial: T): NavigationHistory<T> {
  return { entries: [initial], index: 0 };
}

export function reduceNavigationHistory<T>(
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
  if (Object.is(state.entries[state.index], action.value)) return state;
  return {
    entries: [...state.entries.slice(0, state.index + 1), action.value],
    index: state.index + 1,
  };
}

export function useNavigationHistory<T>(initial: T) {
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
    reset,
  };
}
