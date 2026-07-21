import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginDeviceAuthorization,
  createAgentToken,
  createIssue,
  createProject,
  isApiConfigured,
  loadDashboard,
  loadProjects,
  loadSession,
  pollDeviceToken,
  updateProjectSettings,
} from "../lib/api";
import { demoDashboard } from "../lib/demo-data";
import {
  connectLocalProject,
  inspectVelen,
  loadAutoHuntHealth,
  loadConnectedProjectIds,
  pickGitRepository,
  repairAutoHunt,
  type AutoHuntHealth,
  type LocalAutoHuntConfig,
  type VelenInspection,
} from "../lib/project-connection";
import {
  clearSessionToken,
  readSessionToken,
  writeSessionToken,
} from "../lib/token-store";
import { startDashboardPolling } from "../lib/dashboard-polling";
import type { DashboardPayload, HuntRun, Project, SessionUser } from "../types";

export type ProjectConnection = {
  project: Project;
  agentToken: string | null;
};

const demoMode = import.meta.env.VITE_BRIAR_DEMO !== "false" && !isApiConfigured;
const demoUser: SessionUser = {
  id: "demo-user",
  name: "Jay",
  email: "demo@briar.local",
};

const emptyDashboard = (project: Project): DashboardPayload => ({
  project,
  settings: {
    velenOrg: null,
    dataSource: null,
    linear: { enabled: false, source: null, teamKey: null },
    githubRepository: null,
  },
  runs: [],
  generatedAt: new Date().toISOString(),
});

