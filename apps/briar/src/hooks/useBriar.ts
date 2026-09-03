import {
  useAtom,
  useAtomInitialValues,
  useAtomValue,
} from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AutoHuntSession } from "./useAutoHuntSessions";
import {
  acceptOrganizationInvitation as acceptRemoteOrganizationInvitation,
  beginDeviceAuthorization,
  claimProjectAgentScheduleRuns,
  completeProjectAgentScheduleRun,
  connectLinearImport,
  createAgentToken,
  createProjectGithubCredential,
  createOrganization as createRemoteOrganization,
  createTeam,
  deleteTeam as deleteRemoteProject,
  dispatchHuntRun,
  errorWithMessage,
  importLinearIssues,
  loadDashboard,
  loadDashboardDelta,
  loadGithubIntegration,
  loadLinearImportStates,
  loadOrganizations,
  loadTeams,
  loadTeamProjects,
  loadSession,
  pollDeviceToken,
  renewProjectAgentScheduleRun,
  retryHuntRun,
  updateTeamIcon as updateRemoteProjectIcon,
  updateTeamSettings,
  updateCheckpointPolicy,
  type DeviceAuthorizationLaunchOptions,
} from "../lib/api";
import {
  demoDashboard,
  demoRepositoryReadiness,
} from "../lib/demo-data";
import {
  isRepositoryConnectedForImport,
  type LinearStatusMapping,
} from "../lib/linear-import";
import {
  configureLocalExecutionWorker,
  connectLocalTeam,
  createTeamWorkspace,
  disconnectLocalTeam,
  discoverRepositoryIcon,
  inspectLovableRepositoryCompatibility,
  inspectVelen,
  inspectRepositoryReadiness,
  loadTeamRepositoryReadiness,
  loadAutoHuntHealth,
  loadConnectedTeamIds,
  prepareTeamRepository,
  pickGitRepository,
  preflightLocalTeamConnection,
  prepareConfiguredTeamRepository,
  repairAutoHunt,
  resolveTeamConnectionWorkflow,
  updateLocalTeamVelenOrg,
  updateLocalTeamWorkflow,
  type LocalAutoHuntConfig,
} from "../lib/team-connection";
import type {
  AutoHuntHealth,
  PreparedProjectRepository,
  RepositoryReadiness,
  VelenInspection,
} from "../generated/tauri";
import { teamIconFromDataUrl } from "../lib/team-icon";
import {
  createLocalProjectReadinessCoordinator,
  isTeamConnectedLocally,
  localTeamConnectionState,
  type LocalProjectInventoryObservation,
  type LocalTeamReadinessObservation,
  withoutConnectedProject,
} from "../lib/local-team-connection";
import {
  analyzeTeamWorkflowRequirements,
  generateTeamWorkflow,
  reviseTeamWorkflow,
} from "../lib/team-workflow";
import {
  shouldSyncSharedWorkflow,
  syncSharedProjectWorkflows,
} from "../lib/shared-workflow-sync";
import {
  clearSessionToken,
  readSessionToken,
  writeSessionToken,
} from "../lib/token-store";
import { restoreStoredSession } from "../lib/session-restore";
import { resolveActiveAccountSelection } from "../lib/active-organization";
import { ensureDefaultOrganization } from "../lib/default-organization";
import {
  isAuthorizationCancelled,
  openAuthorization,
} from "../lib/auth-session";
import {
  browserAuthClient,
  type BrowserAuthLocale,
} from "../lib/browser-auth-client";
import { browserCookieSessionCredential } from "../lib/session-credential";
import {
  isRepositoryWorkflowPending,
} from "../lib/auto-hunt-contract";
import { defaultIssueKeyPrefix } from "../lib/issue-key";
import { canonicalizeIssueAttachmentReferences } from "../lib/issue-markdown";
import { mergeIssueMessages } from "../lib/issue-message-merge";
import {
  runTeamAgent,
  type TeamLlmProgress,
} from "../lib/team-llm";
import { executeScheduledTeamAgent } from "../lib/team-agent-schedule-execution";
import { startTeamAgentSchedulePolling } from "../lib/team-agent-schedule-runner";
import type {
  ClaimedProjectAgentScheduleRun,
  DashboardPayload,
  HuntRun,
  Organization,
  Project,
  ProjectSettings,
} from "../types";
import {
  demoOrganization,
  demoUser,
  emptyDashboard,
} from "../state/demo-fixtures";
import {
  companionMode,
  demoMode,
  deviceClientId,
  remoteMode,
  webMode,
} from "../state/platform";
import { teamsByIdAtom } from "../state/entities/teams";
import { upsertManyBy } from "../state/entities/upsert";
import {
  useIssueActions,
  setIssueActionBridge,
} from "../state/issues/actions";
import {
  deletingIssueIdAtom,
  isCreatingIssueAtom,
  recoveringRunIdAtom,
  recoveryErrorAtom,
  updatingIssueIdAtom,
} from "../state/issues/atoms";
import { useRegistry } from "../state/registry";
import { useRunDetailActions } from "../state/run-detail/actions";
import {
  useOrganizationActions,
  type OrganizationActionDeps,
} from "../state/organization/actions";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../state/organization/atoms";
import { usePlanningActions } from "../state/planning/actions";
import { planningProjectsAtom } from "../state/planning/atoms";
import {
  useSessionActions,
  type SessionActionDeps,
} from "../state/session/actions";
import {
  loadingAtom,
  loginCodeAtom,
  restoringSessionAtom,
  sessionErrorAtom,
  tokenAtom,
  userAtom,
} from "../state/session/atoms";
import { useTeamActions, type TeamActionDeps } from "../state/team/actions";
import {
  activeTeamIdAtom,
  dashboardStaleAtom,
  deletingTeamIdAtom,
  isCreatingTeamAtom,
  teamConnectionAtom,
  teamSettingsAtom,
  teamsAtom,
} from "../state/team/atoms";
import { applySyncEvent, markTeamStale } from "../state/sync/apply";
import {
  teamSyncApiAtom,
  useTeamSyncLoader,
  type TeamSyncMode,
} from "../state/sync/loader";
import {
  activeDashboardAtom,
  dashboardViewAtom,
  loadedDashboardTeamIdAtom,
} from "../state/sync/view";

/**
 * Reads the hook performs on its own: session bootstrap, dashboard sync and the
 * local project inventory. They default to the live API, and tests supply
 * in-memory implementations so `useBriar` can be exercised without module
 * mocking. User triggered mutations keep calling the API directly.
 */
export type BriarDataSources = {
  loadConnectedTeamIds: typeof loadConnectedTeamIds;
  loadDashboard: typeof loadDashboard;
  loadDashboardDelta: typeof loadDashboardDelta;
  loadOrganizations: typeof loadOrganizations;
  loadSession: typeof loadSession;
  loadTeamProjects: typeof loadTeamProjects;
  loadTeams: typeof loadTeams;
};

const liveDataSources: BriarDataSources = {
  loadConnectedTeamIds,
  loadDashboard,
  loadDashboardDelta,
  loadOrganizations,
  loadSession,
  loadTeamProjects,
  loadTeams,
};

export type UseBriarOptions = {
  adoptRemoteAgentSession?: (session: AutoHuntSession) => void;
  deferDefaultOrganization?: boolean;
  lockedProjectId?: string | null;
  startScheduledAgentSession?: (
    run: ClaimedProjectAgentScheduleRun,
  ) => string | null;
  settleScheduledAgentSession?: (
    sessionId: string,
    input: {
      status: "completed" | "failed" | "skipped";
      conversationId: string | null;
      workspaceRoot: string | null;
      summary: string | null;
      error: string | null;
    },
  ) => void;
  startScheduledAgentWorkerDispatch?: (
    parentSessionId: string,
    run: ClaimedProjectAgentScheduleRun,
    runs: readonly HuntRun[],
    dispatch: { dispatchId: string; runIds: string[] },
  ) => void;
  dataSources?: Partial<BriarDataSources>;
};

