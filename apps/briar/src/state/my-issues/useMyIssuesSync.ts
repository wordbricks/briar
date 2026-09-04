import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import type { DashboardPayload } from "../../types";
import { pinnedTeamIdsAtom } from "../entities/retention";
import { useRegistry } from "../registry";
import { applySyncEvent } from "../sync/apply";
import {
  myIssuesFailedTeamIdsAtom,
  myIssuesLoadedKeyAtom,
  myIssuesLoadingAtom,
  myIssuesRetryAtom,
  myIssuesSelectedProjectIdsAtom,
  myIssuesTeamIdsAtom,
} from "./atoms";

/*
  Where "내 이슈" fills the store.

  The page used to keep a `Record<projectId, DashboardPayload>` of its own and
  render run objects out of it, so a board it had loaded lived twice — once here
  and, for the open team, once in the entity maps — and a realtime `run-changed`
  reached only one of them. Every response goes through `applySyncEvent` now, so
  the rows this page draws are the same entities every other view reads and the
  delta loop keeps them current.

  Two rules come with reaching across teams. The teams are pinned against the
  entity retention limit while the page is mounted, because it draws more of
  them at once than the LRU is sized for (see `entities/retention.ts`), and the
  pin is released on unmount so the LRU governs again. And a team the store has
  already loaded is not fetched at all: the loader answers it from the registry,
  which is also what keeps demo mode — where there is no server to ask — showing
  its board here.
*/

/** What one project's board load returns: a payload to apply, or nothing to. */
export type MyIssuesDashboardLoader = (
  teamId: string,
  signal: AbortSignal,
) => Promise<DashboardPayload | null>;

/** The project composition a load pass covers, as one comparable value. */
export const myIssuesCompositionKey = (
  organizationId: string | null,
  teamIds: readonly string[],
) => JSON.stringify({ organizationId, teamIds: [...teamIds].sort() });

/**
 * Loads every listed project's board into the store and keeps the page's load
 * state current. `teamIds` is the organization's project list in sidebar order.
 */
export function useMyIssuesSync(input: {
  readonly load: MyIssuesDashboardLoader;
  readonly organizationId: string | null;
  readonly teamIds: readonly string[];
}): void {
  const registry = useRegistry();
  const loadRef = useRef(input.load);
  loadRef.current = input.load;
  const retry = useAtomValue(myIssuesRetryAtom);
  const key = myIssuesCompositionKey(input.organizationId, input.teamIds);

  useEffect(() => {
    const teamIds = (JSON.parse(key) as { teamIds: string[] }).teamIds;
    registry.set(myIssuesTeamIdsAtom, teamIds);
    registry.set(pinnedTeamIdsAtom, teamIds);
    // A project that left the organization leaves the filter menu with it.
    const available = new Set(teamIds);
    registry.update(myIssuesSelectedProjectIdsAtom, (selected) =>
      selected.filter((teamId) => available.has(teamId)),
    );
    return () => {
      registry.set(pinnedTeamIdsAtom, []);
      /*
        Unpinned teams can be evicted before the page comes back, so the next
        mount is an initial load again — which is what the page's `useState`
        said by construction and what its loading overlay is keyed on.
      */
      registry.set(myIssuesLoadedKeyAtom, null);
    };
  }, [key, registry]);

  useEffect(() => {
    const teamIds = (JSON.parse(key) as { teamIds: string[] }).teamIds;
    const controller = new AbortController();
    let cancelled = false;
    registry.set(myIssuesLoadingAtom, true);
    registry.set(myIssuesFailedTeamIdsAtom, []);

    if (teamIds.length === 0) {
      registry.set(myIssuesLoadedKeyAtom, key);
      registry.set(myIssuesLoadingAtom, false);
      return () => controller.abort();
    }

    void Promise.all(
      teamIds.map(async (teamId) => {
        try {
          return {
            failed: false,
            payload: await loadRef.current(teamId, controller.signal),
            teamId,
          };
        } catch {
          return { failed: true, payload: null, teamId };
        }
      }),
    ).then((results) => {
      if (cancelled || controller.signal.aborted) return;
      const failed: string[] = [];
      for (const result of results) {
        if (result.failed) failed.push(result.teamId);
        if (!result.payload) continue;
        applySyncEvent(registry, {
          kind: "team-snapshot",
          teamId: result.teamId,
          payload: result.payload,
        });
      }
      registry.set(myIssuesFailedTeamIdsAtom, failed);
      registry.set(myIssuesLoadedKeyAtom, key);
      registry.set(myIssuesLoadingAtom, false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, registry, retry]);
}
