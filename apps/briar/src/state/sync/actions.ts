import { useMemo } from "react";

import { useRegistry, type AtomRegistry } from "../registry";
import { activeTeamIdAtom } from "../team/atoms";
import { getTeamSyncLoader, type TeamSyncMode } from "./loader";

/*
  The imperative refetch.

  This was `useBriar`'s `refresh`, a `useCallback` bound to the team that was
  selected when it rendered — so a consumer holding on to an old one refetched a
  team that had since been left. Reading the selection at call time removes that
  class of bug entirely; the loader still drops any response whose team stopped
  being the active one, which is what makes a late answer harmless.

  The periodic, visibility and scope triggers stay in `useTeamSync`. This is
  only the entry point actions call after a write the server owns.
*/

export interface SyncActions {
  /** Refetches the selected team. `snapshot` ignores the stored cursor. */
  readonly refreshActiveTeam: (mode?: TeamSyncMode) => Promise<void>;
}

export function createSyncActions(registry: AtomRegistry): SyncActions {
  const loader = getTeamSyncLoader(registry);
  return {
    refreshActiveTeam: (mode: TeamSyncMode = "delta") =>
      loader.refresh(registry.get(activeTeamIdAtom), mode),
  };
}

export function useSyncActions(): SyncActions {
  const registry = useRegistry();
  return useMemo(() => createSyncActions(registry), [registry]);
}
