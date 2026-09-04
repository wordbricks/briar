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
import type { MyIssuesTeamBoard } from "../components/MyIssues";
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
import { teamMembersAtom } from "../state/entities/members";
import { teamRunsAtom } from "../state/entities/runs";
import { teamEntityAtom } from "../state/entities/teams";
import {
  activeTeamIdAtom,
  loadedTeamIdAtom,
  teamSettingsAtom,
} from "../state/team/atoms";

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
  /** Another team's board, without selecting it. */
  readonly loadOrganizationTeamDashboard: (
    teamId: string,
    signal: AbortSignal,
  ) => Promise<MyIssuesTeamBoard | null>;
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
        The team on screen is already in the store, down to the four
        projections this page reads, so it is answered from there rather than
        fetched again — which is also what keeps demo mode, where there is no
        server to ask, showing its own board here. Everything else is a
        `loadDashboard` response, read at call time from the registry the way
        the render phase ref assignment this replaced was working around.
      */
      const settings =
        registry.get(loadedTeamIdAtom) === teamId
          ? registry.get(teamSettingsAtom(teamId))
          : null;
      const team = settings ? registry.get(teamEntityAtom(teamId)) : null;
      const runs = team ? registry.get(teamRunsAtom(teamId)) : null;
      if (settings && team && runs) {
        return Promise.resolve({
          team,
          settings,
          runs,
          members: registry.get(teamMembersAtom(teamId)) ?? undefined,
        });
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
