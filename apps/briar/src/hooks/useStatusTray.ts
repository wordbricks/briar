import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  buildStatusTrayItems,
  buildStatusTraySnapshot,
} from "../lib/status-tray";
import { activeOrganizationIdAtom } from "../state/organization/atoms";
import { lockedTeamIdAtom } from "../state/platform";
import {
  activeTeamTrayRunsAtom,
  statusTrayApiAtom,
  statusTrayPollAtom,
  statusTrayRunsAtom,
} from "../state/status-tray/atoms";
import { useRegistry } from "../state/registry";

/*
  The macOS menu bar tray.

  The organization-wide poll is a subscription atom: it starts when this hook
  first observes it and stops through its finalizer a few seconds after the last
  observer goes away. What stays here are the two effects that need React — the
  merge of the open dashboard's running runs, and the localized snapshot pushed
  to Rust, which is built from `useI18n` — plus the desktop start's worker label
  refresh.

  Nothing renders from any of this. The hook lives in `AppEffects` so a tray
  update costs one render of a component that returns `null`.
*/

export function useStatusTray(): void {
  const { locale, t } = useI18n();
  const registry = useRegistry();
  const api = useAtomValue(statusTrayApiAtom);
  const organizationId = useAtomValue(activeOrganizationIdAtom);
  const teamTrayRuns = useAtomValue(activeTeamTrayRunsAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const statusTrayRuns = useAtomValue(statusTrayRunsAtom);
  const { desktop, macDesktop } = api;

  // Observing the poll is what starts it; unmounting is what stops it.
  useAtomMount(statusTrayPollAtom);

  useEffect(() => {
    if (!macDesktop || lockedTeamId) return;
    if (!teamTrayRuns) return;
    registry.update(statusTrayRunsAtom, (current) => [
      ...current.filter((run) => run.teamId !== teamTrayRuns.teamId),
      ...teamTrayRuns.runs,
    ]);
  }, [lockedTeamId, macDesktop, registry, teamTrayRuns]);

  useEffect(() => {
    if (!macDesktop || lockedTeamId) return;
    const items = buildStatusTrayItems(statusTrayRuns, {
      untitledTitle: t("statusTray.untitledIssue"),
      localizeStatus: (fallback, run) => {
        if (run.status === "running" && run.workflowStage) {
          const stageKey = `stage.${run.workflowStage}` as MessageKey;
          const localized = t(stageKey);
          if (localized && localized !== stageKey) return localized;
          return run.workflowStageLabel ?? fallback;
        }
        const statusKey = `status.${run.status}` as MessageKey;
        const localized = t(statusKey);
        return localized && localized !== statusKey ? localized : fallback;
      },
    });
    const snapshot = buildStatusTraySnapshot(items, {
      runningLabel: t("statusTray.running"),
      emptyLabel: t("statusTray.empty"),
      openLabel: t("statusTray.openBriar"),
      quitLabel: t("statusTray.quitBriar"),
      moreLabel: t("statusTray.more"),
    });
    void api.syncStatusTray(snapshot).catch(() => {
      // Tray bridge may be unavailable outside the packaged macOS app.
    });
  }, [api, locale, lockedTeamId, macDesktop, organizationId, statusTrayRuns, t]);

  useEffect(() => {
    if (!desktop || lockedTeamId) return;
    void api.syncExecutionWorkerLabels().catch(() => {
      // Offline startup must not block the rest of the desktop app.
    });
  }, [api, desktop, lockedTeamId]);
}
