import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { writeActiveOrganizationId } from "../../lib/active-organization";
import { lockedTeamIdAtom } from "../platform";
import { userAtom } from "../session/atoms";
import { activeOrganizationIdAtom } from "./atoms";

/**
 * Remembers the organization the account last worked in so the next cold start
 * reopens it (`resolveActiveAccountSelection` reads the same key back).
 *
 * A project window is pinned to one team by its query string, so it must never
 * overwrite the main window's choice; the platform level pin suppresses the
 * write.
 */
export function useActiveOrganizationPersistence() {
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const user = useAtomValue(userAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);

  useEffect(() => {
    if (lockedTeamId || !user || !activeOrganizationId) return;
    writeActiveOrganizationId(user.id, activeOrganizationId);
  }, [activeOrganizationId, lockedTeamId, user]);
}
