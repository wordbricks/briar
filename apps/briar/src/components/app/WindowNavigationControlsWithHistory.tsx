import { useAtom, useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";

import { useI18n } from "../../i18n";
import { buildNavigationHistoryItems } from "../../lib/navigation-history-items";
import { activeOrganizationChannelsAtom } from "../../state/channels/atoms";
import {
  isNavigationHistoryOpenAtom,
  isSidebarOpenAtom,
} from "../../state/dialogs/atoms";
import { useNavigationActions } from "../../state/navigation/actions";
import {
  canGoBackAtom,
  canGoForwardAtom,
  navigationHistoryEntriesAtom,
  navigationHistoryIndexAtom,
  navigationHistoryRunLabelsAtom,
} from "../../state/navigation/atoms";
import { organizationsAtom } from "../../state/organization/atoms";
import { userAtom } from "../../state/session/atoms";
import { teamsAtom } from "../../state/team/atoms";
import { WindowNavigationControls } from "../WindowNavigationControls";

/*
  The window's back, forward, history and sidebar buttons, wired to the store.

  Every value here used to be assembled in `App.tsx` and threaded through the
  desktop shell — including the two hundred line `useMemo` that resolves each
  history entry's label against the teams, organizations, channels and the runs
  it visited. Reading it here means a visit changes this row and nothing above
  it — and the run labels come from an atom that only changes when a *visited*
  run's key or title does, so a board edit does not reach this row either.
*/
export function WindowNavigationControlsWithHistory() {
  const { t } = useI18n();
  const { goBack, goForward, goToNavigationHistory } = useNavigationActions();
  const canGoBack = useAtomValue(canGoBackAtom);
  const canGoForward = useAtomValue(canGoForwardAtom);
  const entries = useAtomValue(navigationHistoryEntriesAtom);
  const historyIndex = useAtomValue(navigationHistoryIndexAtom);
  const channels = useAtomValue(activeOrganizationChannelsAtom);
  const runLabels = useAtomValue(navigationHistoryRunLabelsAtom);
  const organizations = useAtomValue(organizationsAtom);
  const teams = useAtomValue(teamsAtom);
  const user = useAtomValue(userAtom);
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom);
  const [isNavigationHistoryOpen, setIsNavigationHistoryOpen] = useAtom(
    isNavigationHistoryOpenAtom,
  );
  const historyItems = useMemo(
    () =>
      buildNavigationHistoryItems({
        channels,
        currentUserId: user?.id ?? null,
        entries,
        organizations,
        runLabels,
        t,
        teams,
      }),
    [channels, entries, organizations, runLabels, t, teams, user?.id],
  );

  return (
    <WindowNavigationControls
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      historyIndex={historyIndex}
      historyItems={historyItems}
      isHistoryOpen={isNavigationHistoryOpen}
      isSidebarOpen={isSidebarOpen}
      onBack={goBack}
      onForward={goForward}
      onHistoryOpenChange={setIsNavigationHistoryOpen}
      onHistorySelect={goToNavigationHistory}
      onSidebarToggle={() => setIsSidebarOpen((open) => !open)}
    />
  );
}
