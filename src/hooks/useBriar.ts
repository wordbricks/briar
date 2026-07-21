import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginDeviceAuthorization,
  createAgentToken,
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
  loadConnectedProjectIds,
  pickGitRepository,
  type LocalAutoHuntConfig,
  type VelenInspection,
} from "../lib/project-connection";
import {
  clearSessionToken,
  readSessionToken,
  writeSessionToken,
} from "../lib/token-store";
import { startDashboardPolling } from "../lib/dashboard-polling";
import type { DashboardPayload, Project, SessionUser } from "../types";

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
  const [velen, setVelen] = useState<VelenInspection | null>(null);
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
  }, [cancelLogin]);

  const addProject = useCallback(
    async (input: { name: string }) => {
      if (!token) throw new Error("로그인이 필요합니다.");
      setLoading(true);
      setError(null);
      try {
        const result = await createProject(token, input);
        setProjects((current) => [...current, result.project]);
        setActiveProjectId(result.project.id);
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
      await refresh();
      return connectedPath;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      throw caught;
    } finally {
      setLoading(false);
    }
  }, [projectConnection, refresh, token]);

  return {
    activeProjectId,
    addProject,
    cancelLogin,
    connectProject,
    dashboard,
    demoMode,
    error,
    loading,
    login,
    loginCode,
    logout,
    projects,
    projectConnection,
    refresh,
    refreshVelen,
    setActiveProjectId,
    token,
    user,
    velen,
  };
}
