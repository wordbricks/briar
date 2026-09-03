import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useState } from "react";

import { commands } from "../generated/tauri";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import { loadStatusTrayRuns } from "../lib/api";
import { DASHBOARD_POLL_INTERVAL_MS } from "../lib/dashboard-polling";
import { isDesktopTauri, isMacDesktopTauri } from "../lib/platform";
import {
  buildStatusTrayItems,
  buildStatusTraySnapshot,
  syncStatusTray,
} from "../lib/status-tray";
import { activeOrganizationIdAtom } from "../state/organization/atoms";
import { lockedTeamIdAtom } from "../state/platform";
import { tokenAtom } from "../state/session/atoms";
import { activeDashboardAtom } from "../state/sync/view";
import type { StatusTrayRun } from "../types";

/*
  The macOS menu bar tray.

  Three effects that had nothing to do with the rest of the shell lived next to
  it: derive the running runs of the open dashboard, poll the organization for
  every other team's, and push a localized snapshot to Rust. A fourth told Rust
  to refresh its worker labels on a desktop start.

  They are here because the tray is not a view — nothing renders from
  `statusTrayRuns`, so keeping it in the shell only meant the shell re-rendered
  every poll interval.
*/

/** Everything the tray reaches outside the store, so a test can supply it. */
export interface StatusTrayDeps {
  readonly loadStatusTrayRuns: typeof loadStatusTrayRuns;
  readonly syncStatusTray: typeof syncStatusTray;
  readonly syncExecutionWorkerLabels: () => Promise<unknown>;
  /** The tray only exists in the packaged macOS app. */
  readonly macDesktop: boolean;
  /** Worker labels are refreshed on any desktop build. */
  readonly desktop: boolean;
  readonly pollIntervalMs: number;
}

const liveStatusTrayDeps: StatusTrayDeps = {
  loadStatusTrayRuns,
  syncStatusTray,
  syncExecutionWorkerLabels: () => commands.syncExecutionWorkerLabels(),
  macDesktop: isMacDesktopTauri(),
  desktop: isDesktopTauri(),
  pollIntervalMs: DASHBOARD_POLL_INTERVAL_MS,
};

export function useStatusTray(overrides: Partial<StatusTrayDeps> = {}): void {
  const { locale, t } = useI18n();
  const token = useAtomValue(tokenAtom);
  const organizationId = useAtomValue(activeOrganizationIdAtom);
  const dashboard = useAtomValue(activeDashboardAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const [statusTrayRuns, setStatusTrayRuns] = useState<StatusTrayRun[]>([]);

  // Resolved once per mount so the effects below are not restarted by a caller
  // that rebuilds its overrides object.
  const deps = useMemo<StatusTrayDeps>(
    () => ({ ...liveStatusTrayDeps, ...overrides }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    [],
  );
  const { desktop, macDesktop, pollIntervalMs } = deps;

  useEffect(() => {
    if (!macDesktop || lockedTeamId) return;
    if (!dashboard) return;
    const projectRuns: StatusTrayRun[] = dashboard.runs
      .filter((run) => run.status === "running")
      .map((run) => ({
        teamId: dashboard.team.id,
        teamName: dashboard.team.name,
        id: run.id,
        title: run.title,
        status: "running",
        workflowStage: run.workflowStage,
        workflowStageLabel:
          run.workflow.stages.find((stage) => stage.id === run.workflowStage)
            ?.label ?? null,
        startedAt: run.startedAt,
        updatedAt: run.updatedAt,
        lastEventAt: run.lastEventAt,
      }));
    setStatusTrayRuns((current) => [
      ...current.filter((run) => run.teamId !== dashboard.team.id),
      ...projectRuns,
    ]);
  }, [dashboard, lockedTeamId, macDesktop]);

  useEffect(() => {
    if (!macDesktop || lockedTeamId) return;
    if (!token || !organizationId) {
      setStatusTrayRuns([]);
      return;
    }
    setStatusTrayRuns([]);
    let cancelled = false;
    let timer: number | null = null;
    let request: AbortController | null = null;
    const refreshStatusTray = async () => {
      request = new AbortController();
      try {
        const result = await deps.loadStatusTrayRuns(
          token,
          organizationId,
          request.signal,
        );
        if (!cancelled) setStatusTrayRuns(result.runs);
      } catch {
        // Keep the last known tray projection across transient network errors.
      } finally {
        request = null;
        if (!cancelled) {
          timer = window.setTimeout(
            () => void refreshStatusTray(),
            pollIntervalMs,
          );
        }
      }
    };

    void refreshStatusTray();
    return () => {
      cancelled = true;
      request?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [deps, lockedTeamId, macDesktop, organizationId, pollIntervalMs, token]);

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
    void deps.syncStatusTray(snapshot).catch(() => {
      // Tray bridge may be unavailable outside the packaged macOS app.
    });
  }, [deps, locale, lockedTeamId, macDesktop, statusTrayRuns, t]);

  useEffect(() => {
    if (!desktop || lockedTeamId) return;
    void deps.syncExecutionWorkerLabels().catch(() => {
      // Offline startup must not block the rest of the desktop app.
    });
  }, [deps, desktop, lockedTeamId]);
}