export function useBriar(options: UseBriarOptions = {}) {
  const {
    adoptRemoteAgentSession,
    dataSources,
    deferDefaultOrganization = false,
    lockedProjectId = null,
    startScheduledAgentSession,
    startScheduledAgentWorkerDispatch,
    settleScheduledAgentSession,
  } = options;
  // Resolved once per hook instance so the seam keeps a stable identity.
  const dataSourcesRef = useRef<BriarDataSources | null>(null);
  dataSourcesRef.current ??= { ...liveDataSources, ...dataSources };
  const remote = dataSourcesRef.current;
  const registry = useRegistry();
  /*
    Two root atoms start from a demo default that a project window has to
    narrow: such a window is pinned to one team, and demo mode must not preselect
    a different one. The initial value therefore cannot live in the atom module,
    so it is seeded here — once per registry, before the first read below.

    The sync loader's reads are seeded the same way: the loader is shared with
    `useTeamSync`, which has no access to this hook's `dataSources` option.
  */
  useAtomInitialValues(
    useMemo(() => {
      const demoSelectionApplies =
        demoMode &&
        (!lockedProjectId || lockedProjectId === demoDashboard.team.id);
      return [
        [
          activeOrganizationIdAtom,
          demoSelectionApplies ? demoOrganization.id : null,
        ],
        [
          activeTeamIdAtom,
          demoSelectionApplies ? demoDashboard.team.id : null,
        ],
        [
          teamSyncApiAtom,
          {
            loadDashboard: remote.loadDashboard,
            loadDashboardDelta: remote.loadDashboardDelta,
          },
        ],
      ] as const;
    }, [lockedProjectId, remote]),
  );
  const [user, setUser] = useAtom(userAtom);
  const [token, setToken] = useAtom(tokenAtom);
  const [projects, setProjects] = useAtom(teamsAtom);
  const [planningProjects, setPlanningProjects] = useAtom(planningProjectsAtom);
  const [organizations, setOrganizations] = useAtom(organizationsAtom);

  useEffect(() => {
    if (demoMode) return;
    if (!token || projects.length === 0) {
      setPlanningProjects([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      projects.map((team) => remote.loadTeamProjects(token, team.id)),
    ).then((groups) => {
      if (!cancelled) setPlanningProjects(groups.flat());
    }).catch((caught) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projects, token]);
  const [activeOrganizationId, setActiveOrganizationId] = useAtom(
    activeOrganizationIdAtom,
  );
  const [activeProjectId, setActiveProjectId] = useAtom(activeTeamIdAtom);
  const [connectedTeamIds, setConnectedProjectIds] = useState<
    string[] | null
  >(demoMode ? [demoDashboard.team.id] : null);
  /*
    The dashboard is no longer state this hook owns. It is reassembled from the
    normalized entity store for whichever team is selected, so a team switch
    renders that team's last payload without a fetch and without this hook
    holding a per-team cache.
  */
  const dashboard = useAtomValue(activeDashboardAtom);
  const dashboardStale = useAtomValue(dashboardStaleAtom);
  const loader = useTeamSyncLoader();
  const [loading, setLoading] = useAtom(loadingAtom);
  const [restoringSession, setRestoringSession] = useAtom(restoringSessionAtom);
  const [loginCode, setLoginCode] = useAtom(loginCodeAtom);
  const [error, setError] = useAtom(sessionErrorAtom);
  const [localProjectInventoryError, setLocalProjectInventoryError] = useState<
    string | null
  >(null);
  const [projectConnection, setProjectConnection] = useAtom(teamConnectionAtom);
  const [isCreatingProject, setIsCreatingProject] = useAtom(isCreatingTeamAtom);
  const [deletingProjectId, setDeletingProjectId] = useAtom(deletingTeamIdAtom);
  /*
    The four issue mutation markers are one atom now, and the three run detail
    caches are `Atom.family`s the run detail view subscribes to directly. The
    facade only reads them back so `App.tsx` keeps its current props; Phase 2B's
    view work removes these reads with the props.
  */
  const isCreatingIssue = useAtomValue(isCreatingIssueAtom);
  const updatingIssueId = useAtomValue(updatingIssueIdAtom);
  const deletingIssueId = useAtomValue(deletingIssueIdAtom);
  const recoveringRunId = useAtomValue(recoveringRunIdAtom);
  const recoveryError = useAtomValue(recoveryErrorAtom);
  const [velen, setVelen] = useState<VelenInspection | null>(null);
  const [health, setHealth] = useState<AutoHuntHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [projectReadiness, setProjectReadiness] = useState<
    Record<string, RepositoryReadiness>
  >(
    demoMode
      ? { [demoDashboard.team.id]: demoRepositoryReadiness }
      : {},
  );
  const [projectReadinessError, setProjectReadinessError] = useState<
    Record<string, string>
  >({});
  const [projectReadinessLoadingProjects, setProjectReadinessLoadingProjects] =
    useState<Set<string>>(() => new Set());
  const pollTimer = useRef<number | null>(null);
  const pollLoginNow = useRef<(() => void) | null>(null);
  const loginAttempt = useRef(0);
  const reconnectRequest = useRef(0);
  const healthRequest = useRef(0);
  const readinessCoordinatorRef = useRef<ReturnType<
    typeof createLocalProjectReadinessCoordinator<RepositoryReadiness>
  > | null>(null);
  readinessCoordinatorRef.current ??= createLocalProjectReadinessCoordinator({
    loadConnectedTeamIds: remote.loadConnectedTeamIds,
    loadReadiness: loadTeamRepositoryReadiness,
  });
  const readinessCoordinator = readinessCoordinatorRef.current;
  const workflowGenerationAttempts = useRef(new Set<string>());
  const automaticWorkflowGenerations = useRef(
    new Map<string, Promise<ProjectSettings["workflow"]>>(),
  );
  /*
    What is left of `setDashboard`, split into the two writes its remaining
    callers actually perform. Both still cancel whatever is in flight before
    committing — dropping that would let a response already on the wire put the
    replaced value back — but neither rebuilds a whole payload, so a settings
    edit no longer looks like a new dashboard to every subscriber.

    The callers are the team connection, workflow and integration flows Phase 3
    moves into `state/workspace`. The issue and run writes that made up the rest
    of them now live in `state/issues/actions.ts`.
  */

  /** The selected team, when its payload is the one on screen. */
  const renderedTeamId = useCallback(() => {
    const teamId = registry.get(activeTeamIdAtom);
    return teamId !== null && registry.get(dashboardViewAtom(teamId))
      ? teamId
      : null;
  }, [registry]);

  /** Commits a whole payload as the given team's snapshot. */
  const commitTeamDashboard = useCallback(
    (payload: DashboardPayload) => {
      loader.cancelAll();
      applySyncEvent(registry, {
        kind: "team-snapshot",
        teamId: payload.team.id,
        payload,
      });
    },
    [loader, registry],
  );

  /** Rewrites the rendered team's settings, and nothing else. */
  const commitTeamSettings = useCallback(
    (teamId: string, settings: ProjectSettings) => {
      loader.cancelAll();
      if (renderedTeamId() !== teamId) return;
      registry.set(teamSettingsAtom(teamId), settings);
    },
    [loader, registry, renderedTeamId],
  );

  const setConnectedProjectInventory = useCallback((next: string[] | null) => {
    setConnectedProjectIds((current) => {
      if (current === next) return current;
      if (!current || !next || current.length !== next.length) return next;
      return current.every((projectId) => next.includes(projectId))
        ? current
        : next;
    });
  }, []);

  const applyLocalProjectInventoryObservation = useCallback((
    observation: LocalProjectInventoryObservation,
  ) => {
    setConnectedProjectInventory(observation.connectedTeamIds);
    setLocalProjectInventoryError(
      observation.status === "error"
        ? `로컬 프로젝트 연결 목록을 읽지 못했습니다: ${
            observation.error instanceof Error
              ? observation.error.message
              : String(observation.error)
          }`
        : null,
    );
    return observation.connectedTeamIds;
  }, [setConnectedProjectInventory]);

  const setProjectReadinessLoading = useCallback(
    (projectId: string, loading: boolean) => {
      setProjectReadinessLoadingProjects((current) => {
        const alreadyLoading = current.has(projectId);
        if (alreadyLoading === loading) return current;
        const next = new Set(current);
        if (loading) next.add(projectId);
        else next.delete(projectId);
        return next;
      });
    },
    [],
  );

  const clearLoginTimer = useCallback(() => {
    if (pollTimer.current === null) return;
    window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const cancelLogin = useCallback(() => {
    loginAttempt.current += 1;
    clearLoginTimer();
    pollLoginNow.current = null;
    setLoginCode(null);
    setLoading(false);
    setError(null);
  }, [clearLoginTimer]);

  /*
    Bridges to the domain action modules. Those actions now own the dashboard
    too — they read and write it through the entity store — so the only
    transitions still handed back are the ones Phase 3 owns: the workspace
    inventory, the health probe and the reconnect generation.
  */

  const bumpReconnectRequest = useCallback(() => {
    reconnectRequest.current += 1;
  }, []);

  const clearWorkspaceViews = useCallback(() => {
    setConnectedProjectIds(null);
    setLocalProjectInventoryError(null);
  }, []);

  const resetTeamHealth = useCallback(() => {
    setHealth(null);
    setHealthError(null);
  }, []);

  const sessionActionDeps: SessionActionDeps = {
    bumpReconnectRequest,
    cancelLogin,
    clearWorkspaceViews,
  };
  const { deleteAccount, logout, updateAccountProfile } =
    useSessionActions(sessionActionDeps);

  const organizationActionDeps: OrganizationActionDeps = {
    bumpReconnectRequest,
    lockedTeamId: lockedProjectId,
    resetTeamHealth,
  };
  const {
    addOrganization,
    changeOrganizationLogo,
    checkOrganizationHandle,
    renameOrganization,
    selectOrganization,
  } = useOrganizationActions(organizationActionDeps);

  const teamActionDeps: TeamActionDeps = { bumpReconnectRequest };
  const {
    cancelTeamCreation,
    changeTeamIcon,
    changeTeamIssueKeyPrefix,
    changeTeamScheduleTab,
    finishTeamCreation,
    startTeamCreation,
  } = useTeamActions(teamActionDeps);

  const { addPlanningProject, editPlanningProject, removePlanningProject } =
    usePlanningActions();

  useEffect(() => {
    if (!companionMode) return;
    const handleAuthReturn = () => {
      clearLoginTimer();
      pollLoginNow.current?.();
    };
    window.addEventListener("briar-auth-return", handleAuthReturn);
    return () =>
      window.removeEventListener("briar-auth-return", handleAuthReturn);
  }, [clearLoginTimer]);

  /**
   * Fetches the selected team through the shared loader. The polling,
   * visibility and scope-invalidation triggers live in `useTeamSync`; this is
   * only the imperative entry point actions still call after a write.
   */
  const refresh = useCallback(
    (mode: TeamSyncMode = "delta") => loader.refresh(activeProjectId, mode),
    [activeProjectId, loader],
  );

  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    let retryTimer: number | null = null;
    let retryAttempt = 0;

    const scheduleRetry = (caught: unknown) => {
      const message =
        caught instanceof Error ? caught.message : String(caught);
      setError(`${message} 다시 연결하는 중입니다…`);
      setLoading(true);
      const retryDelay = Math.min(1_000 * 2 ** retryAttempt, 15_000);
      retryAttempt += 1;
      retryTimer = window.setTimeout(() => void restore(), retryDelay);
    };

    const restore = async () => {
      const result = await restoreStoredSession({
        clearToken: webMode
          ? async () => {
              await browserAuthClient.signOut();
              await clearSessionToken();
            }
          : clearSessionToken,
        loadOrganizations: remote.loadOrganizations,
        loadTeams: remote.loadTeams,
        loadSession: remote.loadSession,
        readToken: webMode
          ? browserAuthClient.readSessionCredential
          : readSessionToken,
      });
      if (cancelled) return;
      if (result.status === "missing" || result.status === "unauthorized") {
        setError(null);
        setRestoringSession(false);
        setLoading(false);
        return;
      }
      if (result.status === "retry") {
        scheduleRetry(result.error);
        return;
      }

      let nextOrganizations: Organization[];
      try {
        nextOrganizations = deferDefaultOrganization
          ? result.organizations
          : await ensureDefaultOrganization(
              result.token,
              result.user,
              result.organizations,
              {
                createOrganization: createRemoteOrganization,
                loadOrganizations: remote.loadOrganizations,
              },
            );
      } catch (caught) {
        if (!cancelled) scheduleRetry(caught);
        return;
      }
      const inventoryObservation: LocalProjectInventoryObservation = remoteMode
        ? { status: "loaded", connectedTeamIds: null, error: null }
        : await readinessCoordinator.inspectInventory();
      if (cancelled) return;
      setToken(result.token);
      setUser(result.user);
      setProjects(result.projects);
      setOrganizations(nextOrganizations);
      applyLocalProjectInventoryObservation(inventoryObservation);
      const selection = resolveActiveAccountSelection(
        result.user.id,
        nextOrganizations,
        result.projects,
        lockedProjectId,
      );
      setActiveOrganizationId(selection.activeOrganizationId);
      setActiveProjectId(selection.activeProjectId);
      setError(null);
      setRestoringSession(false);
      setLoading(false);
    };

    void restore();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [lockedProjectId]);

  const refreshVelen = useCallback(async (org?: string | null) => {
    if (demoMode) {
      const inspection: VelenInspection = {
        authenticated: true,
        email: demoUser.email,
        currentOrg: org ?? "wordbricks",
        organizations: [{ name: "Wordbricks", slug: "wordbricks" }],
        sources: [{
          sourceKey: "linear-wordbricks",
          sourceRef: "linear://linear-wordbricks",
          provider: "linear",
          status: "active",
        }],
      };
      setVelen(inspection);
      return inspection;
    }
    try {
      const inspection = await inspectVelen(org);
      setVelen(inspection);
      setError(null);
      return inspection;
    } catch (caught) {
      setVelen(null);
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    }
  }, []);

  useEffect(() => {
    if (
      lockedProjectId ||
      demoMode ||
      remoteMode ||
      !token ||
      connectedTeamIds === null
    ) {
      return;
    }
    const projectIds = projects
      .map((project) => project.id)
      .filter((projectId) =>
        isTeamConnectedLocally(connectedTeamIds, projectId),
      );
    if (projectIds.length === 0) return;
    return startTeamAgentSchedulePolling(
      {
        claim: (projectIds) => claimProjectAgentScheduleRuns(token, projectIds),
        complete: (projectId, runId, input) =>
          completeProjectAgentScheduleRun(token, projectId, runId, input),
        renew: (projectId, runId, claimToken) =>
          renewProjectAgentScheduleRun(
            token,
            projectId,
            runId,
            claimToken,
          ),
        execute: (run) =>
          executeScheduledTeamAgent(
            {
              loadDashboard: remote.loadDashboard,
              dispatchRun: (
                currentToken,
                projectId,
                candidate,
                input,
              ) =>
                dispatchHuntRun(
                  currentToken,
                  projectId,
                  candidate.id,
                  input,
                ),
              retryRun: (currentToken, projectId, runId, reason) =>
                retryHuntRun(currentToken, projectId, runId, reason),
              runAgent: runTeamAgent,
              startSession: startScheduledAgentSession,
              startWorkerDispatchSession:
                startScheduledAgentWorkerDispatch,
              settleSession: settleScheduledAgentSession,
            },
            token,
            run,
          ),
        log: (message, caught) => console.error(message, caught),
      },
      projectIds,
    );
  }, [
    connectedTeamIds,
    lockedProjectId,
    projects,
    settleScheduledAgentSession,
    startScheduledAgentSession,
    startScheduledAgentWorkerDispatch,
    token,
  ]);

  const applyProjectReadinessObservation = useCallback((
    projectId: string,
    observation: LocalTeamReadinessObservation<RepositoryReadiness>,
  ) => {
    if (observation.status === "superseded") return null;
    applyLocalProjectInventoryObservation(
      observation.status === "unknown"
        ? {
            status: "error",
            connectedTeamIds: null,
            error: observation.error,
          }
        : {
            status: "loaded",
            connectedTeamIds: observation.connectedTeamIds,
            error: null,
          },
    );
    setProjectReadiness((current) => {
      const next = { ...current };
      if (observation.status === "ready") {
        next[projectId] = observation.readiness;
      } else {
        delete next[projectId];
      }
      return next;
    });
    setProjectReadinessError((current) => {
      const next = { ...current };
      if (observation.status === "unknown" || observation.status === "error") {
        next[projectId] = observation.error instanceof Error
          ? observation.error.message
          : String(observation.error);
      } else {
        delete next[projectId];
      }
      return next;
    });
    return observation.status === "ready" ? observation.readiness : null;
  }, [applyLocalProjectInventoryObservation]);

  const refreshProjectReadiness = useCallback(async (projectId: string) => {
    if (demoMode || remoteMode) return null;
    setProjectReadinessLoading(projectId, true);
    setProjectReadinessError((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    setProjectReadiness((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    const observation = await readinessCoordinator.inspect(projectId);
    if (observation.status === "superseded") return null;
    const readiness = applyProjectReadinessObservation(projectId, observation);
    setProjectReadinessLoading(projectId, false);
    return readiness;
  }, [
    applyProjectReadinessObservation,
    readinessCoordinator,
    setProjectReadinessLoading,
  ]);

  const lastSyncedSharedWorkflowKeys = useRef(new Map<string, string>());

  // Once the saved session and local project ids have been restored, mirror
  // the server-owned workflow for every repository connected to this desktop.
  // Keep each project independent so an offline/deleted project cannot block
  // the app or leave other connected repositories with stale worker settings.
  useEffect(() => {
    if (
      lockedProjectId ||
      demoMode ||
      remoteMode ||
      !token ||
      connectedTeamIds === null
    ) {
      return;
    }
    const projectIds = projects
      .map((project) => project.id)
      .filter((projectId) =>
        isTeamConnectedLocally(connectedTeamIds, projectId),
      );
    if (projectIds.length === 0) return;

    let cancelled = false;
    void syncSharedProjectWorkflows({
      projectIds,
      lastSyncedKeys: lastSyncedSharedWorkflowKeys.current,
      loadSharedWorkflow: async (projectId) =>
        (await remote.loadDashboard(token, projectId)).settings.workflow,
      updateLocalWorkflow: updateLocalTeamWorkflow,
    }).then((results) => {
      if (cancelled) return;
      for (const result of results) {
        if (result.status === "synced" || result.status === "unchanged") {
          lastSyncedSharedWorkflowKeys.current.set(result.projectId, result.key);
          if (result.status === "synced") {
            void refreshProjectReadiness(result.projectId);
          }
        } else if (result.status === "failed") {
          console.warn(
            `Failed to mirror shared project workflow for ${result.projectId}`,
            result.error,
          );
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    connectedTeamIds,
    lockedProjectId,
    projects,
    refreshProjectReadiness,
    token,
  ]);

  const refreshHealth = useCallback(async () => {
    const request = ++healthRequest.current;
    const projectId = activeProjectId;
    if (
      demoMode ||
      remoteMode ||
      !projectId ||
      // 이 기기에 저장소를 연결하기 전에는 로컬 상태를 검사할 대상이 없습니다.
      !isTeamConnectedLocally(connectedTeamIds, projectId)
    ) {
      setHealth(null);
      setHealthError(null);
      setHealthLoading(false);
      return null;
    }
    const isCurrent = () =>
      request === healthRequest.current &&
      registry.get(activeTeamIdAtom) === projectId;
    setHealthLoading(true);
    try {
      // Project workflow tools are shared via project settings. Mirror them
      // into the local config so this worker machine can probe readiness.
      const sharedWorkflow =
        registry.get(loadedDashboardTeamIdAtom) === projectId
          ? (registry.get(teamSettingsAtom(projectId))?.workflow ?? null)
          : null;
      const syncPlan = shouldSyncSharedWorkflow({
        connectedLocally: true,
        sharedWorkflow,
        lastSyncedKey:
          lastSyncedSharedWorkflowKeys.current.get(projectId) ?? null,
        projectId,
      });
      if (syncPlan.sync && sharedWorkflow) {
        try {
          await updateLocalTeamWorkflow(projectId, sharedWorkflow);
          if (syncPlan.key) {
            lastSyncedSharedWorkflowKeys.current.set(
              projectId,
              syncPlan.key,
            );
          }
          if (!isCurrent()) return null;
          await refreshProjectReadiness(projectId);
        } catch (syncError) {
          console.warn(
            "Failed to mirror shared project workflow for tool checks",
            syncError,
          );
        }
      } else if (syncPlan.key) {
        lastSyncedSharedWorkflowKeys.current.set(projectId, syncPlan.key);
      }

      if (!isCurrent()) return null;
      const result = await loadAutoHuntHealth(projectId);
      if (!isCurrent()) return null;
      setHealth(result);
      setHealthError(null);
      return result;
    } catch (caught) {
      if (!isCurrent()) return null;
      const message = caught instanceof Error ? caught.message : String(caught);
      setHealth(null);
      setHealthError(message);
      return null;
    } finally {
      if (isCurrent()) setHealthLoading(false);
    }
  }, [activeProjectId, connectedTeamIds, refreshProjectReadiness, registry]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  // Dashboard settings are the source of shared workflow tools. When they
  // arrive or change, re-run health so Project Settings and the connection
  // panel stop showing "Not checked" / empty tool lists. Depend on content,
  // not object identity, so dashboard snapshot polling does not re-probe
  // every cycle.
  const sharedWorkflowSyncKey = dashboard?.settings.workflow
    ? `${dashboard.team.id}:${JSON.stringify(dashboard.settings.workflow)}`
    : null;
  useEffect(() => {
    if (
      demoMode ||
      remoteMode ||
      !dashboard?.team.id ||
      !sharedWorkflowSyncKey ||
      !isTeamConnectedLocally(connectedTeamIds, dashboard.team.id)
    ) {
      return;
    }
    if (dashboard.team.id !== activeProjectId) return;
    void refreshHealth();
  }, [
    activeProjectId,
    connectedTeamIds,
    dashboard?.team.id,
    refreshHealth,
    sharedWorkflowSyncKey,
  ]);

  useEffect(() => {
    if (demoMode || remoteMode || projects.length === 0) return;
    const relevantProjects = lockedProjectId
      ? projects.filter((project) => project.id === lockedProjectId)
      : projects;
    let cancelled = false;
    for (const project of relevantProjects) {
      setProjectReadinessLoading(project.id, true);
      void readinessCoordinator.inspect(project.id).then((observation) => {
        if (cancelled || observation.status === "superseded") return;
        applyProjectReadinessObservation(project.id, observation);
        setProjectReadinessLoading(project.id, false);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [
    applyProjectReadinessObservation,
    connectedTeamIds,
    lockedProjectId,
    projects,
    readinessCoordinator,
    setProjectReadinessLoading,
  ]);

  const completeLogin = useCallback(async (
    nextToken: string,
    attempt: number,
  ) => {
    const [nextUser, nextProjects, loadedOrganizations] = await Promise.all([
      loadSession(nextToken),
      loadTeams(nextToken),
      loadOrganizations(nextToken),
    ]);
    const nextOrganizations = deferDefaultOrganization
      ? loadedOrganizations
      : await ensureDefaultOrganization(
          nextToken,
          nextUser,
          loadedOrganizations,
          {
            createOrganization: createRemoteOrganization,
            loadOrganizations,
          },
        );
    const inventoryObservation: LocalProjectInventoryObservation = remoteMode
      ? { status: "loaded", connectedTeamIds: null, error: null }
      : await readinessCoordinator.inspectInventory();
    if (attempt !== loginAttempt.current) return;
    if (nextToken === browserCookieSessionCredential) {
      await clearSessionToken();
    } else {
      await writeSessionToken(nextToken);
    }
    if (attempt !== loginAttempt.current) {
      if (nextToken === browserCookieSessionCredential) {
        await browserAuthClient.signOut();
      } else {
        await clearSessionToken();
      }
      return;
    }
    setToken(nextToken);
    setUser(nextUser);
    setProjects(nextProjects);
    setOrganizations(nextOrganizations);
    applyLocalProjectInventoryObservation(inventoryObservation);
    const selection = resolveActiveAccountSelection(
      nextUser.id,
      nextOrganizations,
      nextProjects,
      lockedProjectId,
    );
    setActiveOrganizationId(selection.activeOrganizationId);
    setActiveProjectId(selection.activeProjectId);
    setProjectConnection(null);
    setError(null);
    setLoginCode(null);
    setLoading(false);
    pollLoginNow.current = null;
  }, [
    applyLocalProjectInventoryObservation,
    deferDefaultOrganization,
    lockedProjectId,
    readinessCoordinator,
  ]);

  const login = useCallback(async (
    options: DeviceAuthorizationLaunchOptions = {},
  ) => {
    const attempt = ++loginAttempt.current;
    clearLoginTimer();
    setLoading(true);
    setError(null);
    try {
      if (webMode) {
        if (options.method === "google") {
          await browserAuthClient.signInWithGoogle({
            callbackURL: window.location.href,
            locale: options.locale ?? "en",
          });
          return;
        }
        setLoading(false);
        return;
      }
      const authorization = await beginDeviceAuthorization(
        deviceClientId,
        options,
      );
      if (attempt !== loginAttempt.current) return;
      setLoginCode(authorization.userCode);
      await openAuthorization(authorization.verificationUrl);
      if (attempt !== loginAttempt.current) return;
      let delay = authorization.interval * 1_000;
      const poll = async () => {
        pollTimer.current = null;
        if (attempt !== loginAttempt.current) return;
        try {
          const result = await pollDeviceToken(
            authorization.deviceCode,
            deviceClientId,
          );
          if (attempt !== loginAttempt.current) return;
          if (result.access_token) {
            await completeLogin(result.access_token, attempt);
            return;
          }
          if (result.error === "slow_down") delay += 5_000;
          if (result.error === "access_denied" || result.error === "expired_token") {
            throw new Error(result.error_description ?? "로그인 승인이 종료되었습니다.");
          }
          if (attempt !== loginAttempt.current) return;
          pollTimer.current = window.setTimeout(() => void poll(), delay);
        } catch (caught) {
          if (attempt !== loginAttempt.current) return;
          setError(caught instanceof Error ? caught.message : String(caught));
          setLoading(false);
          setLoginCode(null);
          pollLoginNow.current = null;
        }
      };
      pollLoginNow.current = () => void poll();
      pollTimer.current = window.setTimeout(() => void poll(), delay);
    } catch (caught) {
      if (attempt !== loginAttempt.current) return;
      if (isAuthorizationCancelled(caught)) {
        setLoginCode(null);
        setLoading(false);
        pollLoginNow.current = null;
        return;
      }
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoading(false);
      pollLoginNow.current = null;
    }
  }, [clearLoginTimer, completeLogin]);

  const sendLoginEmailCode = useCallback(async (
    email: string,
    locale: BrowserAuthLocale,
  ) => {
    setLoading(true);
    setError(null);
    try {
      await browserAuthClient.sendEmailOTP(email, locale);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    } finally {
      setLoading(false);
    }
  }, []);

  const verifyLoginEmailCode = useCallback(async (
    email: string,
    otp: string,
    locale: BrowserAuthLocale,
  ) => {
    const attempt = ++loginAttempt.current;
    clearLoginTimer();
    setLoading(true);
    setError(null);
    try {
      await browserAuthClient.signInWithEmailOTP({ email, locale, otp });
      if (attempt !== loginAttempt.current) {
        await browserAuthClient.signOut();
        return;
      }
      await completeLogin(browserCookieSessionCredential, attempt);
    } catch (caught) {
      if (attempt !== loginAttempt.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoading(false);
      throw caught;
    }
  }, [clearLoginTimer, completeLogin]);

  const acceptInvitation = useCallback(
    async (invitationToken: string) => {
      reconnectRequest.current += 1;
      if (!token) throw new Error("로그인이 필요합니다.");
      setLoading(true);
      setError(null);
      try {
        const result = await acceptRemoteOrganizationInvitation(
          token,
          invitationToken,
        );
        const [nextOrganizations, nextProjects] = await Promise.all([
          loadOrganizations(token),
          loadTeams(token),
        ]);
        setOrganizations(nextOrganizations);
        setProjects(nextProjects);
        setActiveOrganizationId(result.invitation.organizationId);
        setActiveProjectId(result.invitation.initialProjectId);
        // A joined team starts from the server, never from anything this
        // account happened to have stored for that id.
        applySyncEvent(registry, {
          kind: "team-cleared",
          teamId: result.invitation.initialProjectId,
        });
        setHealth(null);
        setHealthError(null);
        return result;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  const selectProject = useCallback(
    (projectId: string) => {
      if (lockedProjectId && projectId !== lockedProjectId) return;
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      const dashboardMatchesProject =
        registry.get(loadedDashboardTeamIdAtom) === projectId;
      if (activeProjectId === projectId && dashboardMatchesProject) {
        setActiveOrganizationId(project.organizationId);
        setError(null);
        return;
      }
      reconnectRequest.current += 1;
      setActiveProjectId(projectId);
      setActiveOrganizationId(project.organizationId);
      if (!demoMode) {
        if (!dashboardMatchesProject) {
          // The store still holds this team's last payload, so the board is
          // already on screen; mark it stale so the next fetch replaces it.
          markTeamStale(registry, projectId);
        }
        setError(null);
        if (activeProjectId === projectId && !dashboardMatchesProject) {
          void refresh("snapshot");
        }
        return;
      }
      commitTeamDashboard(
        project.id === demoDashboard.team.id
          ? demoDashboard
          : emptyDashboard(project),
      );
      setError(null);
    },
    [
      activeProjectId,
      commitTeamDashboard,
      lockedProjectId,
      projects,
      refresh,
      registry,
    ],
  );

  const ensureProjectSelected = useCallback(
    async (projectId: string) => {
      if (lockedProjectId && projectId !== lockedProjectId) {
        throw new Error("이 윈도우에서는 다른 프로젝트를 열 수 없습니다.");
      }
      let nextProjects = projects;
      let project = nextProjects.find((candidate) => candidate.id === projectId);
      if (!project && token && !demoMode) {
        nextProjects = await remote.loadTeams(token);
        setProjects(nextProjects);
        project = nextProjects.find((candidate) => candidate.id === projectId);
      }
      if (!project) {
        throw new Error("요청한 프로젝트를 찾을 수 없습니다.");
      }
      const dashboardMatchesProject =
        registry.get(loadedDashboardTeamIdAtom) === project.id;
      if (activeProjectId === project.id && dashboardMatchesProject) {
        setActiveOrganizationId(project.organizationId);
        setError(null);
        return project;
      }
      reconnectRequest.current += 1;
      setActiveProjectId(project.id);
      setActiveOrganizationId(project.organizationId);
      if (!demoMode) {
        if (!dashboardMatchesProject) {
          // The store already holds this team's last payload; mark it stale so
          // the next fetch replaces it instead of patching an old cursor.
          markTeamStale(registry, project.id);
        }
        setError(null);
        if (activeProjectId === project.id && !dashboardMatchesProject) {
          void refresh("snapshot");
        }
        return project;
      }
      commitTeamDashboard(
        project.id === demoDashboard.team.id
          ? demoDashboard
          : emptyDashboard(project),
      );
      setError(null);
      return project;
    },
    [
      activeProjectId,
      commitTeamDashboard,
      demoMode,
      lockedProjectId,
      projects,
      refresh,
      registry,
      token,
    ],
  );

  const addProject = useCallback(
    async (input: { name: string }) => {
      if (demoMode) {
        const organization =
          organizations.find(
            (candidate) => candidate.id === activeOrganizationId,
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
        setProjects((current) => [...current, project]);
        setActiveOrganizationId(organization.id);
        setActiveProjectId(project.id);
        commitTeamDashboard(emptyDashboard(project));
        setError(null);
        setIsCreatingProject(false);
        return { project, agentToken: null };
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      setLoading(true);
      setError(null);
      try {
        const result = await createTeam(token, {
          ...input,
          organizationId: activeOrganizationId ?? undefined,
        });
        const nextOrganizations = await loadOrganizations(token).catch(() => null);
        setProjects((current) => [...current, result.project]);
        if (nextOrganizations) setOrganizations(nextOrganizations);
        setActiveOrganizationId(result.project.organizationId);
        setActiveProjectId(result.project.id);
        setIsCreatingProject(false);
        setVelen(null);
        setProjectConnection({
          ...result,
          kind: "new",
        });
        return result;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        setLoading(false);
      }
    },
    [activeOrganizationId, commitTeamDashboard, organizations, token],
  );

  const removeProject = useCallback(
    async (projectId: string) => {
      reconnectRequest.current += 1;
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new Error("삭제할 프로젝트가 없습니다.");
      setDeletingProjectId(projectId);
      setError(null);
      try {
        let localCleanupWarning: string | null = null;
        if (!demoMode) {
          if (!token) throw new Error("로그인이 필요합니다.");
          await deleteRemoteProject(token, projectId);
          try {
            await disconnectLocalTeam(projectId);
          } catch (caught) {
            localCleanupWarning =
              caught instanceof Error ? caught.message : String(caught);
          }
        }

        const remaining = projects.filter((candidate) => candidate.id !== projectId);
        const deletedActiveProject = activeProjectId === projectId;
        const nextActiveProject = deletedActiveProject && lockedProjectId
          ? null
          : deletedActiveProject
          ? (remaining.find(
              (candidate) =>
                candidate.organizationId === activeOrganizationId,
            ) ??
            remaining[0] ??
            null)
          : (remaining.find((candidate) => candidate.id === activeProjectId) ?? null);
        setProjects(remaining);
        if (nextActiveProject?.organizationId) {
          setActiveOrganizationId(nextActiveProject.organizationId);
        }
        setActiveProjectId(nextActiveProject?.id ?? null);
        setProjectConnection(null);
        setConnectedProjectIds((current) =>
          withoutConnectedProject(current, projectId),
        );
        setProjectReadiness((current) => {
          const next = { ...current };
          delete next[projectId];
          return next;
        });
        if (deletedActiveProject) {
          if (demoMode && nextActiveProject) {
            commitTeamDashboard(
              nextActiveProject.id === demoDashboard.team.id
                ? demoDashboard
                : emptyDashboard(nextActiveProject),
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
          setHealth(null);
          setHealthError(null);
          if (!demoMode && token && nextActiveProject) {
            // The loader reports its own failures through the session error the
            // hand written catch used to set.
            await loader.refresh(nextActiveProject.id, "snapshot");
          }
        }
        if (localCleanupWarning) {
          setError(`프로젝트는 삭제했지만 로컬 연결 정리에 실패했습니다: ${localCleanupWarning}`);
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        setDeletingProjectId(null);
      }
    },
    [
      activeOrganizationId,
      activeProjectId,
      commitTeamDashboard,
      loader,
      lockedProjectId,
      projects,
      registry,
      token,
    ],
  );

  const selectProjectRepository = useCallback(async () => {
    setError(null);
    try {
      return await pickGitRepository();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      throw caught;
    }
  }, []);

  const createProjectRepository = useCallback(async (name: string) => {
    setError(null);
    return await createTeamWorkspace(name);
  }, []);

  const prepareGithubProjectRepository = useCallback(async (
    projectId: string,
    githubRepository: string,
  ): Promise<PreparedProjectRepository> => {
    if (!token) throw new Error("로그인이 필요합니다.");
    setLoading(true);
    setError(null);
    try {
      const projectDashboard = await loadDashboard(token, projectId);
      const saved = await updateTeamSettings(token, projectId, {
        ...projectDashboard.settings,
        githubRepository,
      });
      const { credential, prepared } =
        await prepareConfiguredTeamRepository(
          saved.settings,
          () => createProjectGithubCredential(token, projectId),
          (projectCredential) =>
            prepareTeamRepository(projectId, projectCredential),
        );
      const connectedSettings = {
        ...saved.settings,
        githubRepositoryId: credential.repository.id,
        githubRepository: credential.repository.fullName,
      };
      if (renderedTeamId() === projectId) {
        commitTeamSettings(projectId, connectedSettings);
      } else {
        commitTeamDashboard({
          ...projectDashboard,
          settings: connectedSettings,
        });
      }
      setProjectConnection((current) =>
        current?.project.id === projectId
          ? { ...current, workflow: connectedSettings.workflow }
          : current
      );
      return prepared;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      throw caught;
    } finally {
      setLoading(false);
    }
  }, [commitTeamDashboard, commitTeamSettings, renderedTeamId, token]);

  const resolveGithubProjectRepository = useCallback(async (
    githubRepository: string,
  ) => {
    if (!token) throw new Error("로그인이 필요합니다.");
    if (!activeOrganizationId) {
      throw new Error("GitHub App을 연결할 조직을 먼저 선택해 주세요.");
    }
    const integration = await loadGithubIntegration(
      token,
      activeOrganizationId,
    );
    if (!integration.connected) {
      throw new Error("조직 설정에서 GitHub App을 먼저 연결해 주세요.");
    }
    const repository = integration.repositories.find((candidate) =>
      candidate.fullName.toLowerCase() === githubRepository.toLowerCase()
    );
    if (!repository) {
      throw new Error(
        "입력한 저장소가 조직 GitHub App의 저장소 접근 범위에 없습니다.",
      );
    }
    return repository.fullName;
  }, [activeOrganizationId, token]);

  const inspectLovableProject = useCallback(
    async (repositoryPath: string) =>
      inspectLovableRepositoryCompatibility(repositoryPath),
    [],
  );

  const preflightProjectConnection = useCallback(
    async (autoHunt: LocalAutoHuntConfig, repositoryPath: string) =>
      preflightLocalTeamConnection({ autoHunt, repositoryPath }),
    [],
  );

  const connectProject = useCallback(async (
    autoHunt: LocalAutoHuntConfig,
    repositoryPath: string,
    onWorkflowProgress?: (progress: TeamLlmProgress) => void,
  ) => {
    if (!projectConnection) throw new Error("연결할 프로젝트가 없습니다.");
    if (!repositoryPath) throw new Error("연결할 Git 저장소를 선택하세요.");
    if (!token && !projectConnection.agentToken) throw new Error("로그인이 필요합니다.");
    const connection = projectConnection;
    setLoading(true);
    setError(null);
    try {
      const agentToken =
        connection.agentToken ??
        (await createAgentToken(token!, connection.project.id)).agentToken;
      if (!connection.agentToken) {
        setProjectConnection((current) =>
          current?.project.id === connection.project.id
            ? { ...current, agentToken }
            : current,
        );
      }
      const connected = await connectLocalTeam({
        projectId: connection.project.id,
        agentToken,
        repositoryPath,
        autoHunt,
      });
      // The local config write is the connection commit boundary. Reflect it
      // immediately; later workflow analysis and optional worker setup may be
      // retried without letting the UI disagree with disk.
      const inventoryObservation = await readinessCoordinator.inspectInventory(
        true,
      );
      const connectedInventory = applyLocalProjectInventoryObservation(
        inventoryObservation,
      );
      if (inventoryObservation.status === "error") {
        throw inventoryObservation.error instanceof Error
          ? inventoryObservation.error
          : new Error(String(inventoryObservation.error));
      }
      if (!connectedInventory?.includes(connection.project.id)) {
        throw new Error("저장된 로컬 프로젝트 연결을 다시 확인하지 못했습니다.");
      }
      const {
        workflow: generatedWorkflow,
        shouldPersistTeamSettings,
      } = await resolveTeamConnectionWorkflow(
        connection.project.role,
        connection.workflow,
        () => generateTeamWorkflow(
          connection.project.id,
          undefined,
          onWorkflowProgress,
        ),
        !isRepositoryWorkflowPending(autoHunt.workflow)
          ? autoHunt.workflow
          : undefined,
      );
      await updateLocalTeamWorkflow(
        connection.project.id,
        generatedWorkflow,
      );

      const initialSettings: ProjectSettings = {
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
        const saved = await updateTeamSettings(
          token,
          connection.project.id,
          initialSettings,
        );
        savedSettings = saved.settings;
        setProjectConnection((current) =>
          current?.project.id === connection.project.id
            ? { ...current, workflow: generatedWorkflow }
            : current,
        );
      }

      let connectedProject = connection.project;
      if (token && !connectedProject.icon && !connectedProject.iconName) {
        try {
          const discovered = await discoverRepositoryIcon(connected.repositoryPath);
          if (discovered) {
            const icon = await teamIconFromDataUrl(discovered);
            connectedProject = (
              await updateRemoteProjectIcon(token, connectedProject.id, {
                type: "image",
                dataUrl: icon,
              })
            ).project;
            setProjects((current) =>
              current.map((project) =>
                project.id === connectedProject.id ? connectedProject : project,
              ),
            );
          }
        } catch (iconError) {
          console.warn("Failed to discover the connected repository icon", iconError);
        }
      }

      if (shouldPersistTeamSettings) {
        if (renderedTeamId() === connection.project.id) {
          commitTeamSettings(connection.project.id, savedSettings);
          registry.update(teamsByIdAtom, (teams) =>
            upsertManyBy(teams, [connectedProject], () => connection.project.id),
          );
        } else {
          commitTeamDashboard({
            ...emptyDashboard(connectedProject),
            settings: savedSettings,
          });
        }
      }
      if (connection.kind === "new" && token) {
        await configureLocalExecutionWorker(
          connection.project.id,
          token,
          true,
        );
      }
      setProjectConnection((current) =>
        current?.project.id === connection.project.id
          ? { ...current, project: connectedProject, workflow: generatedWorkflow }
          : current,
      );
      setError(null);
      await refreshProjectReadiness(connection.project.id);

      return {
        repositoryPath: connected.repositoryPath,
        workflow: generatedWorkflow,
      };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      throw errorWithMessage(caught, message);
    } finally {
      setLoading(false);
    }
  }, [
    applyLocalProjectInventoryObservation,
    commitTeamDashboard,
    commitTeamSettings,
    projectConnection,
    refreshProjectReadiness,
    readinessCoordinator,
    registry,
    renderedTeamId,
    token,
  ]);

  const startWorkingOnProject = useCallback(async (projectId: string) => {
    if (!token) throw new Error("로그인이 필요합니다.");
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new Error("프로젝트를 찾지 못했습니다.");
    const requestId = readinessCoordinator.begin(projectId);
    const isCurrent = () => readinessCoordinator.isCurrent(projectId, requestId);
    setProjectReadinessLoading(projectId, true);
    setProjectReadinessError((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    try {
      const projectDashboard = dashboard?.team.id === projectId
        ? dashboard
        : await loadDashboard(token, projectId);
      const settings = projectDashboard.settings;
      const { credential, prepared } =
        await prepareConfiguredTeamRepository(
          settings,
          () => createProjectGithubCredential(token, projectId),
          (projectCredential) =>
            prepareTeamRepository(projectId, projectCredential),
        );
      const connectedSettings = {
        ...settings,
        githubRepositoryId: credential.repository.id,
        githubRepository: credential.repository.fullName,
      };
      const agentToken = (await createAgentToken(token, projectId)).agentToken;
      await connectLocalTeam({
        projectId,
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
      const inventory = await readinessCoordinator.inspectInventory(true);
      const connected = applyLocalProjectInventoryObservation(inventory);
      if (inventory.status === "error") throw inventory.error;
      if (!connected?.includes(projectId)) {
        throw new Error("저장소 연결 상태를 다시 확인하지 못했습니다.");
      }
      await configureLocalExecutionWorker(projectId, token, true);
      const readiness = await loadTeamRepositoryReadiness(projectId);
      if (!readiness) {
        throw new Error("준비한 저장소 상태를 확인하지 못했습니다.");
      }
      if (!isCurrent()) return null;
      setProjectReadiness((current) => ({ ...current, [projectId]: readiness }));
      commitTeamSettings(projectId, connectedSettings);
      return { prepared, readiness };
    } catch (caught) {
      if (!isCurrent()) return null;
      const message = caught instanceof Error ? caught.message : String(caught);
      setProjectReadinessError((current) => ({ ...current, [projectId]: message }));
      throw caught;
    } finally {
      if (isCurrent()) setProjectReadinessLoading(projectId, false);
    }
  }, [
    applyLocalProjectInventoryObservation,
    commitTeamSettings,
    dashboard,
    projects,
    readinessCoordinator,
    setProjectReadinessLoading,
    token,
  ]);

  const repairHealth = useCallback(async () => {
    const projectId = activeProjectId;
    if (!projectId) throw new Error("복구할 프로젝트가 없습니다.");
    const request = ++healthRequest.current;
    const isCurrent = () =>
      request === healthRequest.current &&
      registry.get(activeTeamIdAtom) === projectId;
    setHealthLoading(true);
    setHealthError(null);
    try {
      const result = await repairAutoHunt(projectId);
      if (!isCurrent()) return null;
      setHealth(result);
      return result;
    } catch (caught) {
      if (!isCurrent()) return null;
      const message = caught instanceof Error ? caught.message : String(caught);
      setHealthError(message);
      return null;
    } finally {
      if (isCurrent()) setHealthLoading(false);
    }
  }, [activeProjectId, registry]);

  const reconnectProject = useCallback(async (projectId = activeProjectId) => {
    const request = ++reconnectRequest.current;
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return "failed" as const;
    setError(null);
    let workflow: ProjectSettings["workflow"];
    try {
      const automaticGeneration = automaticWorkflowGenerations.current.get(
        project.id,
      );
      if (automaticGeneration) {
        // Reuse the repository analysis already in flight. Opening reconnect
        // must not launch a second LLM generation from the same pending
        // workflow snapshot.
        workflow = await automaticGeneration;
      } else if (dashboard?.team.id === project.id) {
        workflow = dashboard.settings.workflow;
      } else {
        if (!token) throw new Error("로그인이 필요합니다.");
        workflow = (await loadDashboard(token, project.id)).settings.workflow;
      }
    } catch (caught) {
      if (request === reconnectRequest.current) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return "failed" as const;
      }
      return "superseded" as const;
    }
    if (request !== reconnectRequest.current) return "superseded" as const;
    setVelen(null);
    setActiveProjectId(project.id);
    setActiveOrganizationId(project.organizationId);
    setIsCreatingProject(true);
    setProjectConnection({
      kind: "reconnect",
      project,
      agentToken: null,
      workflow,
    });
    return "opened" as const;
  }, [activeProjectId, dashboard, projects, token]);

  const persistProjectWorkflow = useCallback(
    async (
      projectId: string,
      previousWorkflow: ProjectSettings["workflow"],
      nextWorkflow: ProjectSettings["workflow"],
    ) => {
      if (!token || !dashboard || dashboard.team.id !== projectId) {
        throw new Error("워크플로우를 갱신할 팀 설정이 없습니다.");
      }
      await updateLocalTeamWorkflow(projectId, nextWorkflow);
      try {
        const result = await updateTeamSettings(token, projectId, {
          ...dashboard.settings,
          workflow: nextWorkflow,
        });
        commitTeamSettings(projectId, result.settings);
        await Promise.all([
          refreshProjectReadiness(projectId),
          refreshHealth(),
        ]);
      } catch (caught) {
        try {
          await updateLocalTeamWorkflow(projectId, previousWorkflow);
        } catch (rollbackError) {
          const cause = caught instanceof Error ? caught.message : String(caught);
          const rollback = rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError);
          throw new Error(
            `워크플로우 저장에 실패했고 로컬 설정도 복구하지 못했습니다: ${cause} (${rollback})`,
          );
        }
        throw caught;
      }
      return nextWorkflow;
    },
    [
      commitTeamSettings,
      dashboard,
      refreshHealth,
      refreshProjectReadiness,
      token,
    ],
  );

  const regenerateWorkflow = useCallback(
    async (projectId: string) => {
      if (demoMode) {
        throw new Error("워크플로우 재생성은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      if (!dashboard || dashboard.team.id !== projectId) {
        throw new Error("워크플로우를 갱신할 팀 설정이 없습니다.");
      }

      const previousWorkflow = dashboard.settings.workflow;
      const generatedWorkflow = await generateTeamWorkflow(
        projectId,
        previousWorkflow,
      );
      return persistProjectWorkflow(
        projectId,
        previousWorkflow,
        generatedWorkflow,
      );
    },
    [dashboard, persistProjectWorkflow, token],
  );

  const analyzeWorkflowRequirements = useCallback(
    async (
      projectId: string,
      onProgress?: (progress: TeamLlmProgress) => void,
    ) => {
      if (demoMode) {
        throw new Error("필요 도구 분석은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      if (!dashboard || dashboard.team.id !== projectId) {
        throw new Error("필요 도구를 분석할 팀 설정이 없습니다.");
      }

      const previousWorkflow = dashboard.settings.workflow;
      const analyzedWorkflow = await analyzeTeamWorkflowRequirements(
        projectId,
        previousWorkflow,
        onProgress,
      );
      return persistProjectWorkflow(
        projectId,
        previousWorkflow,
        analyzedWorkflow,
      );
    },
    [dashboard, persistProjectWorkflow, token],
  );

  const reviseWorkflow = useCallback(
    async (projectId: string, requestedChange: string) => {
      if (demoMode) {
        throw new Error("워크플로우 수정은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      if (!dashboard || dashboard.team.id !== projectId) {
        throw new Error("워크플로우를 갱신할 팀 설정이 없습니다.");
      }

      const previousWorkflow = dashboard.settings.workflow;
      const revisedWorkflow = await reviseTeamWorkflow(
        projectId,
        previousWorkflow,
        requestedChange,
      );
      return persistProjectWorkflow(
        projectId,
        previousWorkflow,
        revisedWorkflow,
      );
    },
    [dashboard, persistProjectWorkflow, token],
  );

  const saveCheckpointPolicy = useCallback(
    async (
      projectId: string,
      scope: "project" | "user",
      checkpoints: NonNullable<
        ProjectSettings["checkpointPolicy"]
      >["teamMandatory"],
      expectedRevision: number,
    ) => {
      if (!token) throw new Error("로그인이 필요합니다.");
      if (!dashboard || dashboard.team.id !== projectId) {
        throw new Error("체크포인트를 저장할 팀 설정이 없습니다.");
      }
      const result = await updateCheckpointPolicy(token, projectId, {
        scope,
        checkpoints,
        expectedRevision,
      });
      commitTeamSettings(projectId, {
        ...dashboard.settings,
        checkpointPolicy: result.checkpointPolicy,
      });
      return result.checkpointPolicy;
    },
    [commitTeamSettings, dashboard, token],
  );

  useEffect(() => {
    const projectId = dashboard?.team.id;
    if (
      demoMode ||
      remoteMode ||
      !token ||
      !projectId ||
      !connectedTeamIds?.includes(projectId) ||
      projectConnection?.project.id === projectId ||
      !isRepositoryWorkflowPending(dashboard.settings.workflow) ||
      workflowGenerationAttempts.current.has(projectId)
    ) {
      return;
    }
    workflowGenerationAttempts.current.add(projectId);
    const generation = regenerateWorkflow(projectId);
    automaticWorkflowGenerations.current.set(projectId, generation);
    void generation
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(`저장소 기반 워크플로우 생성에 실패했습니다: ${message}`);
      })
      .finally(() => {
        if (automaticWorkflowGenerations.current.get(projectId) === generation) {
          automaticWorkflowGenerations.current.delete(projectId);
        }
      });
  }, [
    connectedTeamIds,
    dashboard,
    projectConnection,
    regenerateWorkflow,
    token,
  ]);

  const assertRepositoryReadyForLinearImport = useCallback(
    (projectId: string) => {
      const githubRepository =
        dashboard?.team.id === projectId
          ? dashboard.settings.githubRepository
          : null;
      const repositoryPath =
        health?.projectId === projectId ? health.repositoryPath : null;
      const ready = isRepositoryConnectedForImport({
        projectId,
        connectedTeamIds,
        githubRepository,
        repositoryPath,
      });
      if (!ready) {
        throw new Error(
          "저장소를 연결한 뒤에 Linear 이슈를 가져올 수 있습니다.",
        );
      }
    },
    [connectedTeamIds, dashboard, health],
  );

  const connectLinearForImport = useCallback(
    async (projectId: string, apiKey: string) => {
      assertRepositoryReadyForLinearImport(projectId);
      if (demoMode) {
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
      if (!token) throw new Error("로그인이 필요합니다.");
      return connectLinearImport(token, projectId, apiKey);
    },
    [assertRepositoryReadyForLinearImport, token],
  );

  const loadLinearStatesForImport = useCallback(
    async (
      projectId: string,
      input: { apiKey: string; teamIds: string[] },
    ) => {
      assertRepositoryReadyForLinearImport(projectId);
      if (demoMode) {
        return {
          states: [
            {
              id: "state-backlog",
              name: "Backlog",
              type: "backlog",
              color: "#bec2c8",
              position: 0,
              teamId: input.teamIds[0] ?? "team-demo",
              teamKey: "DEMO",
              teamName: "Demo Team",
            },
            {
              id: "state-started",
              name: "In Progress",
              type: "started",
              color: "#f2c94c",
              position: 1,
              teamId: input.teamIds[0] ?? "team-demo",
              teamKey: "DEMO",
              teamName: "Demo Team",
            },
            {
              id: "state-done",
              name: "Done",
              type: "completed",
              color: "#5e6ad2",
              position: 2,
              teamId: input.teamIds[0] ?? "team-demo",
              teamKey: "DEMO",
              teamName: "Demo Team",
            },
          ],
        };
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      return loadLinearImportStates(token, projectId, input);
    },
    [assertRepositoryReadyForLinearImport, token],
  );

  const runLinearIssueImport = useCallback(
    async (
      projectId: string,
      input: {
        apiKey: string;
        teamIds: string[];
        statusMapping: LinearStatusMapping;
      },
    ) => {
      assertRepositoryReadyForLinearImport(projectId);
      if (demoMode) {
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
      if (!token) throw new Error("로그인이 필요합니다.");
      const result = await importLinearIssues(token, projectId, input);
      if (activeProjectId === projectId) {
        await refresh("snapshot");
      }
      return result;
    },
    [activeProjectId, assertRepositoryReadyForLinearImport, refresh, token],
  );

  const saveVelenIntegration = useCallback(
    async (projectId: string, org: string | null) => {
      if (!dashboard || dashboard.team.id !== projectId) {
        throw new Error("Velen 연결을 저장할 팀 설정이 없습니다.");
      }
      const normalized = org?.trim() || null;
      if (demoMode) {
        commitTeamSettings(projectId, {
          ...dashboard.settings,
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
      if (!token) throw new Error("로그인이 필요합니다.");

      const previous = dashboard.settings.velenOrg;
      const local = remoteMode
        ? normalized
        : await updateLocalTeamVelenOrg(projectId, normalized);
      try {
        const result = await updateTeamSettings(token, projectId, {
          ...dashboard.settings,
          velenOrg: local,
          ...(local
            ? {}
            : {
                dataSource: null,
                linear: { enabled: false, source: null, teamKey: null },
              }),
        });
        commitTeamSettings(projectId, result.settings);
        return result.settings.velenOrg;
      } catch (caught) {
        if (!remoteMode) {
          try {
            await updateLocalTeamVelenOrg(projectId, previous);
          } catch (rollbackError) {
            const cause = caught instanceof Error ? caught.message : String(caught);
            const rollback = rollbackError instanceof Error
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
    [commitTeamSettings, dashboard, token],
  );

  /*
    The issue, run and run detail writes. Both objects are identical for the
    lifetime of the registry, so the callbacks below them no longer change every
    polling tick — which is what the views start relying on when they subscribe
    to the entity atoms directly instead of taking these as props.
  */
  const {
    acceptConversationIssueAction,
    acceptConversationIssueExecution,
    acceptConversationSkillExecution,
    addIssue,
    changeIssueDependency,
    changeIssueParent,
    changeRelatedIssue,
    completeResultReview,
    editIssue,
    editIssueCheckpoints,
    editIssueExecutionPreferences,
    editIssueSubscription,
    moveIssueProject,
    moveRun,
    readIssueAttachment,
    recoverRun,
    removeIssue,
    resumeRun,
    reworkRun,
    transferIssue: transferIssueToProject,
    unassignRun,
  } = useIssueActions();
  const {
    addIssueMessage,
    readIssueMessages,
    readRunEvents,
    readRunEvidence,
    readRunEvidenceImage,
    removeIssueMessage,
    updateIssueMessage,
  } = useRunDetailActions();

  /*
    The two shell callbacks the issue actions reach back into: the team
    selector, which a project window narrows to its own team, and the agent
    session adopter `useAutoHuntSessions` owns. They are installed after each
    render rather than passed as hook dependencies, so the action object above
    keeps one identity while these keep tracking the latest closures.
  */
  useEffect(() => {
    setIssueActionBridge(registry, {
      adoptRemoteAgentSession,
      selectTeam: selectProject,
    });
  });

  return {
    acceptInvitation,
    activeOrganizationId,
    activeProjectId,
    addOrganization,
    addIssue,
    addPlanningProject,
    moveIssueProject,
    addProject,
    cancelProjectCreation: cancelTeamCreation,
    cancelLogin,
    changeOrganizationLogo,
    changeProjectIcon: changeTeamIcon,
    changeProjectIssueKeyPrefix: changeTeamIssueKeyPrefix,
    changeProjectScheduleTab: changeTeamScheduleTab,
    checkOrganizationHandle,
    connectProject,
    connectedTeamIds,
    activeProjectConnectionState: localTeamConnectionState(
      connectedTeamIds,
      activeProjectId,
    ),
    dashboard,
    dashboardStale,
    deleteAccount,
    deleteIssue: removeIssue,
    transferIssue: transferIssueToProject,
    deletePlanningProject: removePlanningProject,
    deleteTeam: removeProject,
    deletingIssueId,
    deletingProjectId,
    demoMode,
    companionMode,
    remoteMode,
    webMode,
    error: error ?? localProjectInventoryError,
    health,
    healthError,
    healthLoading,
    finishProjectCreation: finishTeamCreation,
    isCreatingProject,
    isCreatingIssue,
    updatingIssueId,
    loading,
    login,
    loginCode,
    sendLoginEmailCode,
    verifyLoginEmailCode,
    logout,
    organizations,
    planningProjects,
    editPlanningProject,
    projects,
    projectConnection,
    projectReadiness,
    projectReadinessError,
    projectReadinessLoadingProjects,
    reconnectProject,
    renameOrganization,
    analyzeWorkflowRequirements,
    regenerateWorkflow,
    reworkRun,
    reviseWorkflow,
    resumeRun,
    saveCheckpointPolicy,
    updateAccountProfile,
    saveVelenIntegration,
    connectLinearForImport,
    loadLinearStatesForImport,
    runLinearIssueImport,
    recoveringRunId,
    recoveryError,
    restoringSession,
    refresh,
    refreshHealth,
    refreshProjectReadiness,
    refreshVelen,
    readIssueAttachment,
    editIssue,
    editIssueSubscription,
    editIssueCheckpoints,
    editIssueExecutionPreferences,
    completeResultReview,
    addIssueDependency: (dependentRunId: string, prerequisiteRunId: string) =>
      changeIssueDependency(dependentRunId, prerequisiteRunId, "add"),
    removeIssueDependency: (
      dependentRunId: string,
      prerequisiteRunId: string,
    ) => changeIssueDependency(dependentRunId, prerequisiteRunId, "remove"),
    setIssueParent: changeIssueParent,
    addRelatedIssue: (runId: string, relatedRunId: string) =>
      changeRelatedIssue(runId, relatedRunId, "add"),
    removeRelatedIssue: (runId: string, relatedRunId: string) =>
      changeRelatedIssue(runId, relatedRunId, "remove"),
    readIssueMessages,
    readRunEvents,
    readRunEvidence,
    readRunEvidenceImage,
    addIssueMessage,
    updateIssueMessage,
    removeIssueMessage,
    acceptConversationIssueAction,
    acceptConversationIssueExecution,
    acceptConversationSkillExecution,
    setActiveOrganizationId: selectOrganization,
    setActiveProjectId: selectProject,
    ensureProjectSelected,
    selectProjectRepository,
    createProjectRepository,
    inspectProjectRepository: inspectRepositoryReadiness,
    inspectLovableProject,
    preflightProjectConnection,
    prepareGithubProjectRepository,
    resolveGithubProjectRepository,
    startWorkingOnProject,
    repairHealth,
    retryRun: (runId: string) => recoverRun(runId, "retry"),
    cancelRun: (runId: string) => recoverRun(runId, "cancel"),
    unassignRun,
    moveRun,
    startProjectCreation: startTeamCreation,
    token,
    user,
    velen,
  };
}
