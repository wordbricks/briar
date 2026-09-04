import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useCallback, useMemo } from "react";

import { useToast } from "../components/ui/toast";
import { LITELLM_MAIN_PRICING_SOURCE } from "../lib/agent-usage-pricing";
import {
  loadAgentUsageReport,
  loadDashboard,
  loadProjectUsageSummary,
} from "../lib/api";
import { createCachedTeamUsageSummaryLoader } from "../lib/team-usage-summary";
import type { MyIssuesDashboardLoader } from "../state/my-issues/useMyIssuesSync";
import type { AgentUsageReport } from "../types";
import { useNavigationActions } from "../state/navigation/actions";
import {
  issueListRequestKeyAtom,
  requestedRunIdAtom,
  requestedRunInitialTabAtom,
  requestedRunMessageIdAtom,
  requestedSessionIdAtom,
} from "../state/navigation/atoms";
import { activeOrganizationIdAtom } from "../state/organization/atoms";
import { useRegistry } from "../state/registry";
import { tokenAtom } from "../state/session/atoms";
import { useTeamActions } from "../state/team/actions";
import { activeTeamIdAtom, loadedTeamIdAtom } from "../state/team/atoms";

/*
  The reads the organization-wide views make, and the one navigation they need.

  These four were `useCallback`s on the app shell, each listing the session
  token so that a re-render rebuilt them. They are here because the views that
  take them — the usage report, the lobby's per-team cards, the organization's
  issue list — reach across teams, which is the one thing the per-team entity
  store does not answer.
*/

export interface OrganizationViewData {
  /** Every agent run this organization billed in the last 90 days. */
  readonly loadUsageReport: () => Promise<AgentUsageReport>;
  /** A team's usage summary, cached per team and period. */
  readonly loadTeamHomeUsage: ReturnType<
    typeof createCachedTeamUsageSummaryLoader
  >;
  /**
   * Another team's board, without selecting it. `null` means "there is nothing
   * to apply" — the store already holds this team, or there is no session.
   */
  readonly loadOrganizationTeamDashboard: MyIssuesDashboardLoader;
  /** Selects the issue's team if needed, then opens the issue. */
  readonly openOrganizationIssue: (teamId: string, runId: string) => void;
}

export function useOrganizationViewData(): OrganizationViewData {
  const registry = useRegistry();
  const { toast } = useToast();
  const token = useAtomValue(tokenAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const { ensureTeamSelected } = useTeamActions();
  const { navigateToIssue } = useNavigationActions();
  const setRequestedRunId = useAtomSet(requestedRunIdAtom);
  const setRequestedRunMessageId = useAtomSet(requestedRunMessageIdAtom);
  const setRequestedRunInitialTab = useAtomSet(requestedRunInitialTabAtom);
  const setIssueListRequestKey = useAtomSet(issueListRequestKeyAtom);
  const setRequestedSessionId = useAtomSet(requestedSessionIdAtom);

  const loadUsageReport = useCallback(async () => {
    if (!token || !activeOrganizationId) {
      return {
        runs: [],
        generatedAt: new Date().toISOString(),
        pricing: {
          status: "unavailable" as const,
          source: LITELLM_MAIN_PRICING_SOURCE,
          fetchedAt: null,
          knownModels: 0,
        },
      };
    }
    return loadAgentUsageReport(token, activeOrganizationId, 90);
  }, [activeOrganizationId, token]);

  const loadTeamHomeUsage = useMemo(
    () =>
      createCachedTeamUsageSummaryLoader(async (teamId, period, range) => {
        if (!token) return null;
        return loadProjectUsageSummary(token, teamId, period, range);
      }),
    [token],
  );

  const loadOrganizationTeamDashboard = useCallback(
    (teamId: string, signal: AbortSignal) => {
      /*
        The team on screen is already in the store, so there is nothing to
        apply for it — which is also what keeps demo mode, where there is no
        server to ask, showing its own board on the organization pages.
        Everything else is a `loadDashboard` response, which the caller applies
        through `applySyncEvent`; the check reads the registry at call time, the
        way the render phase ref assignment this replaced was working around.
      */
      if (registry.get(loadedTeamIdAtom) === teamId) {
        return Promise.resolve(null);
      }
      if (!token) return Promise.resolve(null);
      return loadDashboard(token, teamId, signal);
    },
    [registry, token],
  );

  const openOrganizationIssue = useCallback(
    (teamId: string, runId: string) => {
      void (async () => {
        setRequestedSessionId(null);
        setRequestedRunMessageId(null);
        setRequestedRunInitialTab(null);
        setRequestedRunId(runId);
        setIssueListRequestKey((key) => key + 1);
        if (teamId !== registry.get(activeTeamIdAtom)) {
          await ensureTeamSelected(teamId);
        }
        navigateToIssue(runId, teamId);
      })().catch((caught) => {
        toast(caught instanceof Error ? caught.message : String(caught), {
          tone: "error",
        });
      });
    },
    [ensureTeamSelected, navigateToIssue, registry, toast],
  );

  return {
    loadOrganizationTeamDashboard,
    loadTeamHomeUsage,
    loadUsageReport,
    openOrganizationIssue,
  };
}
