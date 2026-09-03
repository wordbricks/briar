import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import type {
  PreparedProjectRepository,
  RepositoryReadiness,
} from "../../generated/tauri";
import { errorWithMessage, type TeamIconUpdate } from "../../lib/api";
import {
  isRepositoryWorkflowPending,
  type AutoHuntWorkflow,
} from "../../lib/auto-hunt-contract";
import { demoDashboard } from "../../lib/demo-data";
import { defaultIssueKeyPrefix } from "../../lib/issue-key";
import { withoutConnectedProject } from "../../lib/local-team-connection";
import {
  prepareConfiguredTeamRepository,
  resolveTeamConnectionWorkflow,
  type LocalAutoHuntConfig,
} from "../../lib/team-connection";
import { teamIconFromDataUrl } from "../../lib/team-icon";
import type { TeamLlmProgress } from "../../lib/team-llm";
import type { Project, TeamSettings } from "../../types";
import { demoOrganization, emptyDashboard } from "../demo-fixtures";
import { teamsByIdAtom } from "../entities/teams";
import { upsertManyBy } from "../entities/upsert";
import { velenAtom } from "../integrations/atoms";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { useRegistry, type AtomRegistry } from "../registry";
import { loadingAtom, sessionErrorAtom, tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { commitTeamSettings, commitTeamSnapshot } from "../sync/commit";
import { getTeamSyncLoader } from "../sync/loader";
import { activeDashboardAtom, dashboardViewAtom } from "../sync/view";
import {
  activeTeamIdAtom,
  deletingTeamIdAtom,
  isCreatingTeamAtom,
  teamConnectionAtom,
  teamsAtom,
} from "../team/atoms";
import { lockedTeamIdAtom } from "../platform";
import { getAutomaticWorkflowGenerations } from "../workflow/actions";
import {
  bumpReconnectRequest,
  getReadinessCoordinator,
  isCurrentReconnectRequest,
  resolveWorkspaceApi,
  workspaceModes,
  type WorkspaceApi,
} from "./api";
import {
  applyInventoryObservation,
  clearTeamReadinessError,
  connectedTeamIdsAtom,
  forgetTeamReadiness,
  resetHealth,
  setTeamReadiness,
  setTeamReadinessError,
  setTeamReadinessLoading,
} from "./atoms";
import { refreshTeamHealth, repairTeamHealth } from "./health";
import { refreshTeamReadiness } from "./readiness";

/*
  Everything a user does to the link between a team and a repository: creating
  and deleting the team, connecting a checkout to this device, preparing one
  from the organization's GitHub App, and probing what came out.

  These were fifteen `useCallback`s in `useBriar` spread across the local
  inventory, the readiness records and the health probe. They read all three
  through the registry at call time now, so the dependency arrays that rebuilt
  them on every dashboard tick are gone, and the transitions they perform are
  the writers in `./atoms.ts` rather than seven `useState` setters that could be
  left half applied.

  What did not change is the order of each flow: which guard throws which
  message, when the local config is written relative to the server, and what
  demo mode substitutes for both.
*/

export interface WorkspaceActionDeps {
  readonly api?: Partial<WorkspaceApi> | undefined;
}

/** Whether a reconnect attempt opened, failed, or was replaced by a newer one. */
export type ReconnectOutcome = "opened" | "failed" | "superseded";

export function createWorkspaceActions(
  registry: AtomRegistry,
  deps: WorkspaceActionDeps = {},
) {
  const api = () => resolveWorkspaceApi(registry, deps.api);
  const modes = () => workspaceModes(registry);
  const loader = getTeamSyncLoader(registry);
  const coordinator = getReadinessCoordinator(registry);

  const setError = (error: string | null) =>
    registry.set(sessionErrorAtom, error);
  const messageOf = (caught: unknown) =>
    caught instanceof Error ? caught.message : String(caught);

  const requireToken = () => {
    const token = registry.get(tokenAtom);
    if (!token) throw new Error("로그인이 필요합니다.");
    return token;
  };

  const findTeam = (teamId: string) =>
    registry.get(teamsAtom).find((candidate) => candidate.id === teamId) ?? null;

  /** The selected team, when its payload is the one on screen. */
  const renderedTeamId = () => {
    const teamId = registry.get(activeTeamIdAtom);
    return teamId !== null && registry.get(dashboardViewAtom(teamId))
      ? teamId
      : null;
  };

  const refreshReadiness = (teamId: string) =>
    refreshTeamReadiness(registry, teamId);

  return {
    /* — the local inventory and the probes over it — */

    refreshHealth: () => refreshTeamHealth(registry),
    repairHealth: () => repairTeamHealth(registry),
    refreshProjectReadiness: refreshReadiness,

    /* — picking and preparing a repository — */

    async selectProjectRepository(): Promise<string | null> {
      setError(null);
      try {
        return await api().pickGitRepository();
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      }
    },

    async createProjectRepository(name: string) {
      setError(null);
      return await api().createTeamWorkspace(name);
    },

    inspectProjectRepository: (
      repositoryPath: string,
      workflow: AutoHuntWorkflow,
    ): Promise<RepositoryReadiness> =>
      api().inspectRepositoryReadiness(repositoryPath, workflow),

    inspectLovableProject: (repositoryPath: string) =>
      api().inspectLovableRepositoryCompatibility(repositoryPath),

    preflightProjectConnection: (
      autoHunt: LocalAutoHuntConfig,
      repositoryPath: string,
    ) => api().preflightLocalTeamConnection({ autoHunt, repositoryPath }),

    /**
     * Points a team at a repository the organization's GitHub App can reach and
     * prepares a local checkout of it. The settings write comes first: the
     * prepared checkout is verified against the repository the team settings
     * name, so those settings have to be the ones the server accepted.
     */
    async prepareGithubProjectRepository(
      teamId: string,
      githubRepository: string,
    ): Promise<PreparedProjectRepository> {
      const token = requireToken();
      const remote = api();
      registry.set(loadingAtom, true);
      setError(null);
      try {
        const teamDashboard = await remote.loadDashboard(token, teamId);
        const saved = await remote.updateTeamSettings(token, teamId, {
          ...teamDashboard.settings,
          githubRepository,
        });
        const { credential, prepared } = await prepareConfiguredTeamRepository(
          saved.settings,
          () => remote.createProjectGithubCredential(token, teamId),
          (teamCredential) => remote.prepareTeamRepository(teamId, teamCredential),
        );
        const connectedSettings = {
          ...saved.settings,
          githubRepositoryId: credential.repository.id,
          githubRepository: credential.repository.fullName,
        };
        if (renderedTeamId() === teamId) {
          commitTeamSettings(registry, teamId, connectedSettings);
        } else {
          commitTeamSnapshot(registry, teamId, {
            ...teamDashboard,
            settings: connectedSettings,
          });
        }
        registry.update(teamConnectionAtom, (current) =>
          current?.project.id === teamId
            ? { ...current, workflow: connectedSettings.workflow }
            : current,
        );
        return prepared;
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        registry.set(loadingAtom, false);
      }
    },

    async resolveGithubProjectRepository(
      githubRepository: string,
    ): Promise<string> {
      const token = requireToken();
      const organizationId = registry.get(activeOrganizationIdAtom);
      if (!organizationId) {
        throw new Error("GitHub App을 연결할 조직을 먼저 선택해 주세요.");
      }
      const integration = await api().loadGithubIntegration(
        token,
        organizationId,
      );
      if (!integration.connected) {
        throw new Error("조직 설정에서 GitHub App을 먼저 연결해 주세요.");
      }
      const repository = integration.repositories.find(
        (candidate) =>
          candidate.fullName.toLowerCase() === githubRepository.toLowerCase(),
      );
      if (!repository) {
        throw new Error(
          "입력한 저장소가 조직 GitHub App의 저장소 접근 범위에 없습니다.",
        );
      }
      return repository.fullName;
    },

    /* — the team lifecycle — */

    async addProject(input: { name: string }) {
      if (modes().demoMode) {
        const organization =
          registry
            .get(organizationsAtom)
            .find(
              (candidate) =>
                candidate.id === registry.get(activeOrganizationIdAtom),
            ) ?? demoOrganization;
        const project: Project = {
          id: crypto.randomUUID(),
          name: input.name.trim(),
          issueKeyPrefix: defaultIssueKeyPrefix,
          scheduleTabEnabled: true,
          icon: null,
          iconName: null,
          iconColor: null,
          organizationId: organization.id,
          organizationName: organization.name,
          role: organization.role,
          createdAt: new Date().toISOString(),
        };
        Atom.batch(() => {
          registry.update(teamsAtom, (current) => [...current, project]);
          registry.set(activeOrganizationIdAtom, organization.id);
          registry.set(activeTeamIdAtom, project.id);
        });
        commitTeamSnapshot(registry, project.id, emptyDashboard(project));
        Atom.batch(() => {
          setError(null);
          registry.set(isCreatingTeamAtom, false);
        });
        return { project, agentToken: null };
      }
      const token = requireToken();
      const remote = api();
      registry.set(loadingAtom, true);
      setError(null);
      try {
        const result = await remote.createTeam(token, {
          ...input,
          organizationId: registry.get(activeOrganizationIdAtom) ?? undefined,
        });
        const nextOrganizations = await remote
          .loadOrganizations(token)
          .catch(() => null);
        Atom.batch(() => {
          registry.update(teamsAtom, (current) => [...current, result.project]);
          if (nextOrganizations) {
            registry.set(organizationsAtom, nextOrganizations);
          }
          registry.set(activeOrganizationIdAtom, result.project.organizationId);
          registry.set(activeTeamIdAtom, result.project.id);
          registry.set(isCreatingTeamAtom, false);
          registry.set(velenAtom, null);
          registry.set(teamConnectionAtom, { ...result, kind: "new" });
        });
        return result;
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        registry.set(loadingAtom, false);
      }
    },

    async removeProject(teamId: string): Promise<void> {
      bumpReconnectRequest(registry);
      const teams = registry.get(teamsAtom);
      const team = teams.find((candidate) => candidate.id === teamId);
      if (!team) throw new Error("삭제할 프로젝트가 없습니다.");
      const { demoMode } = modes();
      registry.set(deletingTeamIdAtom, teamId);
      setError(null);
      try {
        let localCleanupWarning: string | null = null;
        if (!demoMode) {
          const token = requireToken();
          await api().deleteTeam(token, teamId);
          try {
            await api().disconnectLocalTeam(teamId);
          } catch (caught) {
            localCleanupWarning = messageOf(caught);
          }
        }

        const activeTeamId = registry.get(activeTeamIdAtom);
        const activeOrganizationId = registry.get(activeOrganizationIdAtom);
        const lockedTeamId = registry.get(lockedTeamIdAtom);
        const remaining = teams.filter((candidate) => candidate.id !== teamId);
        const deletedActiveTeam = activeTeamId === teamId;
        const nextActiveTeam =
          deletedActiveTeam && lockedTeamId
            ? null
            : deletedActiveTeam
              ? (remaining.find(
                  (candidate) =>
                    candidate.organizationId === activeOrganizationId,
                ) ??
                remaining[0] ??
                null)
              : (remaining.find((candidate) => candidate.id === activeTeamId) ??
                null);
        Atom.batch(() => {
          registry.set(teamsAtom, remaining);
          if (nextActiveTeam?.organizationId) {
            registry.set(
              activeOrganizationIdAtom,
              nextActiveTeam.organizationId,
            );
          }
          registry.set(activeTeamIdAtom, nextActiveTeam?.id ?? null);
          registry.set(teamConnectionAtom, null);
          registry.update(connectedTeamIdsAtom, (current) =>
            withoutConnectedProject(current, teamId),
          );
          forgetTeamReadiness(registry, teamId);
        });
        if (deletedActiveTeam) {
          if (demoMode && nextActiveTeam) {
            commitTeamSnapshot(
              registry,
              nextActiveTeam.id,
              nextActiveTeam.id === demoDashboard.team.id
                ? demoDashboard
                : emptyDashboard(nextActiveTeam),
            );
          } else {
            // The selection already moved on, so this drops whatever the team
            // taking over had stored rather than the deleted team's payload —
            // the behaviour the payload level setter had.
            loader.cancelAll();
            const clearedTeamId = registry.get(activeTeamIdAtom);
            if (clearedTeamId) {
              applySyncEvent(registry, {
                kind: "team-cleared",
                teamId: clearedTeamId,
              });
            }
          }
          resetHealth(registry);
          if (!demoMode && registry.get(tokenAtom) && nextActiveTeam) {
            // The loader reports its own failures through the session error the
            // hand written catch used to set.
            await loader.refresh(nextActiveTeam.id, "snapshot");
          }
        }
        if (localCleanupWarning) {
          setError(
            `프로젝트는 삭제했지만 로컬 연결 정리에 실패했습니다: ${localCleanupWarning}`,
          );
        }
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        registry.set(deletingTeamIdAtom, null);
      }
    },

    /* — connecting a repository to this device — */

    /**
     * Commits the connection the onboarding flow collected: the local config
     * first, then the workflow, then the team settings that share it. The local
     * write is the commit boundary — everything after it may be retried without
     * the UI disagreeing with what is on disk.
     */
    async connectProject(
      autoHunt: LocalAutoHuntConfig,
      repositoryPath: string,
      onWorkflowProgress?: (progress: TeamLlmProgress) => void,
    ) {
      const connection = registry.get(teamConnectionAtom);
      if (!connection) throw new Error("연결할 프로젝트가 없습니다.");
      if (!repositoryPath) throw new Error("연결할 Git 저장소를 선택하세요.");
      const token = registry.get(tokenAtom);
      if (!token && !connection.agentToken) {
        throw new Error("로그인이 필요합니다.");
      }
      const remote = api();
      const teamId = connection.project.id;
      registry.set(loadingAtom, true);
      setError(null);
      try {
        const agentToken =
          connection.agentToken ??
          (await remote.createAgentToken(token!, teamId)).agentToken;
        if (!connection.agentToken) {
          registry.update(teamConnectionAtom, (current) =>
            current?.project.id === teamId
              ? { ...current, agentToken }
              : current,
          );
        }
        const connected = await remote.connectLocalTeam({
          projectId: teamId,
          agentToken,
          repositoryPath,
          autoHunt,
        });
        // The local config write is the connection commit boundary. Reflect it
        // immediately; later workflow analysis and optional worker setup may be
        // retried without letting the UI disagree with disk.
        const inventoryObservation = await coordinator.inspectInventory(true);
        const connectedInventory = applyInventoryObservation(
          registry,
          inventoryObservation,
        );
        if (inventoryObservation.status === "error") {
          throw inventoryObservation.error instanceof Error
            ? inventoryObservation.error
            : new Error(String(inventoryObservation.error));
        }
        if (!connectedInventory?.includes(teamId)) {
          throw new Error("저장된 로컬 프로젝트 연결을 다시 확인하지 못했습니다.");
        }
        const { workflow: generatedWorkflow, shouldPersistTeamSettings } =
          await resolveTeamConnectionWorkflow(
            connection.project.role,
            connection.workflow,
            () =>
              remote.generateTeamWorkflow(teamId, undefined, onWorkflowProgress),
            !isRepositoryWorkflowPending(autoHunt.workflow)
              ? autoHunt.workflow
              : undefined,
          );
        await remote.updateLocalTeamWorkflow(teamId, generatedWorkflow);

        const initialSettings: TeamSettings = {
          velenOrg: autoHunt.velenOrg,
          dataSource: autoHunt.dataSource ?? null,
          linear: {
            enabled: autoHunt.linearEnabled,
            source: autoHunt.linearSource ?? null,
            teamKey: autoHunt.linearTeam ?? null,
          },
          githubRepositoryId: autoHunt.githubRepositoryId ?? null,
          githubRepository: autoHunt.githubRepository ?? null,
          workflow: generatedWorkflow,
        };
        let savedSettings = initialSettings;
        if (token && shouldPersistTeamSettings) {
          const saved = await remote.updateTeamSettings(
            token,
            teamId,
            initialSettings,
          );
          savedSettings = saved.settings;
          registry.update(teamConnectionAtom, (current) =>
            current?.project.id === teamId
              ? { ...current, workflow: generatedWorkflow }
              : current,
          );
        }

        let connectedTeam = connection.project;
        if (token && !connectedTeam.icon && !connectedTeam.iconName) {
          try {
            const discovered = await remote.discoverRepositoryIcon(
              connected.repositoryPath,
            );
            if (discovered) {
              const icon = await teamIconFromDataUrl(discovered);
              const update: TeamIconUpdate = { type: "image", dataUrl: icon };
              connectedTeam = (
                await remote.updateTeamIcon(token, connectedTeam.id, update)
              ).project;
              registry.update(teamsAtom, (current) =>
                current.map((candidate) =>
                  candidate.id === connectedTeam.id ? connectedTeam : candidate,
                ),
              );
            }
          } catch (iconError) {
            console.warn(
              "Failed to discover the connected repository icon",
              iconError,
            );
          }
        }

        if (shouldPersistTeamSettings) {
          if (renderedTeamId() === teamId) {
            commitTeamSettings(registry, teamId, savedSettings);
            registry.update(teamsByIdAtom, (teams) =>
              upsertManyBy(teams, [connectedTeam], () => teamId),
            );
          } else {
            commitTeamSnapshot(registry, teamId, {
              ...emptyDashboard(connectedTeam),
              settings: savedSettings,
            });
          }
        }
        if (connection.kind === "new" && token) {
          await remote.configureLocalExecutionWorker(teamId, token, true);
        }
        registry.update(teamConnectionAtom, (current) =>
          current?.project.id === teamId
            ? {
                ...current,
                project: connectedTeam,
                workflow: generatedWorkflow,
              }
            : current,
        );
        setError(null);
        await refreshReadiness(teamId);

        return {
          repositoryPath: connected.repositoryPath,
          workflow: generatedWorkflow,
        };
      } catch (caught) {
        const message = messageOf(caught);
        setError(message);
        throw errorWithMessage(caught, message);
      } finally {
        registry.set(loadingAtom, false);
      }
    },

    /**
     * Prepares a checkout of a team already configured with a GitHub repository
     * and connects it to this device, so a second machine can join a team it did
     * not set up.
     */
    async startWorkingOnProject(teamId: string) {
      const token = requireToken();
      const team = findTeam(teamId);
      if (!team) throw new Error("프로젝트를 찾지 못했습니다.");
      const remote = api();
      const request = coordinator.begin(teamId);
      const isCurrent = () => coordinator.isCurrent(teamId, request);
      setTeamReadinessLoading(registry, teamId, true);
      clearTeamReadinessError(registry, teamId);
      try {
        const dashboard = registry.get(activeDashboardAtom);
        const teamDashboard =
          dashboard?.team.id === teamId
            ? dashboard
            : await remote.loadDashboard(token, teamId);
        const settings = teamDashboard.settings;
        const { credential, prepared } = await prepareConfiguredTeamRepository(
          settings,
          () => remote.createProjectGithubCredential(token, teamId),
          (teamCredential) => remote.prepareTeamRepository(teamId, teamCredential),
        );
        const connectedSettings = {
          ...settings,
          githubRepositoryId: credential.repository.id,
          githubRepository: credential.repository.fullName,
        };
        const agentToken = (await remote.createAgentToken(token, teamId))
          .agentToken;
        await remote.connectLocalTeam({
          projectId: teamId,
          agentToken,
          repositoryPath: prepared.repositoryPath,
          autoHunt: {
            velenOrg: settings.velenOrg,
            dataSource: settings.dataSource,
            linearEnabled: settings.linear.enabled,
            linearSource: settings.linear.source,
            linearTeam: settings.linear.teamKey,
            githubRepositoryId: connectedSettings.githubRepositoryId,
            githubRepository: connectedSettings.githubRepository,
            workflow: settings.workflow,
          },
        });
        const inventory = await coordinator.inspectInventory(true);
        const connected = applyInventoryObservation(registry, inventory);
        if (inventory.status === "error") throw inventory.error;
        if (!connected?.includes(teamId)) {
          throw new Error("저장소 연결 상태를 다시 확인하지 못했습니다.");
        }
        await remote.configureLocalExecutionWorker(teamId, token, true);
        const readiness = await remote.loadTeamRepositoryReadiness(teamId);
        if (!readiness) {
          throw new Error("준비한 저장소 상태를 확인하지 못했습니다.");
        }
        if (!isCurrent()) return null;
        setTeamReadiness(registry, teamId, readiness);
        commitTeamSettings(registry, teamId, connectedSettings);
        return { prepared, readiness };
      } catch (caught) {
        if (!isCurrent()) return null;
        setTeamReadinessError(registry, teamId, messageOf(caught));
        throw caught;
      } finally {
        if (isCurrent()) setTeamReadinessLoading(registry, teamId, false);
      }
    },

    /**
     * Reopens the connection flow for a team, seeded with the workflow it
     * already has. A repository generation started automatically for the same
     * team is joined rather than duplicated.
     */
    async reconnectProject(
      teamId: string | null = registry.get(activeTeamIdAtom),
    ): Promise<ReconnectOutcome> {
      const request = bumpReconnectRequest(registry);
      const team = teamId === null ? null : findTeam(teamId);
      if (!team) return "failed";
      setError(null);
      let workflow: TeamSettings["workflow"];
      try {
        const automaticGeneration = getAutomaticWorkflowGenerations(
          registry,
        ).get(team.id);
        const dashboard = registry.get(activeDashboardAtom);
        if (automaticGeneration) {
          // Reuse the repository analysis already in flight. Opening reconnect
          // must not launch a second LLM generation from the same pending
          // workflow snapshot.
          workflow = await automaticGeneration;
        } else if (dashboard?.team.id === team.id) {
          workflow = dashboard.settings.workflow;
        } else {
          const token = requireToken();
          workflow = (await api().loadDashboard(token, team.id)).settings
            .workflow;
        }
      } catch (caught) {
        if (isCurrentReconnectRequest(registry, request)) {
          setError(messageOf(caught));
          return "failed";
        }
        return "superseded";
      }
      if (!isCurrentReconnectRequest(registry, request)) return "superseded";
      Atom.batch(() => {
        registry.set(velenAtom, null);
        registry.set(activeTeamIdAtom, team.id);
        registry.set(activeOrganizationIdAtom, team.organizationId);
        registry.set(isCreatingTeamAtom, true);
        registry.set(teamConnectionAtom, {
          kind: "reconnect",
          project: team,
          agentToken: null,
          workflow,
        });
      });
      return "opened";
    },
  };
}

export type WorkspaceActions = ReturnType<typeof createWorkspaceActions>;

export function useWorkspaceActions(
  deps: WorkspaceActionDeps = {},
): WorkspaceActions {
  const registry = useRegistry();
  const { api } = deps;
  return useMemo(
    () => createWorkspaceActions(registry, { api }),
    [api, registry],
  );
}
