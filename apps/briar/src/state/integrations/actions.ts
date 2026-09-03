import { useMemo } from "react";

import type { VelenInspection } from "../../generated/tauri";
import {
  isRepositoryConnectedForImport,
  type LinearStatusMapping,
} from "../../lib/linear-import";
import type { TeamSettings } from "../../types";
import { demoUser } from "../demo-fixtures";
import { useRegistry, type AtomRegistry } from "../registry";
import { sessionErrorAtom, tokenAtom } from "../session/atoms";
import { commitTeamSettings } from "../sync/commit";
import { getTeamSyncLoader } from "../sync/loader";
import { activeDashboardAtom } from "../sync/view";
import { activeTeamIdAtom } from "../team/atoms";
import { resolveWorkspaceApi, workspaceModes, type WorkspaceApi } from "../workspace/api";
import { connectedTeamIdsAtom, healthAtom } from "../workspace/atoms";
import { velenAtom } from "./atoms";

/*
  The two external systems a team can be wired to: Velen, which supplies the
  data sources an agent may query, and Linear, whose issues can be imported once.

  Both write team settings, so both keep the same local-then-server ordering the
  workflow writes use: the Velen organization is written to this device's config
  first and rolled back if the server refuses, because a config pointing at an
  organization the team never accepted would let an agent query the wrong data.
*/

export interface IntegrationActionDeps {
  readonly api?: Partial<WorkspaceApi> | undefined;
}

export type LinearImportInput = {
  readonly apiKey: string;
  readonly teamIds: string[];
};

export interface IntegrationActions {
  readonly connectLinearForImport: (
    teamId: string,
    apiKey: string,
  ) => Promise<
    Awaited<ReturnType<WorkspaceApi["connectLinearImport"]>>
  >;
  readonly loadLinearStatesForImport: (
    teamId: string,
    input: LinearImportInput,
  ) => Promise<Awaited<ReturnType<WorkspaceApi["loadLinearImportStates"]>>>;
  readonly refreshVelen: (
    org?: string | null,
  ) => Promise<VelenInspection | null>;
  readonly runLinearIssueImport: (
    teamId: string,
    input: LinearImportInput & { statusMapping: LinearStatusMapping },
  ) => Promise<Awaited<ReturnType<WorkspaceApi["importLinearIssues"]>>>;
  readonly saveVelenIntegration: (
    teamId: string,
    org: string | null,
  ) => Promise<string | null>;
}

