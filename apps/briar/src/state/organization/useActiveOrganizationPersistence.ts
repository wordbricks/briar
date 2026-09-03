import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { writeActiveOrganizationId } from "../../lib/active-organization";
import { readTeamWindowProjectId } from "../../lib/team-window";
import { userAtom } from "../session/atoms";
import { activeOrganizationIdAtom } from "./atoms";

/**
 * Remembers the organization the account last worked in so the next cold start
 * reopens it (`resolveActiveAccountSelection` reads the same key back).
 *
 * A project window is pinned to one team by its query string, so it must never
 * overwrite the main window's choice; `lockedTeamId` defaults to that pin and
 * suppresses the write.
 */
export function useActiveOrganizationPersistence(
  lockedTeamId: string | null = readTeamWindowProjectId(),
) {
  const user = useAtomValue(userAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);

  useEffect(() => {
    if (lockedTeamId || !user || !activeOrganizationId) return;
    writeActiveOrganizationId(user.id, activeOrganizationId);
  }, [activeOrganizationId, lockedTeamId, user]);
}
