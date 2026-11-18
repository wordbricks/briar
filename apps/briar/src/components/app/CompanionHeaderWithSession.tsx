import { useAtom, useAtomValue } from "@effect/atom-react";

import { useI18n } from "../../i18n";
import { companionPageAtom } from "../../state/navigation/atoms";
import { activeWorkspaceIdAtom, workspacesAtom } from "../../state/workspace/atoms";
import { loadingAtom, userAtom } from "../../state/session/atoms";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { CompanionHeader } from "../CompanionHeader";

export interface CompanionHeaderWithSessionProps {
  /** The phone's back stack has an agent session open, which has no title. */
  readonly hasOpenAgentSession: boolean;
  readonly unreadInboxCount: number;
  readonly onMarkAllRead: () => void;
  readonly onLogout: () => void;
  readonly onWorkspaceChange: (workspaceId: string) => void;
  readonly onTeamChange: (teamId: string) => void;
  readonly onRefresh: () => void;
  readonly onSettings: () => void;
}

/**
 * The companion header, wired to the store. The account, the workspaces, the
 * teams and the page the phone is on are all atoms, so switching tabs re-renders
 * this row instead of the shell that owns its callbacks.
 */
export function CompanionHeaderWithSession({
  hasOpenAgentSession,
  unreadInboxCount,
  onMarkAllRead,
  onLogout,
  onWorkspaceChange,
  onTeamChange,
  onRefresh,
  onSettings,
}: CompanionHeaderWithSessionProps) {
  const { t } = useI18n();
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const loading = useAtomValue(loadingAtom);
  const workspaces = useAtomValue(workspacesAtom);
  const teams = useAtomValue(teamsAtom);
  const user = useAtomValue(userAtom);
  const [companionPage] = useAtom(companionPageAtom);
  if (!user) return null;

  return (
    <CompanionHeader
      activeWorkspaceId={activeWorkspaceId}
      activeProjectId={activeTeamId}
      loading={loading}
      onLogout={onLogout}
      onMarkAllRead={
        companionPage === "inbox" && unreadInboxCount > 0
          ? onMarkAllRead
          : undefined
      }
      onWorkspaceChange={onWorkspaceChange}
      onProjectChange={onTeamChange}
      onRefresh={onRefresh}
      onSettings={onSettings}
      workspaces={workspaces}
      pageTitle={
        companionPage === "issues" && !hasOpenAgentSession
          ? t("companion.navTasks")
          : companionPage === "inbox"
            ? t("inbox.title")
            : companionPage === "dms"
              ? t("sidebar.dms")
              : null
      }
      projects={teams}
      user={user}
    />
  );
}
