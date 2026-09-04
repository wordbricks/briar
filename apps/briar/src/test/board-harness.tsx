import { RegistryContext } from "@effect/atom-react";
import { useEffect, useRef, type ComponentProps } from "react";

import { HuntDashboard } from "../components/hunt/HuntDashboard";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { applySyncEvent } from "../state/sync/apply";
import { activeTeamIdAtom } from "../state/team/atoms";
import type { DashboardPayload } from "../types";

/*
  The issue board, rendered from a payload.

  The board reads the selected team's runs, settings and members from the store
  rather than taking a `DashboardPayload` prop, so a test that wants to draw a
  particular dashboard has to put it in a registry first. This does that, and
  keeps the tests written the way they were: pass the payload, assert the DOM.

  The first payload is applied while rendering, before any child has subscribed,
  so a server-rendered board has its data too. A later one goes through an
  effect, which is where a real delta would arrive from.
*/
export function BoardHarness({
  dashboard,
  registry: providedRegistry,
  ...props
}: {
  dashboard: DashboardPayload | null;
  /** A registry the test seeded itself, e.g. with a session or a run change. */
  registry?: AtomRegistry;
} & ComponentProps<typeof HuntDashboard>) {
  const registryRef = useRef<AtomRegistry | null>(null);
  if (registryRef.current === null) {
    registryRef.current = providedRegistry ?? createTestRegistry();
    seedDashboard(registryRef.current, dashboard);
  }
  const registry = registryRef.current;
  const appliedRef = useRef(dashboard);
  useEffect(() => {
    if (appliedRef.current === dashboard) return;
    appliedRef.current = dashboard;
    seedDashboard(registry, dashboard);
  }, [dashboard, registry]);

  return (
    <RegistryContext.Provider value={registry}>
      <HuntDashboard {...props} />
    </RegistryContext.Provider>
  );
}

/** Selects `payload`'s team and applies it as that team's snapshot. */
export function seedDashboard(
  registry: AtomRegistry,
  payload: DashboardPayload | null,
) {
  if (!payload) return;
  registry.set(activeTeamIdAtom, payload.team.id);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: payload.team.id,
    payload,
  });
}
