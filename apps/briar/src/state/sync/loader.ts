import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import {
  loadDashboard,
  loadDashboardDelta,
  loadDashboardRuns,
  type DashboardRunListOptions,
} from "../../lib/api";
import { isApiErrorStatus } from "../../lib/api/errors";
import { activePlanningProjectIdAtom } from "../dialogs/atoms";
import { boardSourceAtom } from "../board/atoms";
import { teamEntityAtom } from "../entities/teams";
import { companionStatusAtom } from "../navigation/atoms";
import { companionMode, demoMode } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import {
  activeTeamIdAtom,
  mobileIssueListStateAtom,
  staleTeamIdAtom,
  teamsAtom,
  teamCursorAtom,
  teamLoadedAtom,
} from "../team/atoms";
import type { Project } from "../../types";
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
const MOBILE_LIST_PAGE_SIZE = 40;

/** The reads the loader performs. Tests supply in-memory implementations. */
export type TeamSyncApi = {
  readonly loadDashboard: typeof loadDashboard;
  readonly loadDashboardDelta: typeof loadDashboardDelta;
  readonly loadDashboardRuns?: typeof loadDashboardRuns;
};

export const liveTeamSyncApi: TeamSyncApi = {
  loadDashboard,
  loadDashboardDelta,
  loadDashboardRuns,
};

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
  /** Loads the next cursor page of the mobile issue list, if one exists. */
  readonly loadNextPage: (teamId: string | null) => Promise<void>;
}

export interface TeamSyncLoaderOptions {
  readonly companionMode?: boolean;
  readonly demoMode?: boolean;
}

function mobileListRequest(registry: AtomRegistry) {
  const source = registry.get(boardSourceAtom);
  const status = registry.get(companionStatusAtom);
  const planningProjectId = registry.get(activePlanningProjectIdAtom);
  const sources: DashboardRunListOptions["sources"] =
    source === "all" ? undefined : [source];
  const statuses: DashboardRunListOptions["statuses"] =
    status === "all"
      ? undefined
      : status === "active"
        ? ["backlog", "queued", "running", "paused", "blocked", "failed"]
        : status === "attention"
          ? ["paused", "blocked", "failed"]
          : ["completed", "cancelled"];
  return {
    filterKey: JSON.stringify({ source, status, planningProjectId }),
    options: {
      pageSize: MOBILE_LIST_PAGE_SIZE,
      sources,
      statuses,
      planningProjectId,
    } satisfies Omit<DashboardRunListOptions, "signal" | "cursor">,
  };
}

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

function teamForMobileList(
  registry: AtomRegistry,
  teamId: string,
): Project | null {
  return (
    registry.get(teamEntityAtom(teamId)) ??
    registry.get(teamsAtom).find((team) => team.id === teamId) ??
    null
  );
}

