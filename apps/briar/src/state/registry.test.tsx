/** @vitest-environment jsdom */

import { RegistryProvider, useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { createReactTestRoot } from "../test/react";
import { createTestRegistry, useRegistry, type AtomRegistry } from "./registry";

const countAtom = Atom.make(0);

describe("createTestRegistry", () => {
  it("starts from the atom default", () => {
    const registry = createTestRegistry();
    expect(registry.get(countAtom)).toBe(0);
  });

  it("seeds initial values and keeps writes without a subscriber", () => {
    const registry = createTestRegistry([[countAtom, 7]]);
    expect(registry.get(countAtom)).toBe(7);

    registry.set(countAtom, 9);
    expect(registry.get(countAtom)).toBe(9);
  });

  it("notifies subscribers of writes", () => {
    const registry = createTestRegistry();
    const seen: number[] = [];
    const unsubscribe = registry.subscribe(countAtom, (value) => {
      seen.push(value);
    });

    registry.set(countAtom, 1);
    registry.set(countAtom, 2);
    unsubscribe();
    registry.set(countAtom, 3);

    expect(seen).toEqual([1, 2]);
  });

  it("isolates registries from each other", () => {
    const first = createTestRegistry([[countAtom, 1]]);
    const second = createTestRegistry();

    first.set(countAtom, 5);
    expect(second.get(countAtom)).toBe(0);
  });
});

describe("useRegistry", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  it("returns the registry backing the atom hooks in the same subtree", async () => {
    const view = createReactTestRoot();
    const seen: AtomRegistry[] = [];

    function Counter() {
      seen.push(useRegistry());
      return <output>{useAtomValue(countAtom)}</output>;
    }

    await view.render(
      <RegistryProvider>
        <Counter />
      </RegistryProvider>,
    );
    expect(view.container.textContent).toBe("0");

    const provided = seen[0];
    expect(provided).toBeDefined();
    await act(async () => provided.set(countAtom, 4));

    expect(view.container.textContent).toBe("4");
    // Every render read the one registry the provider installed.
    expect(new Set(seen).size).toBe(1);

    await view.cleanup();
  });
});
