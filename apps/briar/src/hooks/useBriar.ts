import { useCallback, useEffect, useRef, useState } from "react";
import type { AutoHuntSession } from "./useAutoHuntSessions";
import {
  acceptOrganizationInvitation as acceptRemoteOrganizationInvitation,
  acceptIssueActionProposal as acceptRemoteIssueActionProposal,
  acceptIssueExecutionProposal as acceptRemoteIssueExecutionProposal,
  acceptIssueSkillExecutionProposal as acceptRemoteIssueSkillExecutionProposal,
  acceptIssueReworkProposal as acceptRemoteIssueReworkProposal,
  addIssueDependency,
  beginDeviceAuthorization,
  cancelHuntRun,
  claimProjectAgentScheduleRuns,
  completeProjectAgentScheduleRun,
  completeIssueResultReview as completeRemoteIssueResultReview,
  connectLinearImport,
  createAgentToken,
  createProjectGithubCredential,
  createOrganization as createRemoteOrganization,
  createIssue,
  createIssueMessage,
  createPlanningProject as createRemotePlanningProject,
  createProject,
  deleteAccount as deleteRemoteAccount,
  deleteIssue as deleteRemoteIssue,
  deleteIssueMessage,
  transferIssue as transferRemoteIssue,
  deleteProject as deleteRemoteProject,
  dispatchHuntRun,
  unassignHuntRun,
  editIssueMessage,
  errorWithMessage,
  importLinearIssues,
  isApiErrorStatus,
  isApiConfigured,
  loadDashboard,
  loadDashboardDelta,
  loadGithubIntegration,
  loadIssueAttachment,
  loadIssueMessages,
  loadRunEvents,
  loadRunEvidence,
  loadRunEvidenceImage,
  loadLinearImportStates,
  loadOrganizations,
  loadProjects,
  loadTeamProjects,
  loadSession,
  isOrganizationHandleAvailable as checkRemoteOrganizationHandle,
  moveHuntRun,
  moveIssueToPlanningProject as moveRemoteIssueToPlanningProject,
  pollDeviceToken,
  renewProjectAgentScheduleRun,
  retryHuntRun,
  reworkPausedHuntRun,
  resumeHuntRun,
  updatePlanningProject as updateRemotePlanningProject,
  removeIssueDependency,
  updateIssue,
  updateIssueCheckpoints,
  updateIssueExecutionPreferences,
  updateIssueSubscription,
  updateAccountProfile as updateRemoteAccountProfile,
  updateOrganization as updateRemoteOrganization,
  updateOrganizationLogo as updateRemoteOrganizationLogo,
  updateProjectIcon as updateRemoteProjectIcon,
  updateProjectIssueKeyPrefix as updateRemoteProjectIssueKeyPrefix,
  updateProjectTabs as updateRemoteProjectTabs,
  updateProjectSettings,
  updateCheckpointPolicy,
  type DeviceClientId,
  type DeviceLoginMethod,
} from "../lib/api";
import {
  demoDashboard,
  demoRunEvents,
  demoRepositoryReadiness,
} from "../lib/demo-data";
import { deleteAndroidPushRegistration } from "../lib/inbox-notifications";
import { isRepositoryConnectedForImport } from "../lib/linear-import";
import {
  configureLocalExecutionWorker,
  connectLocalProject,
  createProjectWorkspace,
  disconnectLocalProject,
  discoverRepositoryIcon,
  inspectLovableRepositoryCompatibility,
  inspectVelen,
  inspectRepositoryReadiness,
  loadProjectRepositoryReadiness,
  loadAutoHuntHealth,
  loadConnectedProjectIds,
  prepareProjectRepository,
  pickGitRepository,
  preflightLocalProjectConnection,
  prepareConfiguredProjectRepository,
  repairAutoHunt,
  resolveProjectConnectionWorkflow,
  updateLocalProjectVelenOrg,
  updateLocalProjectWorkflow,
  type AutoHuntHealth,
  type LocalAutoHuntConfig,
  type PreparedProjectRepository,
  type RepositoryReadiness,
  type VelenInspection,
} from "../lib/project-connection";
import { projectIconFromDataUrl } from "../lib/project-icon";
import {
  createLocalProjectReadinessCoordinator,
  isProjectConnectedLocally,
  localProjectConnectionState,
  type LocalProjectInventoryObservation,
  type LocalProjectReadinessObservation,
  withoutConnectedProject,
} from "../lib/local-project-connection";
import {
  analyzeProjectWorkflowRequirements,
  generateProjectWorkflow,
  reviseProjectWorkflow,
} from "../lib/project-workflow";
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
import {
  resolveActiveAccountSelection,
  writeActiveOrganizationId,
} from "../lib/active-organization";
import { ensureDefaultOrganization } from "../lib/default-organization";
import {
  isAuthorizationCancelled,
  openAuthorization,
} from "../lib/auth-session";
import { startDashboardPolling } from "../lib/dashboard-polling";
import { mergeDashboardDelta } from "../lib/dashboard-sync";
import {
  isRepositoryWorkflowPending,
  progressForAutoHuntRun,
  repositoryWorkflowBootstrap,
  workflowWithAdditionalCheckpoints,
  type AutoHuntWorkflowCheckpoint,
} from "../lib/auto-hunt-contract";
import { isMobileCompanion, isWebApp } from "../lib/platform";
import { canonicalizeIssueAttachmentReferences } from "../lib/issue-markdown";
import { mergeIssueMessages } from "../lib/issue-message-merge";
import {
  runProjectAgent,
  type ProjectLlmProgress,
} from "../lib/project-llm";
import { executeScheduledProjectAgent } from "../lib/project-agent-schedule-execution";
import { startProjectAgentSchedulePolling } from "../lib/project-agent-schedule-runner";
import type {
  ClaimedProjectAgentScheduleRun,
  AgentSkillExecutionApprovalInput,
  AgentSkillExecutionProposal,
  CreateIssueInput,
  DashboardPayload,
  HuntEvent,
  HuntRun,
  HuntRunPlacement,
  IssueAttachment,
  IssueMessage,
  IssueMessageSendResult,
  IssueProposedAction,
  IssueExecutionApprovalInput,
  IssueExecutionProposal,
  IssueExecutionPreferences,
  IssueResultReview,
  Organization,
  PlanningProject,
  PlanningProjectStatus,
  Project,
  ProjectSettings,
  RunEvidence,
  RunEvidenceImage,
  SessionUser,
  UpdateIssueInput,
} from "../types";

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
};

export type ProjectConnection = {
  kind: "new" | "reconnect";
  project: Project;
  agentToken: string | null;
  workflow?: ProjectSettings["workflow"];
};

const demoMode = import.meta.env.VITE_BRIAR_DEMO !== "false" && !isApiConfigured;
const companionMode = isMobileCompanion();
const webMode = isWebApp();
const remoteMode = companionMode || webMode;
const deviceClientId: DeviceClientId = companionMode
  ? "briar-mobile"
  : webMode
    ? "briar-web"
    : "briar-desktop";
const demoUser: SessionUser = {
  id: "demo-user",
  name: "Jay",
  email: "demo@briar.local",
};
const demoOrganization: Organization = {
  id: demoDashboard.project.organizationId!,
  name: demoDashboard.project.organizationName!,
  handle: "briar",
  logo: null,
  role: demoDashboard.project.role!,
  createdAt: demoDashboard.project.createdAt,
};
const demoMessageTime = new Date(Date.now() - 18 * 60_000).toISOString();
const demoReplyTime = new Date(Date.now() - 8 * 60_000).toISOString();
const initialDemoIssueMessages = {
  "demo-1": [
    {
      id: "demo-message-1",
      runId: "demo-1",
      parentMessageId: null,
      body: "이벤트 스트림에서 빠지는 상태가 없는지 같이 확인해 주세요.",
      author: {
        id: demoUser.id,
        name: demoUser.name,
        image: null,
        provider: null,
      },
      replyCount: 1,
      createdAt: demoMessageTime,
      updatedAt: demoMessageTime,
    },
    {
      id: "demo-message-reply-1",
      runId: "demo-1",
      parentMessageId: "demo-message-1",
      body: "완료·실패·중단 상태까지 회귀 테스트에 포함했습니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex",
      },
      replyCount: 0,
      createdAt: demoReplyTime,
      updatedAt: demoReplyTime,
    },
  ],
} satisfies Record<string, IssueMessage[]>;

const initialDemoRunEvidence = {
  "demo-1": [
    {
      key: "BRIAR-12:analyzing:repository_findings",
      attempt: 1,
      revision: 1,
      stage: "analyzing",
      type: "repository_findings",
      status: "passed",
      detail: "이벤트 스트림과 이슈 상세 화면의 연결 지점을 확인했습니다.",
      command: "rg -n \"AgentEvent|HuntDashboard\" src src-tauri",
      url: null,
      metadata: { filesReviewed: 6 },
      actor: "briar-workflow",
      observedAt: demoMessageTime,
      recordedAt: demoMessageTime,
      requiredRevision: 1,
      canonical: true,
    },
    {
      key: "BRIAR-12:implementing:diff",
      attempt: 1,
      revision: 1,
      stage: "implementing",
      type: "diff",
      status: "pending",
      detail: "이벤트 스트림 어댑터와 회귀 테스트를 작성하고 있습니다.",
      command: null,
      url: null,
      metadata: null,
      actor: "briar-workflow",
      observedAt: demoReplyTime,
      recordedAt: demoReplyTime,
      requiredRevision: 1,
      canonical: true,
    },
  ],
} satisfies Record<string, RunEvidence[]>;

const emptyDashboard = (project: Project): DashboardPayload => ({
  project,
  settings: {
    velenOrg: null,
    dataSource: null,
    linear: { enabled: false, source: null, teamKey: null },
    githubRepository: null,
    githubRepositoryId: null,
    workflow: repositoryWorkflowBootstrap,
  },
  runs: [],
  generatedAt: new Date().toISOString(),
});

