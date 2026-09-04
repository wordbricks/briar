import { useAtomMount } from "@effect/atom-react";

import {
  statusTrayPollAtom,
  statusTraySnapshotAtom,
  statusTrayTeamRunsAtom,
  statusTrayWorkerLabelsAtom,
} from "../state/status-tray/atoms";

/*
  The macOS menu bar tray.

  Every part of it is a subscription atom in `state/status-tray`: each starts
  when this hook first observes it and stops through its finalizer a few seconds
  after the last observer goes away. Two of them used to be effects here because
  the localized snapshot needs `t`, which only a render could produce;
  `state/i18n` publishes the loaded catalog now, so they read it from the store
  like everything else.

  The order is the write order and is load bearing. The poll seeds the list from
  the open team and then replaces it with the organization's; the merge folds
  the open team back in; the snapshot reads the result. Mounting the snapshot
  first would push one list to Rust and then a second one in the same commit,
  which is the flash this order removes.

  Nothing renders from any of this, and nothing here renders either: the hook
  installs four subscriptions and returns.
*/
export function useStatusTray(): void {
  useAtomMount(statusTrayPollAtom);
  useAtomMount(statusTrayTeamRunsAtom);
  useAtomMount(statusTraySnapshotAtom);
  useAtomMount(statusTrayWorkerLabelsAtom);
}
