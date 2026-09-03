import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { demoMode } from "../platform";
import { useRegistry } from "../registry";
import { resolveSessionApi } from "../session/api";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { teamsAtom } from "../team/atoms";
import { planningProjectsAtom } from "./atoms";

/**
 * Loads every team's planning projects into one flat list.
 *
 * The list is scoped to the account rather than to the selected team — the
 * sidebar shows every team's projects, and an issue can be moved into another
 * team's — so it is refetched when the team list or the credential changes, and
 * emptied whenever either is missing. Demo mode ships its own single project
 * and never fetches.
 */
export function usePlanningProjectsSync(): void {
  const registry = useRegistry();
  const teams = useAtomValue(teamsAtom);
  const token = useAtomValue(tokenAtom);

  useEffect(() => {
    if (demoMode) return;
    if (!token || teams.length === 0) {
      registry.set(planningProjectsAtom, []);
      return;
    }
    let cancelled = false;
    const remote = resolveSessionApi(registry);
    void Promise.all(teams.map((team) => remote.loadTeamProjects(token, team.id)))
      .then((groups) => {
        if (!cancelled) registry.set(planningProjectsAtom, groups.flat());
      })
      .catch((caught) => {
        if (cancelled) return;
        registry.set(
          sessionErrorAtom,
          caught instanceof Error ? caught.message : String(caught),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [registry, teams, token]);
}