export function useBriar(options: UseBriarOptions = {}) {
  const {
    adoptRemoteAgentSession,
    deferDefaultOrganization = false,
    lockedProjectId = null,
    startScheduledAgentSession,
    startScheduledAgentWorkerDispatch,
    settleScheduledAgentSession,
  } = options;
  const [user, setUser] = useState<SessionUser | null>(demoMode ? demoUser : null);
  const [token, setToken] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>(
    demoMode ? [demoDashboard.project] : [],
  );
  const [planningProjects, setPlanningProjects] = useState<PlanningProject[]>(
    demoMode
      ? [{
        id: demoDashboard.project.id,
        workspaceId: demoOrganization.id,
        workspaceName: demoOrganization.name,
        teamId: demoDashboard.project.id,
        teamName: demoDashboard.project.name,
        name: "General",
        description: "",
        status: "active",
        leadUserId: null,
        leadName: null,
        startDate: null,
        targetDate: null,
        icon: null,
        color: null,
        sortOrder: 0,
        isDefault: true,
        role: "owner",
        createdAt: demoDashboard.project.createdAt,
        updatedAt: demoDashboard.project.createdAt,
      }]
      : [],
  );
  const [organizations, setOrganizations] = useState<Organization[]>(
    demoMode ? [demoOrganization] : [],
  );

  useEffect(() => {
    if (demoMode) return;
    if (!token || projects.length === 0) {
      setPlanningProjects([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      projects.map((team) => loadTeamProjects(token, team.id)),
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
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(
    demoMode && (!lockedProjectId || lockedProjectId === demoDashboard.project.id)
      ? demoOrganization.id
      : null,
  );
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    demoMode && (!lockedProjectId || lockedProjectId === demoDashboard.project.id)
      ? demoDashboard.project.id
      : null,
  );
  const [connectedProjectIds, setConnectedProjectIds] = useState<
    string[] | null
  >(demoMode ? [demoDashboard.project.id] : null);
  const [dashboard, setDashboardState] = useState<DashboardPayload | null>(
    demoMode && (!lockedProjectId || lockedProjectId === demoDashboard.project.id)
      ? demoDashboard
      : null,
  );
  const [loading, setLoading] = useState(!demoMode);
  const [restoringSession, setRestoringSession] = useState(!demoMode);
  const [loginCode, setLoginCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localProjectInventoryError, setLocalProjectInventoryError] = useState<
    string | null
  >(null);
  const [projectConnection, setProjectConnection] =
    useState<ProjectConnection | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isCreatingIssue, setIsCreatingIssue] = useState(false);
  const [updatingIssueId, setUpdatingIssueId] = useState<string | null>(null);
  const [deletingIssueId, setDeletingIssueId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [recoveringRunId, setRecoveringRunId] = useState<string | null>(null);
  const issueMessagesByRun = useRef<Record<string, IssueMessage[]>>(
    demoMode ? initialDemoIssueMessages : {},
  );
  const runEvidenceByRun = useRef<Record<string, RunEvidence[]>>(
    demoMode ? initialDemoRunEvidence : {},
  );
  const runEventsByRun = useRef<Record<string, HuntEvent[]>>(
    demoMode ? structuredClone(demoRunEvents) : {},
  );
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [velen, setVelen] = useState<VelenInspection | null>(null);
  const [health, setHealth] = useState<AutoHuntHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [projectReadiness, setProjectReadiness] = useState<
    Record<string, RepositoryReadiness>
  >(
    demoMode
      ? { [demoDashboard.project.id]: demoRepositoryReadiness }
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
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const readinessCoordinatorRef = useRef<ReturnType<
    typeof createLocalProjectReadinessCoordinator<RepositoryReadiness>
  > | null>(null);
  readinessCoordinatorRef.current ??= createLocalProjectReadinessCoordinator({
    loadConnectedProjectIds,
    loadReadiness: loadProjectRepositoryReadiness,
  });
  const readinessCoordinator = readinessCoordinatorRef.current;
  const workflowGenerationAttempts = useRef(new Set<string>());
  const automaticWorkflowGenerations = useRef(
    new Map<string, Promise<ProjectSettings["workflow"]>>(),
  );
  const resumeRequestIds = useRef(new Map<string, string>());
  const reworkRequestIds = useRef(new Map<string, string>());
  const dashboardRef = useRef<DashboardPayload | null>(
    demoMode && (!lockedProjectId || lockedProjectId === demoDashboard.project.id)
      ? demoDashboard
      : null,
  );
  const dashboardCursor = useRef<number | null>(
    demoMode && (!lockedProjectId || lockedProjectId === demoDashboard.project.id)
      ? (demoDashboard.cursor ?? null)
      : null,
  );
  const dashboardRequest = useRef<{
    projectId: string;
    abort: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const dashboardRequestGeneration = useRef(0);

  const setDashboard = useCallback((
    value: Parameters<typeof setDashboardState>[0],
  ) => {
    dashboardRequestGeneration.current += 1;
    dashboardRequest.current?.abort.abort();
    dashboardRequest.current = null;
    setDashboardState((current) => {
      const next = typeof value === "function" ? value(current) : value;
      dashboardRef.current = next;
      dashboardCursor.current = next && Number.isSafeInteger(next.cursor)
        ? (next.cursor ?? null)
        : null;
      return next;
    });
  }, []);

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
    setConnectedProjectInventory(observation.connectedProjectIds);
    setLocalProjectInventoryError(
      observation.status === "error"
        ? `로컬 프로젝트 연결 목록을 읽지 못했습니다: ${
            observation.error instanceof Error
              ? observation.error.message
              : String(observation.error)
          }`
        : null,
    );
    return observation.connectedProjectIds;
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

  useEffect(() => {
    if (lockedProjectId || !user || !activeOrganizationId) return;
    writeActiveOrganizationId(user.id, activeOrganizationId);
  }, [activeOrganizationId, lockedProjectId, user]);

  useEffect(() => {
    dashboardRef.current = dashboard;
    dashboardCursor.current = dashboard && Number.isSafeInteger(dashboard.cursor)
      ? (dashboard.cursor ?? null)
      : null;
  }, [dashboard]);

  useEffect(() => {
    dashboardRequestGeneration.current += 1;
    dashboardRequest.current?.abort.abort();
    dashboardRequest.current = null;
    if (dashboardRef.current?.project.id !== activeProjectId) {
      dashboardCursor.current = null;
    }
  }, [activeProjectId, token]);

  const refresh = useCallback(async (
    mode: "delta" | "snapshot" = "delta",
  ) => {
    if (demoMode || !token || !activeProjectId) return;
    const currentRequest = dashboardRequest.current;
    if (currentRequest?.projectId === activeProjectId && mode === "delta") {
      return currentRequest.promise;
    }
    currentRequest?.abort.abort();
    const abort = new AbortController();
    const generation = ++dashboardRequestGeneration.current;
    const projectId = activeProjectId;
    const promise = (async () => {
      try {
        let current = dashboardRef.current?.project.id === projectId
          ? dashboardRef.current
          : null;
        let cursor = dashboardCursor.current;
        if (mode === "snapshot" || !current || cursor === null) {
          current = await loadDashboard(token, projectId, abort.signal);
          cursor = current.cursor ?? null;
        } else {
          let pages = 0;
          while (true) {
            let delta;
            try {
              delta = await loadDashboardDelta(
                token,
                projectId,
                cursor,
                abort.signal,
              );
            } catch (caught) {
              if (!isApiErrorStatus(caught, 410)) throw caught;
              current = await loadDashboard(token, projectId, abort.signal);
              cursor = current.cursor ?? null;
              break;
            }
            const merged = mergeDashboardDelta(current, delta);
            current = merged.dashboard;
            cursor = delta.cursor;
            pages += 1;
            if (!delta.hasMore) break;
            if (pages >= 20) {
              current = await loadDashboard(token, projectId, abort.signal);
              cursor = current.cursor ?? null;
              break;
            }
          }
        }
        if (
          abort.signal.aborted ||
          generation !== dashboardRequestGeneration.current
        ) return;
        dashboardCursor.current = cursor;
        if (current !== dashboardRef.current) {
          dashboardRef.current = current;
          setDashboard(current);
        }
        setError(null);
      } catch (caught) {
        if (abort.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (dashboardRequest.current?.abort === abort) {
          dashboardRequest.current = null;
        }
      }
    })();
    dashboardRequest.current = { projectId, abort, promise };
    return promise;
  }, [activeProjectId, token]);

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
        clearToken: clearSessionToken,
        loadOrganizations,
        loadProjects,
        loadSession,
        readToken: readSessionToken,
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
                loadOrganizations,
              },
            );
      } catch (caught) {
        if (!cancelled) scheduleRetry(caught);
        return;
      }
      const inventoryObservation: LocalProjectInventoryObservation = remoteMode
        ? { status: "loaded", connectedProjectIds: null, error: null }
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
    if (demoMode || !token || !activeProjectId) return;
    return startDashboardPolling((reason) =>
      void refresh(reason === "poll" ? "delta" : "snapshot")
    );
  }, [activeProjectId, refresh, token]);

  useEffect(() => {
    if (
      lockedProjectId ||
      demoMode ||
      remoteMode ||
      !token ||
      connectedProjectIds === null
    ) {
      return;
    }
    const projectIds = projects
      .map((project) => project.id)
      .filter((projectId) =>
        isProjectConnectedLocally(connectedProjectIds, projectId),
      );
    if (projectIds.length === 0) return;
    return startProjectAgentSchedulePolling(
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
          executeScheduledProjectAgent(
            {
              loadDashboard,
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
              runAgent: runProjectAgent,
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
    connectedProjectIds,
    lockedProjectId,
    projects,
    settleScheduledAgentSession,
    startScheduledAgentSession,
    startScheduledAgentWorkerDispatch,
    token,
  ]);

  const applyProjectReadinessObservation = useCallback((
    projectId: string,
    observation: LocalProjectReadinessObservation<RepositoryReadiness>,
  ) => {
    if (observation.status === "superseded") return null;
    applyLocalProjectInventoryObservation(
      observation.status === "unknown"
        ? {
            status: "error",
            connectedProjectIds: null,
            error: observation.error,
          }
        : {
            status: "loaded",
            connectedProjectIds: observation.connectedProjectIds,
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
      connectedProjectIds === null
    ) {
      return;
    }
    const projectIds = projects
      .map((project) => project.id)
      .filter((projectId) =>
        isProjectConnectedLocally(connectedProjectIds, projectId),
      );
    if (projectIds.length === 0) return;

    let cancelled = false;
    void syncSharedProjectWorkflows({
      projectIds,
      lastSyncedKeys: lastSyncedSharedWorkflowKeys.current,
      loadSharedWorkflow: async (projectId) =>
        (await loadDashboard(token, projectId)).settings.workflow,
      updateLocalWorkflow: updateLocalProjectWorkflow,
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
    connectedProjectIds,
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
      !isProjectConnectedLocally(connectedProjectIds, projectId)
    ) {
      setHealth(null);
      setHealthError(null);
      setHealthLoading(false);
      return null;
    }
    const isCurrent = () =>
      request === healthRequest.current &&
      activeProjectIdRef.current === projectId;
    setHealthLoading(true);
    try {
      // Project workflow tools are shared via project settings. Mirror them
      // into the local config so this worker machine can probe readiness.
      const sharedWorkflow =
        dashboardRef.current?.project.id === projectId
          ? dashboardRef.current.settings.workflow
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
          await updateLocalProjectWorkflow(projectId, sharedWorkflow);
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
  }, [activeProjectId, connectedProjectIds, refreshProjectReadiness]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  // Dashboard settings are the source of shared workflow tools. When they
  // arrive or change, re-run health so Project Settings and the connection
  // panel stop showing "Not checked" / empty tool lists. Depend on content,
  // not object identity, so dashboard snapshot polling does not re-probe
  // every cycle.
  const sharedWorkflowSyncKey = dashboard?.settings.workflow
    ? `${dashboard.project.id}:${JSON.stringify(dashboard.settings.workflow)}`
    : null;
  useEffect(() => {
    if (
      demoMode ||
      remoteMode ||
      !dashboard?.project.id ||
      !sharedWorkflowSyncKey ||
      !isProjectConnectedLocally(connectedProjectIds, dashboard.project.id)
    ) {
      return;
    }
    if (dashboard.project.id !== activeProjectId) return;
    void refreshHealth();
  }, [
    activeProjectId,
    connectedProjectIds,
    dashboard?.project.id,
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
    connectedProjectIds,
    lockedProjectId,
    projects,
    readinessCoordinator,
    setProjectReadinessLoading,
  ]);

  const login = useCallback(async (
    options: {
      method?: DeviceLoginMethod;
      locale?: "ko" | "en" | "zh";
      switchAccount?: boolean;
    } = {},
  ) => {
    const attempt = ++loginAttempt.current;
    clearLoginTimer();
    setLoading(true);
    setError(null);
    try {
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
            const nextToken = result.access_token;
            const [nextUser, nextProjects, loadedOrganizations] =
              await Promise.all([
                loadSession(nextToken),
                loadProjects(nextToken),
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
            const inventoryObservation: LocalProjectInventoryObservation =
              remoteMode
                ? { status: "loaded", connectedProjectIds: null, error: null }
                : await readinessCoordinator.inspectInventory();
            if (attempt !== loginAttempt.current) return;
            await writeSessionToken(nextToken);
            if (attempt !== loginAttempt.current) {
              await clearSessionToken();
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
  }, [clearLoginTimer, deferDefaultOrganization, lockedProjectId]);

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
          loadProjects(token),
        ]);
        setOrganizations(nextOrganizations);
        setProjects(nextProjects);
        setActiveOrganizationId(result.invitation.organizationId);
        setActiveProjectId(result.invitation.initialProjectId);
        setDashboard(null);
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

  const logout = useCallback(async () => {
    reconnectRequest.current += 1;
    cancelLogin();
    if (token) {
      await deleteAndroidPushRegistration(token).catch(() => false);
    }
    await clearSessionToken();
    setToken(null);
    setUser(null);
    setProjects([]);
    setOrganizations([]);
    setConnectedProjectIds(null);
    setLocalProjectInventoryError(null);
    setActiveOrganizationId(null);
    setDashboard(null);
    setActiveProjectId(null);
    setProjectConnection(null);
    setIsCreatingProject(false);
  }, [cancelLogin, token]);

  const updateAccountProfile = useCallback(
    async (input: {
      username: string | null;
      name: string;
      image: string | null;
    }) => {
      if (!user) throw new Error("로그인이 필요합니다.");
      const nextUser =
        demoMode || !token
          ? { ...user, ...input }
          : await updateRemoteAccountProfile(token, input);
      setUser(nextUser);
      return nextUser;
    },
    [token, user],
  );

  const deleteAccount = useCallback(
    async (confirmation: string) => {
      reconnectRequest.current += 1;
      if (!token) throw new Error("로그인이 필요합니다.");
      await deleteRemoteAccount(token, confirmation);
      await Promise.allSettled(
        projects.map((project) => disconnectLocalProject(project.id)),
      );
      cancelLogin();
      await clearSessionToken();
      setToken(null);
      setUser(null);
      setProjects([]);
      setOrganizations([]);
      setConnectedProjectIds(null);
      setLocalProjectInventoryError(null);
      setActiveOrganizationId(null);
      setDashboard(null);
      setActiveProjectId(null);
      setProjectConnection(null);
      setIsCreatingProject(false);
    },
    [cancelLogin, projects, token],
  );

  const startProjectCreation = useCallback(() => {
    reconnectRequest.current += 1;
    setError(null);
    setIsCreatingProject(true);
  }, []);

  const cancelProjectCreation = useCallback(() => {
    reconnectRequest.current += 1;
    setError(null);
    setIsCreatingProject(false);
    setProjectConnection(null);
  }, []);

  const finishProjectCreation = useCallback(() => {
    setError(null);
    setIsCreatingProject(false);
    setProjectConnection(null);
  }, []);

  const selectProject = useCallback(
    (projectId: string) => {
      if (lockedProjectId && projectId !== lockedProjectId) return;
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      if (activeProjectIdRef.current === project.id) {
        setActiveOrganizationId((current) => project.organizationId ?? current);
        setError(null);
        return;
      }
      reconnectRequest.current += 1;
      setActiveProjectId(projectId);
      setActiveOrganizationId((current) => project.organizationId ?? current);
      if (!demoMode) {
        setDashboard(null);
        setError(null);
        return;
      }
      setDashboard(
        project.id === demoDashboard.project.id
          ? demoDashboard
          : emptyDashboard(project),
      );
      setError(null);
    },
    [lockedProjectId, projects],
  );

  const ensureProjectSelected = useCallback(
    async (projectId: string) => {
      reconnectRequest.current += 1;
      if (lockedProjectId && projectId !== lockedProjectId) {
        throw new Error("이 윈도우에서는 다른 프로젝트를 열 수 없습니다.");
      }
      let nextProjects = projects;
      let project = nextProjects.find((candidate) => candidate.id === projectId);
      if (!project && token && !demoMode) {
        nextProjects = await loadProjects(token);
        setProjects(nextProjects);
        project = nextProjects.find((candidate) => candidate.id === projectId);
      }
      if (!project) {
        throw new Error("요청한 프로젝트를 찾을 수 없습니다.");
      }
      if (activeProjectIdRef.current === project.id) {
        setActiveOrganizationId((current) => project.organizationId ?? current);
        setError(null);
        return project;
      }
      setActiveProjectId(project.id);
      setActiveOrganizationId((current) => project.organizationId ?? current);
      if (!demoMode) {
        setDashboard(null);
        setError(null);
        return project;
      }
      setDashboard(
        project.id === demoDashboard.project.id
          ? demoDashboard
          : emptyDashboard(project),
      );
      setError(null);
      return project;
    },
    [demoMode, lockedProjectId, projects, token],
  );

  const selectOrganization = useCallback(
    (organizationId: string) => {
      if (lockedProjectId) {
        const lockedProject = projects.find(
          (project) => project.id === lockedProjectId,
        );
        if (lockedProject?.organizationId !== organizationId) return;
        reconnectRequest.current += 1;
        setActiveOrganizationId(organizationId);
        setActiveProjectId(lockedProject.id);
        setError(null);
        return;
      }
      if (!organizations.some((organization) => organization.id === organizationId)) {
        return;
      }
      reconnectRequest.current += 1;
      const project =
        projects.find((candidate) => candidate.organizationId === organizationId) ??
        null;
      setActiveOrganizationId(organizationId);
      setActiveProjectId(project?.id ?? null);
      setDashboard(
        demoMode && project
          ? project.id === demoDashboard.project.id
            ? demoDashboard
            : emptyDashboard(project)
          : null,
      );
      setHealth(null);
      setHealthError(null);
      setError(null);
    },
    [lockedProjectId, organizations, projects],
  );

  const renameOrganization = useCallback(
    async (organizationId: string, name: string) => {
      const currentOrganization = organizations.find(
        (organization) => organization.id === organizationId,
      );
      if (!currentOrganization) {
        throw new Error("변경할 조직을 찾을 수 없습니다.");
      }
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      const organization =
        demoMode || !token
          ? { ...currentOrganization, name }
          : (
              await updateRemoteOrganization(token, organizationId, name)
            ).organization;
      setOrganizations((current) =>
        current.map((candidate) =>
          candidate.id === organizationId ? organization : candidate,
        ),
      );
      setProjects((current) =>
        current.map((project) =>
          project.organizationId === organizationId
            ? { ...project, organizationName: organization.name }
            : project,
        ),
      );
      setDashboard((current) =>
        current?.project.organizationId === organizationId
          ? {
              ...current,
              project: {
                ...current.project,
                organizationName: organization.name,
              },
            }
          : current,
      );
      return organization;
    },
    [organizations, token],
  );

  const changeOrganizationLogo = useCallback(
    async (organizationId: string, logo: string | null) => {
      const currentOrganization = organizations.find(
        (organization) => organization.id === organizationId,
      );
      if (!currentOrganization) {
        throw new Error("변경할 조직을 찾을 수 없습니다.");
      }
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      const organization =
        demoMode || !token
          ? { ...currentOrganization, logo }
          : (
              await updateRemoteOrganizationLogo(token, organizationId, logo)
            ).organization;
      setOrganizations((current) =>
        current.map((candidate) =>
          candidate.id === organizationId ? organization : candidate,
        ),
      );
      return organization;
    },
    [organizations, token],
  );

  const changeProjectIcon = useCallback(
    async (projectId: string, icon: string | null) => {
      const currentProject = projects.find((project) => project.id === projectId);
      if (!currentProject) throw new Error("변경할 프로젝트를 찾을 수 없습니다.");
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      const project =
        demoMode || !token
          ? { ...currentProject, icon }
          : (await updateRemoteProjectIcon(token, projectId, icon)).project;
      setProjects((current) =>
        current.map((candidate) =>
          candidate.id === projectId ? project : candidate,
        ),
      );
      setDashboard((current) =>
        current?.project.id === projectId
          ? { ...current, project }
          : current,
      );
      setProjectConnection((current) =>
        current?.project.id === projectId
          ? { ...current, project }
          : current,
      );
      return project;
    },
    [projects, token],
  );

  const changeProjectIssueKeyPrefix = useCallback(
    async (projectId: string, issueKeyPrefix: string) => {
      const currentProject = projects.find((project) => project.id === projectId);
      if (!currentProject) throw new Error("변경할 프로젝트를 찾을 수 없습니다.");
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      const project =
        demoMode || !token
          ? { ...currentProject, issueKeyPrefix }
          : (
              await updateRemoteProjectIssueKeyPrefix(
                token,
                projectId,
                issueKeyPrefix,
              )
            ).project;
      setProjects((current) =>
        current.map((candidate) =>
          candidate.id === projectId ? project : candidate,
        ),
      );
      setDashboard((current) =>
        current?.project.id === projectId
          ? { ...current, project }
          : current,
      );
      setProjectConnection((current) =>
        current?.project.id === projectId
          ? { ...current, project }
          : current,
      );
      return project;
    },
    [projects, token],
  );

  const changeProjectScheduleTab = useCallback(
    async (projectId: string, scheduleTabEnabled: boolean) => {
      const currentProject = projects.find((project) => project.id === projectId);
      if (!currentProject) throw new Error("변경할 프로젝트를 찾을 수 없습니다.");
      if (!demoMode && !token) throw new Error("로그인이 필요합니다.");
      const project =
        demoMode || !token
          ? { ...currentProject, scheduleTabEnabled }
          : (
              await updateRemoteProjectTabs(token, projectId, {
                schedule: scheduleTabEnabled,
              })
            ).project;
      setProjects((current) =>
        current.map((candidate) =>
          candidate.id === projectId ? project : candidate,
        ),
      );
      setDashboard((current) =>
        current?.project.id === projectId
          ? { ...current, project }
          : current,
      );
      setProjectConnection((current) =>
        current?.project.id === projectId
          ? { ...current, project }
          : current,
      );
      return project;
    },
    [projects, token],
  );

  const checkOrganizationHandle = useCallback(
    async (handle: string) => {
      if (demoMode) {
        return !organizations.some(
          (organization) => organization.handle === handle,
        );
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      return checkRemoteOrganizationHandle(token, handle);
    },
    [organizations, token],
  );

  const addOrganization = useCallback(
    async (input: { name: string; handle: string }) => {
      reconnectRequest.current += 1;
      let organization: Organization;
      if (demoMode) {
        if (
          organizations.some(
            (candidate) => candidate.handle === input.handle,
          )
        ) {
          throw new Error("Organization handle already exists");
        }
        organization = {
          id: crypto.randomUUID(),
          name: input.name.trim(),
          handle: input.handle,
          logo: null,
          role: "owner",
          createdAt: new Date().toISOString(),
        };
      } else {
        if (!token) throw new Error("로그인이 필요합니다.");
        const result = await createRemoteOrganization(token, input);
        organization = result.organization;
      }
      setOrganizations((current) => [...current, organization]);
      setActiveOrganizationId(organization.id);
      setActiveProjectId(null);
      setDashboard(null);
      setHealth(null);
      setHealthError(null);
      setError(null);
      return organization;
    },
    [organizations, token],
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
          organizationId: organization.id,
          organizationName: organization.name,
          role: organization.role,
          createdAt: new Date().toISOString(),
        };
        setProjects((current) => [...current, project]);
        setActiveOrganizationId(organization.id);
        setActiveProjectId(project.id);
        setDashboard(emptyDashboard(project));
        setError(null);
        setIsCreatingProject(false);
        return { project, agentToken: null };
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      setLoading(true);
      setError(null);
      try {
        const result = await createProject(token, {
          ...input,
          organizationId: activeOrganizationId ?? undefined,
        });
        const nextOrganizations = await loadOrganizations(token).catch(() => null);
        setProjects((current) => [...current, result.project]);
        if (nextOrganizations) setOrganizations(nextOrganizations);
        setActiveOrganizationId(
          result.project.organizationId ?? activeOrganizationId,
        );
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
    [activeOrganizationId, organizations, token],
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
            await disconnectLocalProject(projectId);
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
          setDashboard(
            demoMode && nextActiveProject
              ? nextActiveProject.id === demoDashboard.project.id
                ? demoDashboard
                : emptyDashboard(nextActiveProject)
              : null,
          );
          setHealth(null);
          setHealthError(null);
          if (!demoMode && token && nextActiveProject) {
            try {
              setDashboard(await loadDashboard(token, nextActiveProject.id));
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : String(caught));
            }
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
    [activeOrganizationId, activeProjectId, lockedProjectId, projects, token],
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
    return await createProjectWorkspace(name);
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
      const saved = await updateProjectSettings(token, projectId, {
        ...projectDashboard.settings,
        githubRepository,
      });
      const { credential, prepared } =
        await prepareConfiguredProjectRepository(
          saved.settings,
          () => createProjectGithubCredential(token, projectId),
          (projectCredential) =>
            prepareProjectRepository(projectId, projectCredential),
        );
      const connectedSettings = {
        ...saved.settings,
        githubRepositoryId: credential.repository.id,
        githubRepository: credential.repository.fullName,
      };
      setDashboard((current) =>
        current?.project.id === projectId
          ? { ...current, settings: connectedSettings }
          : { ...projectDashboard, settings: connectedSettings }
      );
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
  }, [token]);

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
      preflightLocalProjectConnection({ autoHunt, repositoryPath }),
    [],
  );

  const connectProject = useCallback(async (
    autoHunt: LocalAutoHuntConfig,
    repositoryPath: string,
    onWorkflowProgress?: (progress: ProjectLlmProgress) => void,
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
      const connected = await connectLocalProject({
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
        shouldPersistProjectSettings,
      } = await resolveProjectConnectionWorkflow(
        connection.project.role,
        connection.workflow,
        () => generateProjectWorkflow(
          connection.project.id,
          undefined,
          onWorkflowProgress,
        ),
        !isRepositoryWorkflowPending(autoHunt.workflow)
          ? autoHunt.workflow
          : undefined,
      );
      await updateLocalProjectWorkflow(
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
      if (token && shouldPersistProjectSettings) {
        const saved = await updateProjectSettings(
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
      if (token && !connectedProject.icon) {
        try {
          const discovered = await discoverRepositoryIcon(connected.repositoryPath);
          if (discovered) {
            const icon = await projectIconFromDataUrl(discovered);
            connectedProject = (
              await updateRemoteProjectIcon(token, connectedProject.id, icon)
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

      if (shouldPersistProjectSettings) {
        setDashboard((current) =>
          current?.project.id === connection.project.id
            ? { ...current, project: connectedProject, settings: savedSettings }
            : {
                ...emptyDashboard(connectedProject),
                settings: savedSettings,
              },
        );
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
    projectConnection,
    refreshProjectReadiness,
    readinessCoordinator,
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
      const projectDashboard = dashboard?.project.id === projectId
        ? dashboard
        : await loadDashboard(token, projectId);
      const settings = projectDashboard.settings;
      const { credential, prepared } =
        await prepareConfiguredProjectRepository(
          settings,
          () => createProjectGithubCredential(token, projectId),
          (projectCredential) =>
            prepareProjectRepository(projectId, projectCredential),
        );
      const connectedSettings = {
        ...settings,
        githubRepositoryId: credential.repository.id,
        githubRepository: credential.repository.fullName,
      };
      const agentToken = (await createAgentToken(token, projectId)).agentToken;
      await connectLocalProject({
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
      const readiness = await loadProjectRepositoryReadiness(projectId);
      if (!readiness) {
        throw new Error("준비한 저장소 상태를 확인하지 못했습니다.");
      }
      if (!isCurrent()) return null;
      setProjectReadiness((current) => ({ ...current, [projectId]: readiness }));
      setDashboard((current) =>
        current?.project.id === projectId
          ? { ...current, settings: connectedSettings }
          : current
      );
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
      activeProjectIdRef.current === projectId;
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
  }, [activeProjectId]);

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
      } else if (dashboard?.project.id === project.id) {
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
    setActiveOrganizationId((current) => project.organizationId ?? current);
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
      if (!token || !dashboard || dashboard.project.id !== projectId) {
        throw new Error("워크플로우를 갱신할 프로젝트 설정이 없습니다.");
      }
      await updateLocalProjectWorkflow(projectId, nextWorkflow);
      try {
        const result = await updateProjectSettings(token, projectId, {
          ...dashboard.settings,
          workflow: nextWorkflow,
        });
        setDashboard((current) =>
          current?.project.id === projectId
            ? { ...current, settings: result.settings }
            : current,
        );
        await Promise.all([
          refreshProjectReadiness(projectId),
          refreshHealth(),
        ]);
      } catch (caught) {
        try {
          await updateLocalProjectWorkflow(projectId, previousWorkflow);
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
    [dashboard, refreshHealth, refreshProjectReadiness, token],
  );

  const regenerateWorkflow = useCallback(
    async (projectId: string) => {
      if (demoMode) {
        throw new Error("워크플로우 재생성은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      if (!dashboard || dashboard.project.id !== projectId) {
        throw new Error("워크플로우를 갱신할 프로젝트 설정이 없습니다.");
      }

      const previousWorkflow = dashboard.settings.workflow;
      const generatedWorkflow = await generateProjectWorkflow(
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
      onProgress?: (progress: ProjectLlmProgress) => void,
    ) => {
      if (demoMode) {
        throw new Error("필요 도구 분석은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      if (!dashboard || dashboard.project.id !== projectId) {
        throw new Error("필요 도구를 분석할 프로젝트 설정이 없습니다.");
      }

      const previousWorkflow = dashboard.settings.workflow;
      const analyzedWorkflow = await analyzeProjectWorkflowRequirements(
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
      if (!dashboard || dashboard.project.id !== projectId) {
        throw new Error("워크플로우를 갱신할 프로젝트 설정이 없습니다.");
      }

      const previousWorkflow = dashboard.settings.workflow;
      const revisedWorkflow = await reviseProjectWorkflow(
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
      >["projectMandatory"],
      expectedRevision: number,
    ) => {
      if (!token) throw new Error("로그인이 필요합니다.");
      if (!dashboard || dashboard.project.id !== projectId) {
        throw new Error("체크포인트를 저장할 프로젝트 설정이 없습니다.");
      }
      const result = await updateCheckpointPolicy(token, projectId, {
        scope,
        checkpoints,
        expectedRevision,
      });
      setDashboard((current) => current?.project.id === projectId
        ? {
            ...current,
            settings: {
              ...current.settings,
              checkpointPolicy: result.checkpointPolicy,
            },
          }
        : current);
      return result.checkpointPolicy;
    },
    [dashboard, token],
  );

  useEffect(() => {
    const projectId = dashboard?.project.id;
    if (
      demoMode ||
      remoteMode ||
      !token ||
      !projectId ||
      !connectedProjectIds?.includes(projectId) ||
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
    connectedProjectIds,
    dashboard,
    projectConnection,
    regenerateWorkflow,
    token,
  ]);

  const assertRepositoryReadyForLinearImport = useCallback(
    (projectId: string) => {
      const githubRepository =
        dashboard?.project.id === projectId
          ? dashboard.settings.githubRepository
          : null;
      const repositoryPath =
        health?.projectId === projectId ? health.repositoryPath : null;
      const ready = isRepositoryConnectedForImport({
        projectId,
        connectedProjectIds,
        githubRepository,
        repositoryPath,
      });
      if (!ready) {
        throw new Error(
          "저장소를 연결한 뒤에 Linear 이슈를 가져올 수 있습니다.",
        );
      }
    },
    [connectedProjectIds, dashboard, health],
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
        statusMapping: Record<string, string>;
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
      if (!dashboard || dashboard.project.id !== projectId) {
        throw new Error("Velen 연결을 저장할 프로젝트 설정이 없습니다.");
      }
      const normalized = org?.trim() || null;
      if (demoMode) {
        setDashboard((current) =>
          current?.project.id === projectId
            ? {
                ...current,
                settings: {
                  ...current.settings,
                  velenOrg: normalized,
                  ...(normalized
                    ? {}
                    : {
                        dataSource: null,
                        linear: { enabled: false, source: null, teamKey: null },
                      }),
                },
              }
            : current,
        );
        return normalized;
      }
      if (!token) throw new Error("로그인이 필요합니다.");

      const previous = dashboard.settings.velenOrg;
      const local = remoteMode
        ? normalized
        : await updateLocalProjectVelenOrg(projectId, normalized);
      try {
        const result = await updateProjectSettings(token, projectId, {
          ...dashboard.settings,
          velenOrg: local,
          ...(local
            ? {}
            : {
                dataSource: null,
                linear: { enabled: false, source: null, teamKey: null },
              }),
        });
        setDashboard((current) =>
          current?.project.id === projectId
            ? { ...current, settings: result.settings }
            : current,
        );
        return result.settings.velenOrg;
      } catch (caught) {
        if (!remoteMode) {
          try {
            await updateLocalProjectVelenOrg(projectId, previous);
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
    [dashboard, token],
  );

  const addPlanningProject = useCallback(
    async (
      teamId: string,
      input: {
        name: string;
        description?: string;
        status?: PlanningProjectStatus;
      },
    ) => {
      const team = projects.find((candidate) => candidate.id === teamId);
      if (!team) throw new Error("프로젝트를 추가할 팀이 없습니다.");
      if (demoMode) {
        const observedAt = new Date().toISOString();
        const project: PlanningProject = {
          id: crypto.randomUUID(),
          workspaceId: team.organizationId ?? demoOrganization.id,
          workspaceName: team.organizationName ?? demoOrganization.name,
          teamId,
          teamName: team.name,
          name: input.name.trim(),
          description: input.description?.trim() ?? "",
          status: input.status ?? "planned",
          leadUserId: null,
          leadName: null,
          startDate: null,
          targetDate: null,
          icon: null,
          color: null,
          sortOrder: planningProjects.filter(
            (candidate) => candidate.teamId === teamId,
          ).length,
          isDefault: false,
          role: team.role ?? "owner",
          createdAt: observedAt,
          updatedAt: observedAt,
        };
        setPlanningProjects((current) => [...current, project]);
        return project;
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      const project = await createRemotePlanningProject(token, teamId, input);
      setPlanningProjects((current) => [...current, project].sort(
        (left, right) =>
          left.teamId.localeCompare(right.teamId) ||
          left.sortOrder - right.sortOrder ||
          left.createdAt.localeCompare(right.createdAt),
      ));
      return project;
    },
    [planningProjects, projects, token],
  );

  const editPlanningProject = useCallback(
    async (
      projectId: string,
      input: {
        name: string;
        description: string;
        status: PlanningProjectStatus;
      },
    ) => {
      const existing = planningProjects.find(
        (candidate) => candidate.id === projectId,
      );
      if (!existing) throw new Error("수정할 프로젝트가 없습니다.");
      const normalized = {
        name: input.name.trim(),
        description: input.description.trim(),
        status: input.status,
      };
      const project = demoMode
        ? {
            ...existing,
            ...normalized,
            updatedAt: new Date().toISOString(),
          }
        : await (async () => {
            if (!token) throw new Error("로그인이 필요합니다.");
            return updateRemotePlanningProject(token, projectId, normalized);
          })();
      setPlanningProjects((current) => current.map((candidate) =>
        candidate.id === projectId ? project : candidate
      ));
      return project;
    },
    [planningProjects, token],
  );

  const addIssue = useCallback(
    async (projectId: string, input: CreateIssueInput) => {
      const planningProject = planningProjects.find(
        (candidate) => candidate.id === projectId,
      );
      const teamId = planningProject?.teamId ?? projectId;
      const project = projects.find((candidate) => candidate.id === teamId);
      if (!project || (!demoMode && !planningProject)) {
        throw new Error("이슈를 추가할 프로젝트가 없습니다.");
      }
      setIsCreatingIssue(true);
      setError(null);
      try {
        if (demoMode) {
          const targetDashboard = dashboard?.project.id === teamId
            ? dashboard
            : emptyDashboard(project);
          const occurredAt = new Date().toISOString();
          const issueId = crypto.randomUUID();
          const sourceKey = `briar-issue:${issueId}`;
          const attachments: IssueAttachment[] = input.attachments.map((file) => ({
            id: crypto.randomUUID(),
            filename: file.name,
            contentType: file.type,
            byteSize: file.size,
            url: URL.createObjectURL(file),
          }));
          const issueDescription = canonicalizeIssueAttachmentReferences(
            input.description,
            input.attachmentReferences ?? [],
            attachments.map((attachment) => attachment.id),
          );
          const detail = input.status === "backlog"
            ? "Briar 앱에서 생성된 이슈가 백로그에 추가되었습니다."
            : "Briar 앱에서 생성된 이슈가 처리를 기다리고 있습니다.";
          const initialEvent: HuntEvent = {
            id: crypto.randomUUID(),
            attempt: 1,
            revision: 1,
            status: input.status,
            workflowStage: null,
            detail,
            actor: "briar-app",
            qaStatus: null,
            trackerState: null,
            pullRequestUrls: [],
            targetSha: null,
            occurredAt,
            recordedAt: occurredAt,
          };
          const baseWorkflow = targetDashboard.settings.checkpointPolicy
            ? {
                ...targetDashboard.settings.workflow,
                execution: {
                  checkpoints:
                    targetDashboard.settings.checkpointPolicy.effective,
                },
              }
            : targetDashboard.settings.workflow;
          const run: HuntRun = {
            id: crypto.randomUUID(),
            workspaceId: project.organizationId ?? demoOrganization.id,
            teamId,
            projectId,
            projectName: planningProject?.name ?? null,
            runNumber:
              Math.max(
                0,
                ...targetDashboard.runs.map((candidate) => candidate.runNumber),
              ) + 1,
            currentAttempt: 1,
            currentRevision: 1,
            source: "issue",
            sourceKey,
            title: input.title.trim(),
            status: input.status,
            workflowStage: null,
            workflow: input.fullAuto
              ? {
                  ...baseWorkflow,
                  execution: { checkpoints: [] },
                }
              : workflowWithAdditionalCheckpoints(
                  baseWorkflow,
                  input.checkpoints ?? [],
                ),
            issueCheckpoints: input.fullAuto ? [] : input.checkpoints ?? [],
            fullAuto: input.fullAuto ?? false,
            progress: input.status === "backlog" ? 0 : 5,
            detail,
            priority: input.priority,
            difficulty: input.difficulty,
            assigneeUserId:
              input.assigneeUserId === undefined
                ? user?.id ?? null
                : input.assigneeUserId,
            preferredProvider: input.preferredProvider ?? null,
            preferredModel: input.preferredModel ?? null,
            preferredEffort: input.preferredEffort ?? null,
            repository:
              targetDashboard.settings.githubRepository ?? project.name,
            branch: null,
            commitSha: null,
            tracker: null,
            issueDescription,
            attachments,
            resultSummary: null,
            structuredResult: null,
            pullRequestUrls: [],
            targetSha: null,
            sourceCreatedAt: occurredAt,
            stagingQaStatus: null,
            productionQaStatus: null,
            stagingQaDetail: null,
            productionQaDetail: null,
            context: {
              origin: "briar-app",
              issueId,
              attachmentCount: attachments.length,
              fullAuto: input.fullAuto ?? false,
            },
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
            claimAttempts: 0,
            startedAt: occurredAt,
            updatedAt: occurredAt,
            completedAt: null,
            lastEventAt: occurredAt,
            eventCount: 1,
          };
          runEventsByRun.current[run.id] = [initialEvent];
          setActiveProjectId(teamId);
          setActiveOrganizationId((current) => project.organizationId ?? current);
          setDashboard({
            ...targetDashboard,
            runs: [run, ...targetDashboard.runs],
          });
          return {
            runId: run.id,
            sourceKey,
            stage: "queued" as const,
            status: input.status,
          };
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        const result = await createIssue(token, planningProject!.id, input);
        if (teamId === activeProjectId) {
          await refresh("snapshot");
        } else {
          selectProject(teamId);
        }
        return result;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        setIsCreatingIssue(false);
      }
    },
    [
      activeProjectId,
      dashboard,
      planningProjects,
      projects,
      refresh,
      selectProject,
      token,
      user,
    ],
  );

  const moveIssueProject = useCallback(
    async (runId: string, sourceProjectId: string, targetProjectId: string) => {
      if (!dashboard) throw new Error("이슈를 이동할 팀이 없습니다.");
      const target = planningProjects.find(
        (project) => project.id === targetProjectId,
      );
      if (!target || target.teamId !== dashboard.project.id) {
        throw new Error("같은 팀의 프로젝트로만 이슈를 이동할 수 있습니다.");
      }
      setError(null);
      try {
        if (demoMode) {
          setDashboard((current) => current ? {
            ...current,
            runs: current.runs.map((run) => run.id === runId
              ? {
                ...run,
                projectId: target.id,
                projectName: target.name,
                updatedAt: new Date().toISOString(),
              }
              : run),
          } : current);
          return { outcome: "moved" as const };
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        const result = await moveRemoteIssueToPlanningProject(
          token,
          sourceProjectId,
          runId,
          targetProjectId,
        );
        await refresh("snapshot");
        return result;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      }
    },
    [dashboard, planningProjects, refresh, token],
  );

  const readIssueAttachment = useCallback(
    async (attachment: IssueAttachment) => {
      if (!token && !attachment.url.startsWith("blob:")) {
        throw new Error("첨부 파일을 열려면 로그인이 필요합니다.");
      }
      return loadIssueAttachment(token ?? "", attachment);
    },
    [token],
  );

  const editIssue = useCallback(
    async (runId: string, input: UpdateIssueInput) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("이슈를 수정할 프로젝트가 없습니다.");
      }
      setUpdatingIssueId(runId);
      setError(null);
      try {
        if (demoMode) {
          const updatedAt = new Date().toISOString();
          const addedAttachments: IssueAttachment[] = input.attachments.map(
            (file) => ({
              id: crypto.randomUUID(),
              filename: file.name,
              contentType: file.type,
              byteSize: file.size,
              url: URL.createObjectURL(file),
            }),
          );
          const canonicalDescription = canonicalizeIssueAttachmentReferences(
            input.description,
            input.attachmentReferences ?? [],
            addedAttachments.map((attachment) => attachment.id),
          );
          setDashboard((current) =>
            current
              ? {
                  ...current,
                  runs: current.runs.map((run) =>
                    run.id === runId
                      ? {
                          ...run,
                          title: input.title.trim(),
                          issueDescription: canonicalDescription,
                          priority: input.priority,
                          difficulty: input.difficulty,
                          assigneeUserId:
                            input.assigneeUserId === undefined
                              ? run.assigneeUserId ?? null
                              : input.assigneeUserId,
                          attachments: [
                            ...(input.keptAttachmentIds
                              ? (run.attachments ?? []).filter((attachment) =>
                                  input.keptAttachmentIds?.includes(
                                    attachment.id,
                                  ),
                                )
                              : run.attachments ?? []),
                            ...addedAttachments,
                          ],
                          updatedAt,
                        }
                      : run,
                  ),
                }
              : current,
          );
          return {
            runId,
            title: input.title.trim(),
            description: canonicalDescription,
            priority: input.priority,
            difficulty: input.difficulty,
            assigneeUserId: input.assigneeUserId ?? null,
            attachments: [
              ...(input.keptAttachmentIds
                ? (dashboard.runs.find((run) => run.id === runId)?.attachments ??
                  []).filter((attachment) =>
                    input.keptAttachmentIds?.includes(attachment.id),
                  )
                : dashboard.runs.find((run) => run.id === runId)?.attachments ??
                  []),
              ...addedAttachments,
            ],
          };
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        const result = await updateIssue(token, activeProjectId, runId, input);
        await refresh("snapshot");
        return result;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        setUpdatingIssueId(null);
      }
    },
    [activeProjectId, dashboard, demoMode, refresh, token],
  );

  const editIssueSubscription = useCallback(
    async (runId: string, subscribed: boolean) => {
      if (!activeProjectId || !dashboard || !user) {
        throw new Error("이슈 구독을 변경할 수 없습니다.");
      }
      setError(null);
      try {
        if (demoMode) {
          const run = dashboard.runs.find((candidate) => candidate.id === runId);
          if (!subscribed && run?.assigneeUserId === user.id) {
            throw new Error("담당자는 이슈 구독을 해제할 수 없습니다.");
          }
          const existing = run?.subscribers ?? [];
          const subscribers = subscribed
            ? existing.some((subscriber) => subscriber.userId === user.id)
              ? existing
              : [...existing, {
                  userId: user.id,
                  subscribedAt: new Date().toISOString(),
                }]
            : existing.filter((subscriber) => subscriber.userId !== user.id);
          setDashboard((current) => current
            ? {
                ...current,
                runs: current.runs.map((candidate) =>
                  candidate.id === runId ? { ...candidate, subscribers } : candidate
                ),
              }
            : current);
          return { runId, subscribers };
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        const result = await updateIssueSubscription(
          token,
          activeProjectId,
          runId,
          subscribed,
        );
        setDashboard((current) => current
          ? {
              ...current,
              runs: current.runs.map((run) =>
                run.id === runId
                  ? { ...run, subscribers: result.subscribers }
                  : run
              ),
            }
          : current);
        return result;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw caught;
      }
    },
    [activeProjectId, dashboard, demoMode, token, user],
  );

  const editIssueExecutionPreferences = useCallback(
    async (runId: string, input: IssueExecutionPreferences) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("이슈를 수정할 프로젝트가 없습니다.");
      }
      setUpdatingIssueId(runId);
      setError(null);
      try {
        if (demoMode) {
          setDashboard((current) =>
            current
              ? {
                  ...current,
                  runs: current.runs.map((run) =>
                    run.id === runId
                      ? {
                          ...run,
                          preferredProvider: input.provider,
                          preferredModel: input.model,
                          preferredEffort: input.effort,
                          updatedAt: new Date().toISOString(),
                        }
                      : run,
                  ),
                }
              : current,
          );
          return { runId, ...input };
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        const result = await updateIssueExecutionPreferences(
          token,
          activeProjectId,
          runId,
          input,
        );
        await refresh("snapshot");
        return result;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      } finally {
        setUpdatingIssueId(null);
      }
    },
    [activeProjectId, dashboard, refresh, token],
  );

  const editIssueCheckpoints = useCallback(
    async (runId: string, checkpoints: AutoHuntWorkflowCheckpoint[]) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("이슈를 수정할 프로젝트가 없습니다.");
      }
      setUpdatingIssueId(runId);
      setError(null);
      try {
        if (demoMode) {
          const updatedAt = new Date().toISOString();
          setDashboard((current) => current
            ? {
                ...current,
                runs: current.runs.map((run) => {
                  if (run.id !== runId) return run;
                  const previousBoundaries = new Set(
                    (run.issueCheckpoints ?? []).map(
                      (checkpoint) => `${checkpoint.stage}:${checkpoint.position}`,
                    ),
                  );
                  const baseWorkflow = {
                    ...run.workflow,
                    execution: {
                      checkpoints: run.workflow.execution.checkpoints.filter(
                        (checkpoint) => !previousBoundaries.has(
                          `${checkpoint.stage}:${checkpoint.position}`,
                        ),
                      ),
                    },
                  };
                  return {
                    ...run,
                    workflow: workflowWithAdditionalCheckpoints(
                      baseWorkflow,
                      checkpoints,
                    ),
                    issueCheckpoints: checkpoints,
                    updatedAt,
                  };
                }),
              }
            : current);
          return { runId, checkpoints };
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        const result = await updateIssueCheckpoints(
          token,
          activeProjectId,
          runId,
          checkpoints,
        );
        await refresh("snapshot");
        return result;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        setUpdatingIssueId(null);
      }
    },
    [activeProjectId, dashboard, refresh, token],
  );

  const completeResultReview = useCallback(
    async (runId: string): Promise<IssueResultReview> => {
      if (!activeProjectId || !dashboard || !user) {
        throw new Error("검수를 기록할 이슈 또는 로그인 정보가 없습니다.");
      }
      setError(null);
      try {
        const existing = dashboard.runs
          .find((run) => run.id === runId)
          ?.resultReviews?.find((review) => review.userId === user.id);
        let review = existing;
        if (!review) {
          if (demoMode) {
            review = {
              userId: user.id,
              name: user.name,
              username: user.username ?? null,
              image: user.image ?? null,
              completedAt: new Date().toISOString(),
            };
          } else {
            if (!token) throw new Error("로그인이 필요합니다.");
            review = await completeRemoteIssueResultReview(
              token,
              activeProjectId,
              runId,
            );
          }
        }
        setDashboard((current) =>
          current
            ? {
                ...current,
                runs: current.runs.map((run) =>
                  run.id === runId &&
                  !(run.resultReviews ?? []).some(
                    (candidate) => candidate.userId === review.userId,
                  )
                    ? {
                        ...run,
                        resultReviews: [...(run.resultReviews ?? []), review],
                      }
                    : run,
                ),
              }
            : current,
        );
        return review;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      }
    },
    [activeProjectId, dashboard, token, user],
  );

  const changeIssueDependency = useCallback(
    async (
      dependentRunId: string,
      prerequisiteRunId: string,
      action: "add" | "remove",
    ) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("의존성을 수정할 프로젝트가 없습니다.");
      }
      setUpdatingIssueId(dependentRunId);
      setError(null);
      try {
        if (demoMode) {
          setDashboard((current) => {
            if (!current) return current;
            const prerequisite = current.runs.find(
              (run) => run.id === prerequisiteRunId,
            );
            const dependent = current.runs.find(
              (run) => run.id === dependentRunId,
            );
            if (!prerequisite || !dependent) return current;
            const prerequisiteReference = {
              id: prerequisite.id,
              runNumber: prerequisite.runNumber,
              title: prerequisite.title,
              status: prerequisite.status,
            };
            const dependentReference = {
              id: dependent.id,
              runNumber: dependent.runNumber,
              title: dependent.title,
              status: dependent.status,
            };
            return {
              ...current,
              runs: current.runs.map((run) => {
                if (run.id === dependentRunId) {
                  return {
                    ...run,
                    prerequisites:
                      action === "add"
                        ? [
                            ...(run.prerequisites ?? []).filter(
                              (candidate) => candidate.id !== prerequisiteRunId,
                            ),
                            prerequisiteReference,
                          ]
                        : (run.prerequisites ?? []).filter(
                            (candidate) => candidate.id !== prerequisiteRunId,
                          ),
                  };
                }
                if (run.id === prerequisiteRunId) {
                  return {
                    ...run,
                    dependents:
                      action === "add"
                        ? [
                            ...(run.dependents ?? []).filter(
                              (candidate) => candidate.id !== dependentRunId,
                            ),
                            dependentReference,
                          ]
                        : (run.dependents ?? []).filter(
                            (candidate) => candidate.id !== dependentRunId,
                          ),
                  };
                }
                return run;
              }),
            };
          });
          return;
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        if (action === "add") {
          await addIssueDependency(
            token,
            activeProjectId,
            dependentRunId,
            prerequisiteRunId,
          );
        } else {
          await removeIssueDependency(
            token,
            activeProjectId,
            dependentRunId,
            prerequisiteRunId,
          );
        }
        setDashboard(await loadDashboard(token, activeProjectId));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      } finally {
        setUpdatingIssueId(null);
      }
    },
    [activeProjectId, dashboard, token],
  );

  const removeIssue = useCallback(
    async (runId: string) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("이슈를 삭제할 프로젝트가 없습니다.");
      }
      setDeletingIssueId(runId);
      setError(null);
      try {
        if (!demoMode) {
          if (!token) throw new Error("로그인이 필요합니다.");
          await deleteRemoteIssue(token, activeProjectId, runId);
        }
        setDashboard((current) =>
          current
            ? {
                ...current,
                runs: current.runs
                  .filter((run) => run.id !== runId)
                  .map((run) => ({
                    ...run,
                    prerequisites: (run.prerequisites ?? []).filter(
                      (dependency) => dependency.id !== runId,
                    ),
                    dependents: (run.dependents ?? []).filter(
                      (dependency) => dependency.id !== runId,
                    ),
                  })),
              }
            : current,
        );
        delete issueMessagesByRun.current[runId];
        delete runEvidenceByRun.current[runId];
        delete runEventsByRun.current[runId];
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        setDeletingIssueId(null);
      }
    },
    [activeProjectId, dashboard, token],
  );

  const transferIssueToProject = useCallback(
    async (runId: string, targetProjectId: string) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("이슈를 옮길 프로젝트가 없습니다.");
      }
      if (targetProjectId === activeProjectId) {
        throw new Error("같은 프로젝트로는 옮길 수 없습니다.");
      }
      setDeletingIssueId(runId);
      setError(null);
      try {
        if (!demoMode) {
          if (!token) throw new Error("로그인이 필요합니다.");
          await transferRemoteIssue(
            token,
            activeProjectId,
            runId,
            targetProjectId,
          );
        }
        setDashboard((current) =>
          current
            ? {
                ...current,
                runs: current.runs
                  .filter((run) => run.id !== runId)
                  .map((run) => ({
                    ...run,
                    prerequisites: (run.prerequisites ?? []).filter(
                      (dependency) => dependency.id !== runId,
                    ),
                    dependents: (run.dependents ?? []).filter(
                      (dependency) => dependency.id !== runId,
                    ),
                  })),
              }
            : current,
        );
        delete issueMessagesByRun.current[runId];
        delete runEvidenceByRun.current[runId];
        delete runEventsByRun.current[runId];
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        setDeletingIssueId(null);
      }
    },
    [activeProjectId, dashboard, demoMode, token],
  );

  const readIssueMessages = useCallback(
    async (runId: string) => {
      if (!activeProjectId) throw new Error("메시지를 불러올 프로젝트가 없습니다.");
      if (demoMode) return issueMessagesByRun.current[runId] ?? [];
      if (!token) throw new Error("메시지를 불러오려면 로그인이 필요합니다.");
      const messages = await loadIssueMessages(token, activeProjectId, runId);
      const merged = mergeIssueMessages(
        issueMessagesByRun.current[runId] ?? [],
        messages,
      );
      issueMessagesByRun.current = {
        ...issueMessagesByRun.current,
        [runId]: merged,
      };
      return merged;
    },
    [activeProjectId, token],
  );

  const readRunEvidence = useCallback(
    async (runId: string) => {
      if (!activeProjectId) throw new Error("증빙을 불러올 프로젝트가 없습니다.");
      if (demoMode) return runEvidenceByRun.current[runId] ?? [];
      if (!token) throw new Error("증빙을 불러오려면 로그인이 필요합니다.");
      const evidence = await loadRunEvidence(token, activeProjectId, runId);
      runEvidenceByRun.current = {
        ...runEvidenceByRun.current,
        [runId]: evidence,
      };
      return evidence;
    },
    [activeProjectId, token],
  );

  const readRunEvents = useCallback(
    async (runId: string) => {
      if (!activeProjectId) throw new Error("이벤트를 불러올 프로젝트가 없습니다.");
      if (demoMode) return runEventsByRun.current[runId] ?? [];
      if (!token) throw new Error("이벤트를 불러오려면 로그인이 필요합니다.");
      const events = await loadRunEvents(token, activeProjectId, runId);
      runEventsByRun.current = {
        ...runEventsByRun.current,
        [runId]: events,
      };
      return events;
    },
    [activeProjectId, token],
  );

  const readRunEvidenceImage = useCallback(
    async (image: RunEvidenceImage) => {
      if (!token) throw new Error("증빙 이미지를 불러오려면 로그인이 필요합니다.");
      return loadRunEvidenceImage(token, image);
    },
    [token],
  );

  const addIssueMessage = useCallback(
    async (
      runId: string,
      input: {
        body: string;
        clientMessageId?: string;
        parentMessageId: string | null;
        mentionedUserIds?: string[];
        mentionedAgentIds?: string[];
        attachments?: File[];
        attachmentReferences?: string[];
      },
    ): Promise<IssueMessageSendResult> => {
      const body = input.body.trim();
      if (!body && !input.attachments?.length) {
        throw new Error("메시지나 이미지를 추가해 주세요.");
      }
      if (!activeProjectId) throw new Error("메시지를 보낼 프로젝트가 없습니다.");
      const cacheMessage = (message: IssueMessage) => {
        const currentMessages = issueMessagesByRun.current[runId] ?? [];
        issueMessagesByRun.current = {
          ...issueMessagesByRun.current,
          [runId]: [
            ...currentMessages.map((candidate) =>
              candidate.id === message.parentMessageId
                ? { ...candidate, replyCount: candidate.replyCount + 1 }
                : candidate,
            ),
            message,
          ],
        };
        return message;
      };
      if (demoMode) {
        const createdAt = new Date().toISOString();
        const message = cacheMessage({
          id: input.clientMessageId ?? crypto.randomUUID(),
          runId,
          parentMessageId: input.parentMessageId,
          body,
          attachments: (input.attachments ?? []).map((file, index) => ({
            id: input.attachmentReferences?.[index] ?? crypto.randomUUID(),
            filename: file.name,
            contentType: file.type,
            byteSize: file.size,
            url: URL.createObjectURL(file),
          })),
          author: {
            id: demoUser.id,
            name: demoUser.name,
            image: demoUser.image ?? null,
            provider: null,
          },
          replyCount: 0,
          createdAt,
          updatedAt: createdAt,
        });
        return { message, agentReply: null };
      }
      if (!token) throw new Error("메시지를 보내려면 로그인이 필요합니다.");
      const created = await createIssueMessage(
        token,
        activeProjectId,
        runId,
        {
          body,
          clientMessageId: input.clientMessageId,
          parentMessageId: input.parentMessageId,
          mentionedUserIds: input.mentionedUserIds,
          mentionedAgentIds: input.mentionedAgentIds,
          attachments: input.attachments,
          attachmentReferences: input.attachmentReferences,
        },
      );
      const message = cacheMessage(created.message);
      return {
        message,
        agentReply: null,
        agentReplyJob: created.agentReply,
        agentReplyJobs: created.agentReplies ?? (
          created.agentReply ? [created.agentReply] : []
        ),
      };
    },
    [activeProjectId, token],
  );

  const updateIssueMessage = useCallback(
    async (
      runId: string,
      messageId: string,
      input: {
        body: string;
        mentionedUserIds?: string[];
      },
    ): Promise<IssueMessage> => {
      const body = input.body.trim();
      if (!body) {
        throw new Error("메시지 내용을 입력해 주세요.");
      }
      if (!activeProjectId) throw new Error("수정할 프로젝트가 없습니다.");
      if (demoMode) {
        const updatedAt = new Date().toISOString();
        const message = {
          ...(issueMessagesByRun.current[runId] ?? []).find(
            (candidate) => candidate.id === messageId,
          ),
          body,
          updatedAt,
        } as IssueMessage;
        issueMessagesByRun.current = {
          ...issueMessagesByRun.current,
          [runId]: (issueMessagesByRun.current[runId] ?? []).map((candidate) =>
            candidate.id === messageId ? message : candidate,
          ),
        };
        return message;
      }
      if (!token) throw new Error("메시지를 수정하려면 로그인이 필요합니다.");
      const updated = await editIssueMessage(
        token,
        activeProjectId,
        runId,
        messageId,
        {
          body,
          mentionedUserIds: input.mentionedUserIds,
        },
      );
      issueMessagesByRun.current = {
        ...issueMessagesByRun.current,
        [runId]: (issueMessagesByRun.current[runId] ?? []).map((candidate) =>
          candidate.id === messageId ? updated : candidate,
        ),
      };
      return updated;
    },
    [activeProjectId, demoMode, token],
  );

  const removeIssueMessage = useCallback(
    async (runId: string, messageId: string) => {
      if (!activeProjectId) throw new Error("삭제할 프로젝트가 없습니다.");
      if (demoMode) {
        const deletedIds = new Set<string>([messageId]);
        const currentMessages = issueMessagesByRun.current[runId] ?? [];
        let changed = true;
        while (changed) {
          changed = false;
          for (const candidate of currentMessages) {
            if (
              candidate.parentMessageId &&
              deletedIds.has(candidate.parentMessageId) &&
              !deletedIds.has(candidate.id)
            ) {
              deletedIds.add(candidate.id);
              changed = true;
            }
          }
        }
        issueMessagesByRun.current = {
          ...issueMessagesByRun.current,
          [runId]: currentMessages.filter(
            (candidate) => !deletedIds.has(candidate.id),
          ),
        };
        return;
      }
      if (!token) throw new Error("메시지를 삭제하려면 로그인이 필요합니다.");
      await deleteIssueMessage(token, activeProjectId, runId, messageId);
      const deletedIds = new Set<string>([messageId]);
      const currentMessages = issueMessagesByRun.current[runId] ?? [];
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of currentMessages) {
          if (
            candidate.parentMessageId &&
            deletedIds.has(candidate.parentMessageId) &&
            !deletedIds.has(candidate.id)
          ) {
            deletedIds.add(candidate.id);
            changed = true;
          }
        }
      }
      issueMessagesByRun.current = {
        ...issueMessagesByRun.current,
        [runId]: currentMessages.filter(
          (candidate) => !deletedIds.has(candidate.id),
        ),
      };
    },
    [activeProjectId, demoMode, token],
  );

  const acceptConversationIssueAction = useCallback(
    async (runId: string, proposal: IssueProposedAction) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("변경할 이슈 처리 작업이 없습니다.");
      }
      if (demoMode) {
        throw new Error("데모에서는 이슈 변경 제안을 수락할 수 없습니다.");
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      const result = proposal.type === "request_issue_rework"
        ? await acceptRemoteIssueReworkProposal(
            token,
            activeProjectId,
            runId,
            proposal.id,
          )
        : await acceptRemoteIssueActionProposal(
            token,
            activeProjectId,
            runId,
            proposal.id,
          );
      const materializedExecutionProposal =
        "executionProposal" in result ? result.executionProposal : null;
      issueMessagesByRun.current = {
        ...issueMessagesByRun.current,
        [runId]: (issueMessagesByRun.current[runId] ?? []).map((message) =>
          message.proposedAction?.id === proposal.id
            ? {
                ...message,
                proposedAction: result.proposal,
                executionProposal:
                  materializedExecutionProposal ??
                  message.executionProposal ??
                  null,
              }
            : message,
        ),
      };
      await refresh("snapshot");
      return result.proposal;
    },
    [activeProjectId, dashboard, demoMode, refresh, token],
  );

  const acceptConversationIssueExecution = useCallback(
    async (
      runId: string,
      proposal: IssueExecutionProposal,
      input: IssueExecutionApprovalInput,
    ) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("실행할 이슈 처리 작업이 없습니다.");
      }
      if (demoMode) {
        throw new Error("데모에서는 이슈 실행을 승인할 수 없습니다.");
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      const result = await acceptRemoteIssueExecutionProposal(
        token,
        activeProjectId,
        runId,
        proposal.id,
        input,
      );
      issueMessagesByRun.current = {
        ...issueMessagesByRun.current,
        [runId]: (issueMessagesByRun.current[runId] ?? []).map((message) =>
          message.executionProposal?.id === proposal.id
            ? { ...message, executionProposal: result.proposal }
            : message,
        ),
      };
      await refresh("snapshot");
      return result.proposal;
    },
    [activeProjectId, dashboard, demoMode, refresh, token],
  );

  const acceptConversationSkillExecution = useCallback(
    async (
      runId: string,
      proposal: AgentSkillExecutionProposal,
      input: AgentSkillExecutionApprovalInput,
    ) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("실행할 프로젝트 Agent Skill이 없습니다.");
      }
      if (demoMode) {
        throw new Error("데모에서는 Agent Skill 실행을 승인할 수 없습니다.");
      }
      if (!token) throw new Error("로그인이 필요합니다.");
      const result = await acceptRemoteIssueSkillExecutionProposal(
        token,
        activeProjectId,
        runId,
        proposal,
        input,
      );
      if (result.session) adoptRemoteAgentSession?.(result.session);
      issueMessagesByRun.current = {
        ...issueMessagesByRun.current,
        [runId]: (issueMessagesByRun.current[runId] ?? []).map((message) =>
          message.skillExecutionProposal?.id === proposal.id
            ? { ...message, skillExecutionProposal: result.proposal }
            : message,
        ),
      };
      await refresh("snapshot");
      return result.proposal;
    },
    [
      activeProjectId,
      adoptRemoteAgentSession,
      dashboard,
      demoMode,
      refresh,
      token,
    ],
  );

  const recoverRun = useCallback(
    async (runId: string, action: "retry" | "cancel") => {
      if (!activeProjectId || !dashboard) {
        throw new Error("복구할 이슈 처리 작업이 없습니다.");
      }
      setRecoveringRunId(runId);
      setRecoveryError(null);
      try {
        if (demoMode) {
          const occurredAt = new Date().toISOString();
          setDashboard((current) =>
            current
              ? {
                  ...current,
                  runs: current.runs.map((run) => {
                    if (run.id !== runId) return run;
                    const attempt =
                      action === "retry"
                        ? run.currentAttempt + 1
                        : run.currentAttempt;
                    const status = action === "retry" ? "queued" : "cancelled";
                    const detail =
                      action === "retry"
                        ? `이슈 처리 ${attempt}차 시도를 요청했습니다.`
                        : "사용자가 이슈 처리 작업을 취소했습니다.";
                    const nextEvent: HuntEvent = {
                      id: crypto.randomUUID(),
                      attempt,
                      revision: action === "retry" ? 1 : run.currentRevision,
                      status,
                      workflowStage: action === "retry" ? null : run.workflowStage,
                      detail,
                      actor: "briar-app",
                      qaStatus: null,
                      trackerState: run.tracker?.state ?? null,
                      pullRequestUrls: [],
                      targetSha: null,
                      occurredAt,
                      recordedAt: occurredAt,
                    };
                    runEventsByRun.current[run.id] = [
                      nextEvent,
                      ...(runEventsByRun.current[run.id] ?? []),
                    ];
                    return {
                      ...run,
                      currentAttempt: attempt,
                      currentRevision:
                        action === "retry" ? 1 : run.currentRevision,
                      status,
                      workflowStage:
                        action === "retry" ? null : run.workflowStage,
                      progress: action === "retry" ? 5 : run.progress,
                      detail,
                      branch: action === "retry" ? null : run.branch,
                      commitSha: action === "retry" ? null : run.commitSha,
                      claimedBy: null,
                      claimedAt: null,
                      leaseExpiresAt: null,
                      completedAt: action === "cancel" ? occurredAt : null,
                      updatedAt: occurredAt,
                      lastEventAt: occurredAt,
                      eventCount: run.eventCount + 1,
                    };
                  }),
                }
              : current,
          );
          return;
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        if (action === "retry") {
          await retryHuntRun(token, activeProjectId, runId);
        } else {
          await cancelHuntRun(token, activeProjectId, runId);
        }
        await refresh("snapshot");
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setRecoveryError(message);
        throw caught;
      } finally {
        setRecoveringRunId(null);
      }
    },
    [activeProjectId, dashboard, refresh, token],
  );

  const resumeRun = useCallback(
    async (runId: string) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("재개할 이슈 처리 작업이 없습니다.");
      }
      setRecoveringRunId(runId);
      setRecoveryError(null);
      try {
        if (demoMode) {
          const occurredAt = new Date().toISOString();
          setDashboard((current) =>
            current
              ? {
                  ...current,
                  runs: current.runs.map((run) => {
                    if (run.id !== runId) return run;
                    const currentIndex = run.workflow.stages.findIndex(
                      (stage) => stage.id === run.workflowStage,
                    );
                    const workflowStage =
                      run.workflow.stages[currentIndex + 1]?.id ??
                      run.workflowStage;
                    const status = "running";
                    const nextEvent: HuntEvent = {
                      id: crypto.randomUUID(),
                      attempt: run.currentAttempt,
                      revision: run.currentRevision,
                      status,
                      workflowStage,
                      detail: "사용자가 일시정지된 워크플로우를 재개했습니다.",
                      actor: "briar-app",
                      qaStatus: null,
                      trackerState: run.tracker?.state ?? null,
                      pullRequestUrls: run.pullRequestUrls,
                      targetSha: run.targetSha,
                      occurredAt,
                      recordedAt: occurredAt,
                    };
                    runEventsByRun.current[run.id] = [
                      nextEvent,
                      ...(runEventsByRun.current[run.id] ?? []),
                    ];
                    return {
                      ...run,
                      status,
                      workflowStage,
                      pausedAt: null,
                      progress: progressForAutoHuntRun(
                        status,
                        workflowStage,
                        run.workflow,
                      ),
                      detail: nextEvent.detail,
                      claimedBy: null,
                      claimedAt: null,
                      leaseExpiresAt: null,
                      completedAt: null,
                      updatedAt: occurredAt,
                      lastEventAt: occurredAt,
                      eventCount: run.eventCount + 1,
                    };
                  }),
                }
              : current,
          );
          return;
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        const run = dashboard.runs.find((candidate) => candidate.id === runId);
        const checkpoint = run?.checkpoint;
        if (!checkpoint) {
          throw new Error(
            "이 앱 버전에서는 현재 대기 지점을 안전하게 확인할 수 없습니다. 새로고침하거나 앱을 업데이트해 주세요.",
          );
        }
        const identity = `${runId}:${checkpoint.key}:${checkpoint.attempt}:${checkpoint.revision}`;
        const requestId = resumeRequestIds.current.get(identity) ?? crypto.randomUUID();
        resumeRequestIds.current.set(identity, requestId);
        try {
          await resumeHuntRun(
            token,
            activeProjectId,
            runId,
            {
              key: checkpoint.key,
              attempt: checkpoint.attempt,
              revision: checkpoint.revision,
            },
            requestId,
          );
          resumeRequestIds.current.delete(identity);
        } catch (caught) {
          if (isApiErrorStatus(caught, 409)) {
            resumeRequestIds.current.delete(identity);
            await refresh("snapshot");
            throw new Error(
              "대기 지점이 이미 변경되었습니다. 최신 상태를 다시 불러왔습니다.",
            );
          }
          throw caught;
        }
        await refresh("snapshot");
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setRecoveryError(message);
        throw caught;
      } finally {
        setRecoveringRunId(null);
      }
    },
    [activeProjectId, dashboard, demoMode, refresh, token],
  );

  const reworkRun = useCallback(
    async (
      runId: string,
      input: { workflowStage: string; reason: string },
    ) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("재작업할 이슈 처리 작업이 없습니다.");
      }
      const reason = input.reason.trim();
      if (!reason) throw new Error("수정할 내용을 입력해 주세요.");
      setRecoveringRunId(runId);
      setRecoveryError(null);
      try {
        const run = dashboard.runs.find((candidate) => candidate.id === runId);
        const checkpoint = run?.checkpoint;
        if (!run || !checkpoint) {
          throw new Error(
            "현재 대기 지점을 안전하게 확인할 수 없습니다. 새로고침한 뒤 다시 시도해 주세요.",
          );
        }
        if (demoMode) {
          const occurredAt = new Date().toISOString();
          const nextRevision = run.currentRevision + 1;
          const nextEvent: HuntEvent = {
            id: crypto.randomUUID(),
            attempt: run.currentAttempt,
            revision: nextRevision,
            status: "queued",
            workflowStage: input.workflowStage,
            detail: reason,
            actor: "briar-app",
            qaStatus: null,
            trackerState: run.tracker?.state ?? null,
            pullRequestUrls: run.pullRequestUrls,
            targetSha: null,
            occurredAt,
            recordedAt: occurredAt,
          };
          runEventsByRun.current[run.id] = [
            nextEvent,
            ...(runEventsByRun.current[run.id] ?? []),
          ];
          setDashboard((current) =>
            current
              ? {
                  ...current,
                  runs: current.runs.map((candidate) =>
                    candidate.id === run.id
                      ? {
                          ...candidate,
                          status: "queued",
                          workflowStage: input.workflowStage,
                          currentRevision: nextRevision,
                          pausedAt: null,
                          waitingCheckpoint: null,
                          checkpoint: null,
                          progress: progressForAutoHuntRun(
                            "queued",
                            input.workflowStage,
                            candidate.workflow,
                          ),
                          detail: reason,
                          resultSummary: null,
                          structuredResult: null,
                          commitSha: null,
                          targetSha: null,
                          claimedBy: null,
                          claimedAt: null,
                          leaseExpiresAt: null,
                          updatedAt: occurredAt,
                          lastEventAt: occurredAt,
                          eventCount: candidate.eventCount + 1,
                        }
                      : candidate,
                  ),
                }
              : current,
          );
          return;
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        const identity = [
          runId,
          checkpoint.key,
          checkpoint.attempt,
          checkpoint.revision,
          input.workflowStage,
          reason,
        ].join(":");
        const requestId =
          reworkRequestIds.current.get(identity) ?? crypto.randomUUID();
        reworkRequestIds.current.set(identity, requestId);
        try {
          await reworkPausedHuntRun(
            token,
            activeProjectId,
            runId,
            {
              workflowStage: input.workflowStage,
              reason,
              checkpoint: {
                key: checkpoint.key,
                attempt: checkpoint.attempt,
                revision: checkpoint.revision,
              },
            },
            requestId,
          );
          reworkRequestIds.current.delete(identity);
        } catch (caught) {
          if (isApiErrorStatus(caught, 409)) {
            reworkRequestIds.current.delete(identity);
            await refresh("snapshot");
            throw new Error(
              "대기 지점이 이미 변경되었습니다. 최신 상태를 다시 불러왔습니다.",
            );
          }
          throw caught;
        }
        await refresh("snapshot");
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setRecoveryError(message);
        throw caught;
      } finally {
        setRecoveringRunId(null);
      }
    },
    [activeProjectId, dashboard, demoMode, refresh, token],
  );

  const moveRun = useCallback(
    async (runId: string, placement: HuntRunPlacement) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("이동할 이슈 처리 작업이 없습니다.");
      }
      setRecoveringRunId(runId);
      setRecoveryError(null);
      try {
        if (demoMode) {
          const occurredAt = new Date().toISOString();
          setDashboard((current) =>
            current
              ? {
                  ...current,
                  runs: current.runs.map((run) => {
                    if (run.id !== runId) return run;
                    const workflowStage =
                      placement.status === "backlog" ||
                      placement.status === "queued"
                        ? null
                        : placement.status === "running"
                          ? placement.workflowStage
                          : run.workflowStage;
                    const currentAttempt =
                      placement.status === "queued"
                        ? run.currentAttempt + 1
                        : run.currentAttempt;
                    const currentStageIndex = run.workflow.stages.findIndex(
                      (stage) => stage.id === run.workflowStage,
                    );
                    const targetStageIndex = run.workflow.stages.findIndex(
                      (stage) => stage.id === workflowStage,
                    );
                    const isRegression =
                      placement.status === "running" &&
                      currentStageIndex >= 0 &&
                      targetStageIndex >= 0 &&
                      targetStageIndex < currentStageIndex;
                    const currentRevision =
                      placement.status === "queued"
                        ? 1
                        : isRegression
                          ? run.currentRevision + 1
                          : run.currentRevision;
                    const targetLabel =
                      placement.status === "running"
                        ? run.workflow.stages.find(
                            (stage) => stage.id === workflowStage,
                          )?.label
                        : {
                            backlog: "백로그",
                            queued: "대기",
                            blocked: "차단",
                            failed: "실패",
                            completed: "완료",
                            cancelled: "취소",
                          }[placement.status];
                    const detail = `사용자가 작업을 ${targetLabel ?? placement.status} 상태로 이동했습니다.`;
                    const nextEvent: HuntEvent = {
                      id: crypto.randomUUID(),
                      attempt: currentAttempt,
                      revision: currentRevision,
                      status: placement.status,
                      workflowStage,
                      detail,
                      actor: "briar-app",
                      qaStatus: null,
                      trackerState: run.tracker?.state ?? null,
                      pullRequestUrls: run.pullRequestUrls,
                      targetSha: run.targetSha,
                      occurredAt,
                      recordedAt: occurredAt,
                    };
                    runEventsByRun.current[run.id] = [
                      nextEvent,
                      ...(runEventsByRun.current[run.id] ?? []),
                    ];
                    return {
                      ...run,
                      currentAttempt,
                      currentRevision,
                      status: placement.status,
                      workflowStage,
                      progress: progressForAutoHuntRun(
                        placement.status,
                        workflowStage,
                        run.workflow,
                      ),
                      detail,
                      commitSha: isRegression ? null : run.commitSha,
                      targetSha: isRegression ? null : run.targetSha,
                      resultSummary: isRegression ? null : run.resultSummary,
                      claimedBy: null,
                      claimedAt: null,
                      leaseExpiresAt: null,
                      completedAt: ["completed", "cancelled"].includes(
                        placement.status,
                      )
                        ? occurredAt
                        : null,
                      updatedAt: occurredAt,
                      lastEventAt: occurredAt,
                      eventCount: run.eventCount + 1,
                    };
                  }),
                }
              : current,
          );
          return;
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        await moveHuntRun(token, activeProjectId, runId, placement);
        await refresh("snapshot");
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setRecoveryError(message);
        throw caught;
      } finally {
        setRecoveringRunId(null);
      }
    },
    [activeProjectId, dashboard, refresh, token],
  );

  return {
    acceptInvitation,
    activeOrganizationId,
    activeProjectId,
    addOrganization,
    addIssue,
    addPlanningProject,
    moveIssueProject,
    addProject,
    cancelProjectCreation,
    cancelLogin,
    changeOrganizationLogo,
    changeProjectIcon,
    changeProjectIssueKeyPrefix,
    changeProjectScheduleTab,
    checkOrganizationHandle,
    connectProject,
    connectedProjectIds,
    activeProjectConnectionState: localProjectConnectionState(
      connectedProjectIds,
      activeProjectId,
    ),
    dashboard,
    deleteAccount,
    deleteIssue: removeIssue,
    transferIssue: transferIssueToProject,
    deleteProject: removeProject,
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
    finishProjectCreation,
    isCreatingProject,
    isCreatingIssue,
    updatingIssueId,
    loading,
    login,
    loginCode,
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
    unassignRun: (projectId: string, runId: string) => {
      if (!token) return Promise.reject(new Error("로그인이 필요합니다."));
      return unassignHuntRun(token, projectId, runId).then(() => refresh());
    },
    moveRun,
    startProjectCreation,
    token,
    user,
    velen,
  };
}
