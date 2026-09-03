import { RegistryContext } from "@effect/atom-react";
import { useContext } from "react";

import type * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

/**
 * The registry that owns atom values, dependency links and subscriptions.
 * Domain actions take it directly so they stay independent of React, and views
 * reach it through {@link useRegistry}.
 */
export type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";

/** Atom/value pairs a registry can be seeded with before its first read. */
export type AtomInitialValues = Iterable<readonly [Atom.Atom<any>, any]>;

/**
 * Reads the registry installed by the surrounding `RegistryProvider`. The
 * identity is stable for the provider's lifetime, so memoising registry-bound
 * actions on it is enough to keep them stable across renders.
 */
export function useRegistry(): AtomRegistry.AtomRegistry {
  return useContext(RegistryContext);
}

/**
 * A standalone registry for tests. Unlike the React provider it keeps the
 * default synchronous scheduler and no idle TTL, so atom values survive having
 * no subscribers and assertions can read them straight back.
 */
export function createTestRegistry(
  initialValues?: AtomInitialValues,
): AtomRegistry.AtomRegistry {
  return AtomRegistry.make({ initialValues });
}
