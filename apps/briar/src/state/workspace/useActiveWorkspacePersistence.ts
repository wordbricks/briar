import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { writeActiveWorkspaceId } from "../../lib/active-workspace";
import { lockedTeamIdAtom } from "../platform";
import { userAtom } from "../session/atoms";
import { activeWorkspaceIdAtom } from "./atoms";

/**
 * Remembers the workspace the account last worked in so the next cold start
 * reopens it (`resolveActiveAccountSelection` reads the same key back).
 *
 * A project window is pinned to one team by its query string, so it must never
 * overwrite the main window's choice; the platform level pin suppresses the
 * write.
 */
export function useActiveWorkspacePersistence() {
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const user = useAtomValue(userAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);

  useEffect(() => {
    if (lockedTeamId || !user || !activeWorkspaceId) return;
    writeActiveWorkspaceId(user.id, activeWorkspaceId);
  }, [activeWorkspaceId, lockedTeamId, user]);
}