async function openExternal(url: string) {
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

async function findUnconnectedProject(projects: Project[]) {
  try {
    const connectedIds = await loadConnectedProjectIds();
    if (!connectedIds) return null;
    const connected = new Set(connectedIds);
    return projects.find((project) => !connected.has(project.id)) ?? null;
  } catch {
    return projects[0] ?? null;
  }
}

export function useBriar() {
  const [user, setUser] = useState<SessionUser | null>(demoMode ? demoUser : null);
  const [token, setToken] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>(
    demoMode ? [demoDashboard.project] : [],
  );
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    demoMode ? demoDashboard.project.id : null,
  );
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(
    demoMode ? demoDashboard : null,
  );
  const [loading, setLoading] = useState(!demoMode);
  const [loginCode, setLoginCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectConnection, setProjectConnection] =
    useState<ProjectConnection | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isCreatingIssue, setIsCreatingIssue] = useState(false);
  const [velen, setVelen] = useState<VelenInspection | null>(null);
  const [health, setHealth] = useState<AutoHuntHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const loginAttempt = useRef(0);

  const clearLoginTimer = useCallback(() => {
    if (pollTimer.current === null) return;
    window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const cancelLogin = useCallback(() => {
    loginAttempt.current += 1;
    clearLoginTimer();
    setLoginCode(null);
    setLoading(false);
    setError(null);
  }, [clearLoginTimer]);

  const refresh = useCallback(async () => {
    if (demoMode || !token || !activeProjectId) return;
    try {
      const next = await loadDashboard(token, activeProjectId);
      setDashboard(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [activeProjectId, token]);

  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    void readSessionToken()
      .then(async (storedToken) => {
        if (!storedToken || cancelled) return;
        const [nextUser, nextProjects] = await Promise.all([
          loadSession(storedToken),
          loadProjects(storedToken),
        ]);
        const unconnectedProject = await findUnconnectedProject(nextProjects);
        if (cancelled) return;
        setToken(storedToken);
        setUser(nextUser);
        setProjects(nextProjects);
        setActiveProjectId(nextProjects[0]?.id ?? null);
        setProjectConnection(
          unconnectedProject
            ? { project: unconnectedProject, agentToken: null }
            : null,
        );
      })
      .catch(() => clearSessionToken())
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshVelen = useCallback(async (org?: string | null) => {
    if (demoMode) return null;
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
    if (!projectConnection || demoMode) return;
    void refreshVelen();
  }, [projectConnection, refreshVelen]);

  useEffect(() => {
    if (demoMode || !token || !activeProjectId) return;
    return startDashboardPolling(() => void refresh());
  }, [activeProjectId, refresh, token]);

  const refreshHealth = useCallback(async () => {
    if (demoMode || !activeProjectId) {
      setHealth(null);
      setHealthError(null);
      return null;
    }
    setHealthLoading(true);
    try {
      const result = await loadAutoHuntHealth(activeProjectId);
      setHealth(result);
      setHealthError(null);
      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setHealth(null);
      setHealthError(message);
      return null;
    } finally {
      setHealthLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const login = useCallback(async () => {
    const attempt = ++loginAttempt.current;
    clearLoginTimer();
    setLoading(true);
    setError(null);
    try {
      const authorization = await beginDeviceAuthorization();
      if (attempt !== loginAttempt.current) return;
      setLoginCode(authorization.userCode);
      await openExternal(authorization.verificationUrl);
      if (attempt !== loginAttempt.current) return;
      let delay = authorization.interval * 1_000;
      const poll = async () => {
        pollTimer.current = null;
        if (attempt !== loginAttempt.current) return;
        try {
          const result = await pollDeviceToken(authorization.deviceCode);
          if (attempt !== loginAttempt.current) return;
          if (result.access_token) {
            const nextToken = result.access_token;
            const [nextUser, nextProjects] = await Promise.all([
              loadSession(nextToken),
              loadProjects(nextToken),
            ]);
            const unconnectedProject = await findUnconnectedProject(nextProjects);
            if (attempt !== loginAttempt.current) return;
            await writeSessionToken(nextToken);
            if (attempt !== loginAttempt.current) {
              await clearSessionToken();
              return;
            }
            setToken(nextToken);
            setUser(nextUser);
            setProjects(nextProjects);
            setActiveProjectId(nextProjects[0]?.id ?? null);
            setProjectConnection(
              unconnectedProject
                ? { project: unconnectedProject, agentToken: null }
                : null,
            );
            setLoginCode(null);
            setLoading(false);
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
        }
      };
      pollTimer.current = window.setTimeout(() => void poll(), delay);
    } catch (caught) {
      if (attempt !== loginAttempt.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoading(false);
    }
  }, [clearLoginTimer]);

  const logout = useCallback(async () => {
    cancelLogin();
    await clearSessionToken();
    setToken(null);
    setUser(null);
    setProjects([]);
    setDashboard(null);
    setActiveProjectId(null);
    setProjectConnection(null);
    setIsCreatingProject(false);
  }, [cancelLogin]);

  const startProjectCreation = useCallback(() => {
    setError(null);
    setIsCreatingProject(true);
  }, []);

  const cancelProjectCreation = useCallback(() => {
    setError(null);
    setIsCreatingProject(false);
    setProjectConnection(null);
  }, []);

  const selectProject = useCallback(
    (projectId: string) => {
      setActiveProjectId(projectId);
      if (!demoMode) return;
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      setDashboard(
        project.id === demoDashboard.project.id
          ? demoDashboard
          : emptyDashboard(project),
      );
      setError(null);
    },
    [projects],
  );

  const addProject = useCallback(
    async (input: { name: string }) => {
      if (demoMode) {
        const project: Project = {
          id: crypto.randomUUID(),
          name: input.name.trim(),
          createdAt: new Date().toISOString(),
        };
        setProjects((current) => [...current, project]);
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
        const result = await createProject(token, input);
        setProjects((current) => [...current, result.project]);
        setActiveProjectId(result.project.id);
        setIsCreatingProject(false);
        setVelen(null);
        setProjectConnection(result);
        return result;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  const connectProject = useCallback(async (autoHunt: LocalAutoHuntConfig) => {
    if (!projectConnection) throw new Error("연결할 프로젝트가 없습니다.");
    if (!token && !projectConnection.agentToken) throw new Error("로그인이 필요합니다.");
    setLoading(true);
    setError(null);
    try {
      const repositoryPath = await pickGitRepository();
      if (!repositoryPath) return null;
      const agentToken =
        projectConnection.agentToken ??
        (await createAgentToken(token!, projectConnection.project.id)).agentToken;
      const connectedPath = await connectLocalProject({
        projectId: projectConnection.project.id,
        agentToken,
        repositoryPath,
        autoHunt,
      });
      if (token) {
        await updateProjectSettings(token, projectConnection.project.id, {
          velenOrg: autoHunt.velenOrg,
          dataSource: autoHunt.dataSource ?? null,
          linear: {
            enabled: autoHunt.linearEnabled,
            source: autoHunt.linearSource ?? null,
            teamKey: autoHunt.linearTeam ?? null,
          },
          githubRepository: autoHunt.githubRepository ?? null,
        });
      }
      setProjectConnection(null);
      setIsCreatingProject(false);
      await refresh();
      await refreshHealth();
      return connectedPath;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      throw caught;
    } finally {
      setLoading(false);
    }
  }, [projectConnection, refresh, refreshHealth, token]);

  const repairHealth = useCallback(async () => {
    if (!activeProjectId) throw new Error("복구할 프로젝트가 없습니다.");
    setHealthLoading(true);
    setHealthError(null);
    try {
      const result = await repairAutoHunt(activeProjectId);
      setHealth(result);
      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setHealthError(message);
      return null;
    } finally {
      setHealthLoading(false);
    }
  }, [activeProjectId]);

  const reconnectProject = useCallback(() => {
    const project = projects.find((candidate) => candidate.id === activeProjectId);
    if (!project) return;
    setError(null);
    setVelen(null);
    setIsCreatingProject(true);
    setProjectConnection({ project, agentToken: null });
  }, [activeProjectId, projects]);

  const addIssue = useCallback(
    async (input: {
      title: string;
      description: string | null;
      priority: number | null;
    }) => {
      if (!activeProjectId || !dashboard) {
        throw new Error("이슈를 추가할 프로젝트가 없습니다.");
      }
      setIsCreatingIssue(true);
      setError(null);
      try {
        if (demoMode) {
          const occurredAt = new Date().toISOString();
          const issueId = crypto.randomUUID();
          const sourceKey = `briar-issue:${issueId}`;
          const run: HuntRun = {
            id: crypto.randomUUID(),
            runNumber:
              Math.max(0, ...dashboard.runs.map((candidate) => candidate.runNumber)) + 1,
            source: "issue",
            sourceKey,
            title: input.title.trim(),
            stage: "queued",
            progress: 10,
            detail: "Briar 앱에서 생성된 이슈가 Auto Hunt 처리를 기다리고 있습니다.",
            priority: input.priority,
            repository:
              dashboard.settings.githubRepository ?? dashboard.project.name,
            branch: null,
            commitSha: null,
            tracker: null,
            issueDescription: input.description,
            resultSummary: null,
            pullRequestUrls: [],
            targetSha: null,
            sourceCreatedAt: occurredAt,
            stagingQaStatus: null,
            productionQaStatus: null,
            stagingQaDetail: null,
            productionQaDetail: null,
            context: { origin: "briar-app", issueId },
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
            claimAttempts: 0,
            startedAt: occurredAt,
            updatedAt: occurredAt,
            completedAt: null,
            events: [
              {
                id: crypto.randomUUID(),
                stage: "queued",
                detail: "Briar 앱에서 생성된 이슈가 Auto Hunt 처리를 기다리고 있습니다.",
                actor: "briar-app",
                qaStatus: null,
                trackerState: null,
                pullRequestUrls: [],
                targetSha: null,
                occurredAt,
                recordedAt: occurredAt,
              },
            ],
          };
          setDashboard((current) =>
            current ? { ...current, runs: [run, ...current.runs] } : current,
          );
          return { runId: run.id, sourceKey, stage: "queued" as const };
        }
        if (!token) throw new Error("로그인이 필요합니다.");
        const result = await createIssue(token, activeProjectId, input);
        const nextDashboard = await loadDashboard(token, activeProjectId);
        setDashboard(nextDashboard);
        return result;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        setIsCreatingIssue(false);
      }
    },
    [activeProjectId, dashboard, token],
  );

  return {
    activeProjectId,
    addIssue,
    addProject,
    cancelProjectCreation,
    cancelLogin,
    connectProject,
    dashboard,
    demoMode,
    error,
    health,
    healthError,
    healthLoading,
    isCreatingProject,
    isCreatingIssue,
    loading,
    login,
    loginCode,
    logout,
    projects,
    projectConnection,
    reconnectProject,
    refresh,
    refreshHealth,
    refreshVelen,
    setActiveProjectId: selectProject,
    repairHealth,
    startProjectCreation,
    token,
    user,
    velen,
  };
}
