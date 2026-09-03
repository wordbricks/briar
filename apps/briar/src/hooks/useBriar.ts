import {
  useAtom,
  useAtomInitialValues,
  useAtomValue,
} from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AutoHuntSession } from "./useAutoHuntSessions";
import {
  acceptOrganizationInvitation as acceptRemoteOrganizationInvitation,
  beginDeviceAuthorization,
  createOrganization as createRemoteOrganization,
  loadDashboard,
  loadDashboardDelta,
  loadOrganizations,
  loadTeams,
  loadTeamProjects,
  loadSession,
  pollDeviceToken,
  type DeviceAuthorizationLaunchOptions,
} from "../lib/api";
import { demoDashboard } from "../lib/demo-data";
import { loadConnectedTeamIds } from "../lib/team-connection";
import type { LocalProjectInventoryObservation } from "../lib/local-team-connection";
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
import type {
  ClaimedProjectAgentScheduleRun,
  HuntRun,
  Organization,
} from "../types";
import { demoOrganization, emptyDashboard } from "../state/demo-fixtures";
import {
  companionMode,
  demoMode,
  deviceClientId,
  remoteMode,
  webMode,
} from "../state/platform";
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
import { useIntegrationActions } from "../state/integrations/actions";
import { velenAtom } from "../state/integrations/atoms";
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
import { useTeamActions } from "../state/team/actions";
import {
  activeTeamIdAtom,
  dashboardStaleAtom,
  deletingTeamIdAtom,
  isCreatingTeamAtom,
  teamConnectionAtom,
  teamsAtom,
} from "../state/team/atoms";
import { applySyncEvent, markTeamStale } from "../state/sync/apply";
import { commitTeamSnapshot } from "../state/sync/commit";
import {
  teamSyncApiAtom,
  useTeamSyncLoader,
  type TeamSyncMode,
} from "../state/sync/loader";
import {
  activeDashboardAtom,
  loadedDashboardTeamIdAtom,
} from "../state/sync/view";
import { useWorkflowActions } from "../state/workflow/actions";
import { useWorkspaceActions } from "../state/workspace/actions";
import {
  bumpReconnectRequest,
  getReadinessCoordinator,
  setWorkspaceScheduleBridge,
  workspaceApiAtom,
} from "../state/workspace/api";
import {
  activeTeamConnectionStateAtom,
  applyInventoryObservation,
  connectedTeamIdsAtom,
  healthAtom,
  localInventoryErrorAtom,
  lockedTeamIdAtom,
  readinessLoadingTeamIdsAtom,
  resetHealth,
  teamReadinessErrorRecordAtom,
  teamReadinessRecordAtom,
} from "../state/workspace/atoms";

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
        [
          workspaceApiAtom,
          {
            loadConnectedTeamIds: remote.loadConnectedTeamIds,
            loadDashboard: remote.loadDashboard,
          },
        ],
        [lockedTeamIdAtom, lockedProjectId],
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
  /*
    The workspace, workflow and integration state moved to `state/workspace` and
    `state/integrations`. The facade reads it back and re-splits it into the
    keys `App.tsx` still consumes — the health triple, the three readiness
    records — so those views can move to the atoms one at a time.
  */
  const connectedTeamIds = useAtomValue(connectedTeamIdsAtom);
  const localProjectInventoryError = useAtomValue(localInventoryErrorAtom);
  const activeProjectConnectionState = useAtomValue(
    activeTeamConnectionStateAtom,
  );
  const health = useAtomValue(healthAtom);
  const projectReadiness = useAtomValue(teamReadinessRecordAtom);
  const projectReadinessError = useAtomValue(teamReadinessErrorRecordAtom);
  const projectReadinessLoadingProjects = useAtomValue(
    readinessLoadingTeamIdsAtom,
  );
  const velen = useAtomValue(velenAtom);
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
  const pollTimer = useRef<number | null>(null);
  const pollLoginNow = useRef<(() => void) | null>(null);
  const loginAttempt = useRef(0);
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

  const sessionActionDeps: SessionActionDeps = { cancelLogin };
  const { deleteAccount, logout, updateAccountProfile } =
    useSessionActions(sessionActionDeps);

  const organizationActionDeps: OrganizationActionDeps = {
    lockedTeamId: lockedProjectId,
  };
  const {
    addOrganization,
    changeOrganizationLogo,
    checkOrganizationHandle,
    renameOrganization,
    selectOrganization,
  } = useOrganizationActions(organizationActionDeps);

  const {
    cancelTeamCreation,
    changeTeamIcon,
    changeTeamIssueKeyPrefix,
    changeTeamScheduleTab,
    finishTeamCreation,
    startTeamCreation,
  } = useTeamActions();

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
        : await getReadinessCoordinator(registry).inspectInventory();
      if (cancelled) return;
      setToken(result.token);
      setUser(result.user);
      setProjects(result.projects);
      setOrganizations(nextOrganizations);
      applyInventoryObservation(registry, inventoryObservation);
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
      : await getReadinessCoordinator(registry).inspectInventory();
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
    applyInventoryObservation(registry, inventoryObservation);
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
  }, [deferDefaultOrganization, lockedProjectId, registry]);

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
      bumpReconnectRequest(registry);
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
        resetHealth(registry);
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
      bumpReconnectRequest(registry);
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
      commitTeamSnapshot(
        registry,
        project.id,
        project.id === demoDashboard.team.id
          ? demoDashboard
          : emptyDashboard(project),
      );
      setError(null);
    },
    [activeProjectId, lockedProjectId, projects, refresh, registry],
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
      bumpReconnectRequest(registry);
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
      commitTeamSnapshot(
        registry,
        project.id,
        project.id === demoDashboard.team.id
          ? demoDashboard
          : emptyDashboard(project),
      );
      setError(null);
      return project;
    },
    [
      activeProjectId,
      lockedProjectId,
      projects,
      refresh,
      registry,
      token,
    ],
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
    The repository, workflow and integration writes. Like the issue actions they
    read the store through the registry, so each object is identical for the
    lifetime of the registry and the views can take them straight from the hooks
    instead of through the shell.
  */
  const {
    addProject,
    connectProject,
    createProjectRepository,
    inspectLovableProject,
    inspectProjectRepository,
    preflightProjectConnection,
    prepareGithubProjectRepository,
    reconnectProject,
    refreshHealth,
    refreshProjectReadiness,
    removeProject,
    repairHealth,
    resolveGithubProjectRepository,
    selectProjectRepository,
    startWorkingOnProject,
  } = useWorkspaceActions();
  const {
    analyzeWorkflowRequirements,
    regenerateWorkflow,
    reviseWorkflow,
    saveCheckpointPolicy,
  } = useWorkflowActions();
  const {
    connectLinearForImport,
    loadLinearStatesForImport,
    refreshVelen,
    runLinearIssueImport,
    saveVelenIntegration,
  } = useIntegrationActions();

  /*
    The shell callbacks the domain actions reach back into: the team selector,
    which a project window narrows to its own team, and the three scheduled
    agent session callbacks `useAutoHuntSessions` owns. They are installed after
    each render rather than passed as hook dependencies, so the action objects
    above keep one identity while these keep tracking the latest closures — and
    so the schedule poller is not restarted by a shell re-render.
  */
  useEffect(() => {
    setIssueActionBridge(registry, {
      adoptRemoteAgentSession,
      selectTeam: selectProject,
    });
    setWorkspaceScheduleBridge(registry, {
      settleScheduledAgentSession,
      startScheduledAgentSession,
      startScheduledAgentWorkerDispatch,
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
    activeProjectConnectionState,
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
    health: health.value,
    healthError: health.error,
    healthLoading: health.status === "loading",
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
    inspectProjectRepository,
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
