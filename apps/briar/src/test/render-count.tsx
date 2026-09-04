import {
  createElement,
  Profiler,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { expect } from "vitest";

/**
 * Named render tallies for subscription-boundary tests. The point of those
 * tests is that a state change reaches only the components subscribed to it,
 * which is only observable by counting renders, so the counters live in one
 * place and are asserted as a whole map.
 */
export interface RenderCounter {
  /** Every counter recorded so far, as a plain snapshot. */
  readonly counts: () => Readonly<Record<string, number>>;
  /** How many times `name` has rendered. Unseen names read as 0. */
  readonly count: (name: string) => number;
  /**
   * Counts one render of `name` and returns `value` unchanged, for render-prop
   * callbacks that have no component body to hold a hook.
   */
  readonly record: <A>(name: string, value: A) => A;
  /** Counts one render of `name` from inside a component body. */
  readonly useRenderCount: (name: string) => void;
  /** Wraps a component so every render of the wrapper counts under `name`. */
  readonly track: <Props extends object>(
    name: string,
    Component: ComponentType<Props>,
  ) => ComponentType<Props>;
  /**
   * Counts every commit `children` takes part in, which is the only way to see
   * a render an atom pushed **into** a component rather than through its props.
   * {@link track} cannot: its wrapper re-renders only when a parent hands it
   * new props, so a subscribing component under it can render all it likes
   * without the wrapper noticing.
   *
   * It counts the whole subtree, so a count of zero means "nothing in here
   * rendered" — exactly the assertion a subscription boundary needs — while a
   * positive count says only that something inside did.
   */
  readonly profile: (name: string, children: ReactNode) => ReactElement;
  /** Forgets every counter, e.g. between the phases of one test. */
  readonly reset: () => void;
  /**
   * Asserts the counters are exactly `expected`. Comparing the whole map keeps
   * a test from passing while a component nobody listed started rendering.
   */
  readonly expectRenderCounts: (
    expected: Readonly<Record<string, number>>,
  ) => void;
}

export function createRenderCounter(): RenderCounter {
  const counts = new Map<string, number>();

  const increment = (name: string) => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  };

  const snapshot = () => Object.fromEntries(counts);

  function track<Props extends object>(
    name: string,
    Component: ComponentType<Props>,
  ): ComponentType<Props> {
    function RenderCounted(props: Props) {
      increment(name);
      return createElement(Component, props);
    }
    RenderCounted.displayName = `RenderCounted(${name})`;
    return RenderCounted;
  }

  function record<A>(name: string, value: A): A {
    increment(name);
    return value;
  }

  function profile(name: string, children: ReactNode): ReactElement {
    return createElement(
      Profiler,
      { id: name, onRender: () => increment(name) },
      children,
    );
  }

  return {
    count(name) {
      return counts.get(name) ?? 0;
    },
    counts: snapshot,
    expectRenderCounts(expected) {
      expect(snapshot()).toEqual(expected);
    },
    profile,
    record,
    reset() {
      counts.clear();
    },
    track,
    useRenderCount: increment,
  };
}
