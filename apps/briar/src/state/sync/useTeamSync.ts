import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import { startDashboardPolling } from "../../lib/dashboard-polling";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { adoptsHydratedSession } from "../persistence/hydration";
import { demoMode } from "../platform";
import { useRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { activeTeamIdAtom } from "../team/atoms";
import { applySyncEvent } from "./apply";
import { useTeamSyncLoader } from "./loader";

/**
 * Keeps the selected team's dashboard in sync, and keeps the store scoped to
 * the session and organization it belongs to.
 *
 * These were four `useEffect` blocks in `useBriar`: the poll / visibility /
 * online triggers, the request invalidation on a selection change, and the two
 * scope invalidations that used to prune the payload cache. They read their
 * keys from atoms, so mounting them from `AppEffects` costs the app shell no
 * re-renders.
 */
export function useTeamSync() {
  const registry = useRegistry();
  const loader = useTeamSyncLoader();
  const token = useAtomValue(tokenAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const previousToken = useRef<string | null | undefined>(undefined);

  // The store is session scoped: a new (or cleared) token must never reuse the
  // previous account's entities.
  useEffect(() => {
    const previous = previousToken.current;
    previousToken.current = token;
    if (demoMode || previous === undefined || previous === token) return;
    /*
      The first credential of a boot is not a change of account when the store
      was hydrated for the account it belongs to: the snapshot is that account's
      own work, and clearing it here would blank the screen at the exact moment
      the bootstrap succeeded.
    */
    if (previous === null && adoptsHydratedSession(registry)) return;
    applySyncEvent(registry, { kind: "session-cleared" });
  }, [registry, token]);

  // …and organization scoped: leaving an organization drops every team that
  // belongs to it. Demo mode has no organization switch to follow.
  useEffect(() => {
    if (demoMode) return;
    applySyncEvent(registry, {
      kind: "organization-left",
      retainedOrganizationId: activeOrganizationId,
    });
  }, [activeOrganizationId, registry]);

  // A selection or session change invalidates every request in flight, so a
  // response cannot land under the identity that replaced it.
  useEffect(() => {
    loader.cancelAll();
  }, [activeTeamId, loader, token]);

  useEffect(() => {
    if (demoMode || !token || !activeTeamId) return;
    return startDashboardPolling((reason) =>
      void loader.refresh(activeTeamId, reason === "poll" ? "delta" : "snapshot"),
    );
  }, [activeTeamId, loader, token]);
}