export function createIntegrationActions(
  registry: AtomRegistry,
  deps: IntegrationActionDeps = {},
): IntegrationActions {
  const api = () => resolveWorkspaceApi(registry, deps.api);
  const modes = () => workspaceModes(registry);

  const requireToken = () => {
    const token = registry.get(tokenAtom);
    if (!token) throw new Error("로그인이 필요합니다.");
    return token;
  };

  /** The rendered team's settings, or `null` when another team is on screen. */
  const renderedSettings = (teamId: string): TeamSettings | null => {
    const dashboard = registry.get(activeDashboardAtom);
    return dashboard && dashboard.team.id === teamId ? dashboard.settings : null;
  };

  /**
   * Linear issues land in a repository, so there has to be one. Either the team
   * settings name a GitHub repository, or this device has a checkout — the same
   * two-sided check the settings panel renders its "connect first" notice from.
   */
  const assertRepositoryReadyForImport = (teamId: string) => {
    const health = registry.get(healthAtom).value;
    const ready = isRepositoryConnectedForImport({
      projectId: teamId,
      connectedTeamIds: registry.get(connectedTeamIdsAtom),
      githubRepository: renderedSettings(teamId)?.githubRepository ?? null,
      repositoryPath:
        health?.projectId === teamId ? health.repositoryPath : null,
    });
    if (!ready) {
      throw new Error("저장소를 연결한 뒤에 Linear 이슈를 가져올 수 있습니다.");
    }
  };

  return {
    async refreshVelen(org) {
      if (modes().demoMode) {
        const inspection: VelenInspection = {
          authenticated: true,
          email: demoUser.email,
          currentOrg: org ?? "wordbricks",
          organizations: [{ name: "Wordbricks", slug: "wordbricks" }],
          sources: [
            {
              sourceKey: "linear-wordbricks",
              sourceRef: "linear://linear-wordbricks",
              provider: "linear",
              status: "active",
            },
          ],
        };
        registry.set(velenAtom, inspection);
        return inspection;
      }
      try {
        const inspection = await api().inspectVelen(org);
        registry.set(velenAtom, inspection);
        registry.set(sessionErrorAtom, null);
        return inspection;
      } catch (caught) {
        registry.set(velenAtom, null);
        registry.set(
          sessionErrorAtom,
          caught instanceof Error ? caught.message : String(caught),
        );
        return null;
      }
    },

    async saveVelenIntegration(teamId, org) {
      const settings = renderedSettings(teamId);
      if (!settings) {
        throw new Error("Velen 연결을 저장할 팀 설정이 없습니다.");
      }
      const normalized = org?.trim() || null;
      /*
        Clearing the organization clears what depended on it. A data source and
        a Linear connection are both addressed through the Velen organization,
        so leaving them behind would point the team at rows it can no longer
        reach.
      */
      const { demoMode, remoteMode } = modes();
      if (demoMode) {
        commitTeamSettings(registry, teamId, {
          ...settings,
          velenOrg: normalized,
          ...(normalized
            ? {}
            : {
                dataSource: null,
                linear: { enabled: false, source: null, teamKey: null },
              }),
        });
        return normalized;
      }
      const token = requireToken();
      const remote = api();

      const previous = settings.velenOrg;
      const local = remoteMode
        ? normalized
        : await remote.updateLocalTeamVelenOrg(teamId, normalized);
      try {
        const result = await remote.updateTeamSettings(token, teamId, {
          ...settings,
          velenOrg: local,
          ...(local
            ? {}
            : {
                dataSource: null,
                linear: { enabled: false, source: null, teamKey: null },
              }),
        });
        commitTeamSettings(registry, teamId, result.settings);
        return result.settings.velenOrg;
      } catch (caught) {
        if (!remoteMode) {
          try {
            await remote.updateLocalTeamVelenOrg(teamId, previous);
          } catch (rollbackError) {
            const cause =
              caught instanceof Error ? caught.message : String(caught);
            const rollback =
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError);
            throw new Error(
              `Velen 연결 저장에 실패했고 로컬 설정도 복구하지 못했습니다: ${cause} (${rollback})`,
            );
          }
        }
        throw caught;
      }
    },

    async connectLinearForImport(teamId, apiKey) {
      assertRepositoryReadyForImport(teamId);
      if (modes().demoMode) {
        return {
          viewer: {
            name: "Demo User",
            email: "demo@example.com",
            organizationName: "Demo Org",
          },
          teams: [
            { id: "team-demo", name: "Demo Team", key: "DEMO" },
            { id: "team-briar", name: "Briar", key: "BRI" },
          ],
        };
      }
      return api().connectLinearImport(requireToken(), teamId, apiKey);
    },

    async loadLinearStatesForImport(teamId, input) {
      assertRepositoryReadyForImport(teamId);
      if (modes().demoMode) {
        const linearTeamId = input.teamIds[0] ?? "team-demo";
        const demoState = (
          id: string,
          name: string,
          type: string,
          color: string,
          position: number,
        ) => ({
          id,
          name,
          type,
          color,
          position,
          teamId: linearTeamId,
          teamKey: "DEMO",
          teamName: "Demo Team",
        });
        return {
          states: [
            demoState("state-backlog", "Backlog", "backlog", "#bec2c8", 0),
            demoState("state-started", "In Progress", "started", "#f2c94c", 1),
            demoState("state-done", "Done", "completed", "#5e6ad2", 2),
          ],
        };
      }
      return api().loadLinearImportStates(requireToken(), teamId, input);
    },

    async runLinearIssueImport(teamId, input) {
      assertRepositoryReadyForImport(teamId);
      if (modes().demoMode) {
        return {
          imported: 3,
          skipped: 0,
          failed: 0,
          total: 3,
          truncated: false,
          relations: {
            hierarchy: { linked: 1, skipped: 0, outsideScope: 0, cycles: 0 },
            related: { linked: 1, skipped: 0, outsideScope: 0 },
            dependencies: { linked: 1, skipped: 0, outsideScope: 0, cycles: 0 },
            unsupported: { duplicate: 0, similar: 0 },
          },
        };
      }
      const result = await api().importLinearIssues(
        requireToken(),
        teamId,
        input,
      );
      if (registry.get(activeTeamIdAtom) === teamId) {
        await getTeamSyncLoader(registry).refresh(teamId, "snapshot");
      }
      return result;
    },
  };
}

export function useIntegrationActions(
  deps: IntegrationActionDeps = {},
): IntegrationActions {
  const registry = useRegistry();
  const { api } = deps;
  return useMemo(
    () => createIntegrationActions(registry, { api }),
    [api, registry],
  );
}