export function createTeamSyncLoader(
  registry: AtomRegistry,
  api?: Partial<TeamSyncApi>,
  options: TeamSyncLoaderOptions = {},
): TeamSyncLoader {
  const isCompanionMode = options.companionMode ?? companionMode;
  const isDemoMode = options.demoMode ?? demoMode;
  const inFlight = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  const nextPageInFlight = new Map<
    string,
    { abort: AbortController; promise: Promise<void> }
  >();
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
    if (request) {
      inFlight.delete(teamId);
      request.abort.abort();
    }
    const nextPage = nextPageInFlight.get(teamId);
    if (nextPage) {
      nextPageInFlight.delete(teamId);
      nextPage.abort.abort();
    }
  };

  const cancelAll = () => {
    for (const teamId of new Set([...inFlight.keys(), ...nextPageInFlight.keys()])) {
      cancel(teamId);
    }
  };

  const loadNextPage = (teamId: string | null): Promise<void> => {
    const token = registry.get(tokenAtom);
    if (isDemoMode || !token || !teamId || !isCompanionMode) {
      return Promise.resolve();
    }
    const state = registry.get(mobileIssueListStateAtom(teamId));
    if (
      !state.loaded ||
      !state.nextCursor ||
      state.isLoading ||
      state.isLoadingNextPage
    ) {
      return Promise.resolve();
    }
    const filter = mobileListRequest(registry);
    if (state.filterKey !== filter.filterKey) return Promise.resolve();
    const currentRequest = nextPageInFlight.get(teamId);
    if (currentRequest) return currentRequest.promise;
    const generation = generations.get(teamId) ?? 0;
    const abort = new AbortController();
    const isCurrent = () =>
      !abort.signal.aborted &&
      generations.get(teamId) === generation &&
      registry.get(activeTeamIdAtom) === teamId;
    registry.set(mobileIssueListStateAtom(teamId), {
      ...state,
      isLoadingNextPage: true,
      error: null,
    });
    const promise = (async () => {
      try {
        const remote = resolveApi();
        if (!remote.loadDashboardRuns) {
          throw new Error("모바일 이슈 목록 API가 설정되지 않았습니다.");
        }
        const page = await remote.loadDashboardRuns(
          token,
          teamId,
          { ...filter.options, cursor: state.nextCursor },
          abort.signal,
        );
        if (!isCurrent()) return;
        const team = teamForMobileList(registry, teamId);
        if (!team) throw new Error("팀 정보를 불러오지 못했습니다.");
        applySyncEvent(registry, {
          kind: "mobile-list-page",
          teamId,
          page,
          team,
          filterKey: filter.filterKey,
          replace: false,
        });
      } catch (caught) {
        if (abort.signal.aborted) return;
        const message = errorMessage(caught);
        const current = registry.get(mobileIssueListStateAtom(teamId));
        registry.set(mobileIssueListStateAtom(teamId), {
          ...current,
          isLoadingNextPage: false,
          error: message,
        });
        registry.set(sessionErrorAtom, message);
      } finally {
        if (nextPageInFlight.get(teamId)?.abort === abort) {
          nextPageInFlight.delete(teamId);
        }
      }
    })();
    nextPageInFlight.set(teamId, { abort, promise });
    return promise;
  };

  const refresh = (teamId: string | null, mode: TeamSyncMode = "delta") => {
    const token = registry.get(tokenAtom);
    if (isDemoMode || !token || !teamId) return Promise.resolve();
    if (isCompanionMode) {
      const currentRequest = inFlight.get(teamId);
      if (currentRequest && mode === "delta") return currentRequest.promise;
      currentRequest?.abort.abort();
      const nextPage = nextPageInFlight.get(teamId);
      nextPage?.abort.abort();
      nextPageInFlight.delete(teamId);

      const abort = new AbortController();
      const generation = bump(teamId);
      const filter = mobileListRequest(registry);
      const isCurrent = () =>
        !abort.signal.aborted &&
        generations.get(teamId) === generation &&
        registry.get(activeTeamIdAtom) === teamId;
      const currentState = registry.get(mobileIssueListStateAtom(teamId));
      registry.set(mobileIssueListStateAtom(teamId), {
        ...currentState,
        isLoading: true,
        isLoadingNextPage: false,
        filterKey: filter.filterKey,
        error: null,
      });

      const promise = (async () => {
        try {
          const remote = resolveApi();
          if (!remote.loadDashboardRuns) {
            throw new Error("모바일 이슈 목록 API가 설정되지 않았습니다.");
          }
          const page = await remote.loadDashboardRuns(
            token,
            teamId,
            filter.options,
            abort.signal,
          );
          if (!isCurrent()) return;
          const team = teamForMobileList(registry, teamId);
          if (!team) throw new Error("팀 정보를 불러오지 못했습니다.");
          applySyncEvent(registry, {
            kind: "mobile-list-page",
            teamId,
            page,
            team,
            filterKey: filter.filterKey,
            replace: true,
          });
          clearTeamStaleness(registry, teamId);
          registry.set(sessionErrorAtom, null);

          // Keep the existing rich dashboard synchronization, but let the
          // lightweight page commit before this larger response is decoded.
          void remote
            .loadDashboard(token, teamId, abort.signal)
            .then((payload) => {
              if (!isCurrent()) return;
              applySyncEvent(registry, {
                kind: "team-metadata",
                teamId,
                payload,
              });
            })
            .catch(() => undefined);
        } catch (caught) {
          if (abort.signal.aborted) return;
          const message = errorMessage(caught);
          const current = registry.get(mobileIssueListStateAtom(teamId));
          registry.set(mobileIssueListStateAtom(teamId), {
            ...current,
            isLoading: false,
            error: message,
          });
          registry.set(sessionErrorAtom, message);
        } finally {
          if (inFlight.get(teamId)?.abort === abort) inFlight.delete(teamId);
        }
      })();
      inFlight.set(teamId, { abort, promise });
      return promise;
    }
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

  return { refresh, cancel, cancelAll, loadNextPage };
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
