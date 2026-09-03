import { useAtom, useAtomValue } from "@effect/atom-react";

import { useI18n } from "../../i18n";
import { companionPageAtom } from "../../state/navigation/atoms";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import { loadingAtom, userAtom } from "../../state/session/atoms";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { CompanionHeader } from "../CompanionHeader";

export interface CompanionHeaderWithSessionProps {
  /** The phone's back stack has an agent session open, which has no title. */
  readonly hasOpenAgentSession: boolean;
  readonly unreadInboxCount: number;
  readonly onMarkAllRead: () => void;
  readonly onLogout: () => void;
  readonly onOrganizationChange: (organizationId: string) => void;
  readonly onTeamChange: (teamId: string) => void;
  readonly onRefresh: () => void;
  readonly onSettings: () => void;
}

/**
 * The companion header, wired to the store. The account, the organizations, the
 * teams and the page the phone is on are all atoms, so switching tabs re-renders
 * this row instead of the shell that owns its callbacks.
 */
export function CompanionHeaderWithSession({
  hasOpenAgentSession,
  unreadInboxCount,
  onMarkAllRead,
  onLogout,
  onOrganizationChange,
  onTeamChange,
  onRefresh,
  onSettings,
}: CompanionHeaderWithSessionProps) {
  const { t } = useI18n();
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const loading = useAtomValue(loadingAtom);
  const organizations = useAtomValue(organizationsAtom);
  const teams = useAtomValue(teamsAtom);
  const user = useAtomValue(userAtom);
  const [companionPage] = useAtom(companionPageAtom);
  if (!user) return null;

  return (
    <CompanionHeader
      activeOrganizationId={activeOrganizationId}
      activeProjectId={activeTeamId}
      loading={loading}
      onLogout={onLogout}
      onMarkAllRead={
        companionPage === "inbox" && unreadInboxCount > 0
          ? onMarkAllRead
          : undefined
      }
      onOrganizationChange={onOrganizationChange}
      onProjectChange={onTeamChange}
      onRefresh={onRefresh}
      onSettings={onSettings}
      organizations={organizations}
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
