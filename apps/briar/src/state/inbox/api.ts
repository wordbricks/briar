import * as Atom from "effect/unstable/reactivity/Atom";

import {
  deleteInboxReadState,
  loadInboxFeed,
  loadInboxReadStates,
  saveInboxReadStates,
} from "../../lib/api";
import { startDashboardPolling } from "../../lib/dashboard-polling";
import type { AtomRegistry } from "../registry";

/*
  Everything the inbox reaches outside the store.

  It replaces the `dependencies` parameter `useInbox` took: the actions and the
  sync hook are different callers of the same account endpoints, and a test that
  hands one of them a fake must hand the other the same one. Seeding the atom
  once per registry does that, which is the shape `state/agent-sessions` and
  `state/workspace` already use.
*/

export interface InboxApi {
  readonly deleteReadState: typeof deleteInboxReadState;
  readonly loadFeed: typeof loadInboxFeed;
  readonly loadReadStates: typeof loadInboxReadStates;
  readonly saveReadStates: typeof saveInboxReadStates;
  readonly startPolling: typeof startDashboardPolling;
}

export const liveInboxApi: InboxApi = {
  deleteReadState: deleteInboxReadState,
  loadFeed: loadInboxFeed,
  loadReadStates: loadInboxReadStates,
  saveReadStates: saveInboxReadStates,
  startPolling: startDashboardPolling,
};

/** The overrides in force for this registry. */
export const inboxApiAtom = Atom.make<Partial<InboxApi>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("inbox/api"),
);

/** The API in force for this registry, resolved at call time. */
export function resolveInboxApi(
  registry: AtomRegistry,
  overrides?: Partial<InboxApi> | undefined,
): InboxApi {
  return {
    ...liveInboxApi,
    ...registry.get(inboxApiAtom),
    ...overrides,
  };
}
