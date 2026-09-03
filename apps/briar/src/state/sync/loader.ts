import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import { loadDashboard, loadDashboardDelta } from "../../lib/api";
import { isApiErrorStatus } from "../../lib/api/errors";
import { demoMode } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import {
  activeTeamIdAtom,
  staleTeamIdAtom,
  teamCursorAtom,
  teamLoadedAtom,
} from "../team/atoms";
import { applySyncEvent, clearTeamStaleness } from "./apply";

/*
  The team dashboard fetcher.

  It owns what used to be four refs in `useBriar` — the last committed payload,
  the delta cursor, the in-flight request and its generation counter — and turns
  `setDashboard`'s implicit "cancel whatever is running and move the cursor"
  contract into an explicit API. Results are never written directly: every page
  goes through `applySyncEvent`, so the merge rules stay in one place.

  Three guards decide whether a response may be committed: the request's own
  `AbortController`, a per-team generation counter that a newer request bumps,
  and the active team, so a response that outlived its team is dropped rather
  than committed under another team's identity.
*/

/** How many delta pages a catch-up walks before asking for a snapshot instead. */
const MAX_DELTA_PAGES = 20;

/** The reads the loader performs. Tests supply in-memory implementations. */
export type TeamSyncApi = {
  readonly loadDashboard: typeof loadDashboard;
  readonly loadDashboardDelta: typeof loadDashboardDelta;
};

export const liveTeamSyncApi: TeamSyncApi = { loadDashboard, loadDashboardDelta };

/**
 * The reads the shared loader uses. `setSessionDataSources` seeds it together
 * with the session's own reads, so a test replaces every fetch the app makes in
 * one call and nothing has to hand anything else a loader instance.
 */
export const teamSyncApiAtom = Atom.make<TeamSyncApi>(liveTeamSyncApi).pipe(
  Atom.keepAlive,
  Atom.withLabel("sync/api"),
);

/** `delta` resumes from the stored cursor; `snapshot` always refetches whole. */
export type TeamSyncMode = "delta" | "snapshot";

export interface TeamSyncLoader {
  /** Fetches `teamId` and applies the result. Concurrent delta calls share one request. */
  readonly refresh: (
    teamId: string | null,
    mode?: TeamSyncMode,
  ) => Promise<void>;
  /** Invalidates and aborts whatever is in flight for one team. */
  readonly cancel: (teamId: string) => void;
  /** {@link cancel} for every team, used when the session or selection changes. */
  readonly cancelAll: () => void;
}

export function createTeamSyncLoader(
  registry: AtomRegistry,
  api?: Partial<TeamSyncApi>,
): TeamSyncLoader {
  const inFlight = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  const generations = new Map<string, number>();
  const resolveApi = (): TeamSyncApi => ({
    ...registry.get(teamSyncApiAtom),
    ...api,
  });

  const bump = (teamId: string) => {
    const next = (generations.get(teamId) ?? 0) + 1;
    generations.set(teamId, next);
    return next;
  };

  const cancel = (teamId: string) => {
    bump(teamId);
    const request = inFlight.get(teamId);
    if (!request) return;
    inFlight.delete(teamId);
    request.abort.abort();
  };

  const cancelAll = () => {
    for (const teamId of [...inFlight.keys()]) cancel(teamId);
  };

  const refresh = (teamId: string | null, mode: TeamSyncMode = "delta") => {
    const token = registry.get(tokenAtom);
    if (demoMode || !token || !teamId) return Promise.resolve();
    // A team showing stored data has to be replaced wholesale: its cursor may
    // be arbitrarily old, and a delta would patch a payload nobody refreshed.
    const resolvedMode: TeamSyncMode =
      mode === "snapshot" || registry.get(staleTeamIdAtom) === teamId
        ? "snapshot"
        : "delta";
    const currentRequest = inFlight.get(teamId);
    if (currentRequest && mode === "delta") return currentRequest.promise;
    currentRequest?.abort.abort();

    const abort = new AbortController();
    const generation = bump(teamId);
    const isCurrent = () =>
      !abort.signal.aborted &&
      generations.get(teamId) === generation &&
      registry.get(activeTeamIdAtom) === teamId;

    const promise = (async () => {
      const remote = resolveApi();
      const loadSnapshot = async () => {
        const payload = await remote.loadDashboard(token, teamId, abort.signal);
        if (!isCurrent()) return false;
        applySyncEvent(registry, { kind: "team-snapshot", teamId, payload });
        return true;
      };
      try {
        let cursor = registry.get(teamCursorAtom(teamId));
        const hasBase = registry.get(teamLoadedAtom(teamId));
        if (resolvedMode === "snapshot" || !hasBase || cursor === null) {
          if (!(await loadSnapshot())) return;
        } else {
          let pages = 0;
          while (true) {
            let delta;
            try {
              delta = await remote.loadDashboardDelta(
                token,
                teamId,
                cursor,
                abort.signal,
              );
              if (delta.reset) {
                if (!(await loadSnapshot())) return;
                break;
              }
            } catch (caught) {
              // An expired cursor is the server telling us to start over.
              if (!isApiErrorStatus(caught, 410)) throw caught;
              if (!(await loadSnapshot())) return;
              break;
            }
            if (!isCurrent()) return;
            applySyncEvent(registry, {
              kind: "team-delta",
              teamId,
              payload: delta,
            });
            cursor = delta.cursor;
            pages += 1;
            if (!delta.hasMore) break;
            if (pages >= MAX_DELTA_PAGES) {
              if (!(await loadSnapshot())) return;
              break;
            }
          }
        }
        if (!isCurrent()) return;
        clearTeamStaleness(registry, teamId);
        registry.set(sessionErrorAtom, null);
      } catch (caught) {
        if (abort.signal.aborted) return;
        registry.set(
          sessionErrorAtom,
          caught instanceof Error ? caught.message : String(caught),
        );
      } finally {
        if (inFlight.get(teamId)?.abort === abort) inFlight.delete(teamId);
      }
    })();
    inFlight.set(teamId, { abort, promise });
    return promise;
  };

  return { refresh, cancel, cancelAll };
}

/*
  One loader per registry. `useTeamSync` and the actions that refetch after a
  write live in different components but must share the in-flight map, or a
  `refreshActiveTeam` and a polling tick would race each other instead of
  sharing one request.
*/
const loaders = new WeakMap<AtomRegistry, TeamSyncLoader>();

export function getTeamSyncLoader(registry: AtomRegistry): TeamSyncLoader {
  let loader = loaders.get(registry);
  if (!loader) {
    loader = createTeamSyncLoader(registry);
    loaders.set(registry, loader);
  }
  return loader;
}

export function useTeamSyncLoader(): TeamSyncLoader {
  const registry = useRegistry();
  return useMemo(() => getTeamSyncLoader(registry), [registry]);
}
