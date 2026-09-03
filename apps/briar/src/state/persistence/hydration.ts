import * as Atom from "effect/unstable/reactivity/Atom";

import type { AtomRegistry } from "../registry";
import { userAtom } from "../session/atoms";
import type { SnapshotAccount } from "./account";

/*
  What the rest of the app needs to know about a hydrated boot.

  Two things, and they are separate on purpose. The atom is *state*: which
  account's stored snapshot is on screen, which the effects that would otherwise
  treat it as another account's leftovers read. The gate is *ordering*: the
  session bootstrap must not commit its own results while a snapshot is still
  being read, or the disk would land on top of the network and the app would
  show older data than it had.
*/

/**
 * The account whose stored snapshot this boot put in the store, or `null` when
 * nothing was hydrated. It stays set for the session: it says where the store
 * *started*, not whether the data in it is still the disk's.
 */
export const hydratedAccountAtom = Atom.make<SnapshotAccount | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("persistence/hydratedAccount"),
);

/** The screen came up from disk rather than from the network. */
export const hydratedFromSnapshotAtom = Atom.map(
  hydratedAccountAtom,
  (account) => account !== null,
).pipe(Atom.keepAlive, Atom.withLabel("persistence/hydrated"));

/**
 * The store's contents belong to the account that is signed in.
 *
 * `useTeamSync` clears the store whenever the credential changes, which on a
 * hydrated boot would fire the moment the bootstrap restored the token — the
 * transition from "no token" to "this account's token" is not a change of
 * account when the snapshot came from that same account.
 */
export function adoptsHydratedSession(registry: AtomRegistry): boolean {
  const hydrated = registry.get(hydratedAccountAtom);
  const user = registry.get(userAtom);
  return hydrated !== null && user !== null && hydrated.userId === user.id;
}

/** The hydrated channel catalog is this organization's own. */
export function adoptsHydratedCatalog(
  registry: AtomRegistry,
  organizationId: string | null,
): boolean {
  const hydrated = registry.get(hydratedAccountAtom);
  return (
    organizationId !== null &&
    hydrated !== null &&
    hydrated.organizationId === organizationId
  );
}

/*
  The ordering gate.

  `useHydration` opens it synchronously while it mounts — before
  `useSessionBootstrap`'s effect runs, which is what the mount order in
  `AppEffects` guarantees — and closes it when the record has been applied or
  found to be absent. The bootstrap waits on it just before committing, so the
  two never write the same atoms out of order.

  A registry that never opened a gate has none, and {@link awaitHydration}
  answers `null` rather than a resolved promise: a bootstrap mounted without
  hydration (every existing test) must not pay a tick for it.
*/

interface HydrationGate {
  readonly promise: Promise<void>;
  readonly open: () => void;
  settled: boolean;
}

const gates = new WeakMap<AtomRegistry, HydrationGate>();

/** Makes the bootstrap wait until {@link settleHydration}. */
export function beginHydration(registry: AtomRegistry): void {
  const current = gates.get(registry);
  if (current && !current.settled) return;
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  gates.set(registry, { open, promise, settled: false });
}

/** Hydration has decided. Called on every path, including the failures. */
export function settleHydration(registry: AtomRegistry): void {
  const gate = gates.get(registry);
  if (!gate || gate.settled) return;
  gate.settled = true;
  gate.open();
}

/** The pending decision, or `null` when there is nothing to wait for. */
export function awaitHydration(registry: AtomRegistry): Promise<void> | null {
  const gate = gates.get(registry);
  return gate && !gate.settled ? gate.promise : null;
}
