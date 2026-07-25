import { briarApiUrl } from "./api";
import type { AutoHuntWorkflow } from "./auto-hunt-contract";
import type { ProjectSettings } from "../types";

export type VelenOrganization = { name: string; slug: string };
export type VelenSource = {
  sourceKey: string;
  sourceRef: string;
  provider: string;
  status: string;
};
export type VelenInspection = {
  authenticated: boolean;
  email: string | null;
  currentOrg: string | null;
  organizations: VelenOrganization[];
  sources: VelenSource[];
};

export type AutoHuntHealth = {
  projectId: string;
  healthy: boolean;
  repositoryPath: string | null;
  repositoryRemote: string | null;
  repositoryHealthy: boolean;
  cliPath: string;
  cliInstalled: boolean;
  cliVersion: string | null;
  cliExpectedVersion: string;
  cliCurrent: boolean;
  skillPath: string;
  skillInstalled: boolean;
  skillVersion: string | null;
  skillExpectedVersion: string;
  skillCurrent: boolean;
  velenOrg: string | null;
  velenAuthenticated: boolean;
  velenEmail: string | null;
  velenHealthy: boolean;
  issues: string[];
};

export type RepositoryReadiness = {
  repositoryPath: string;
  gitInstalled: boolean;
  gitVersion: string | null;
  repositoryHealthy: boolean;
  remote: string | null;
  remoteReachable: boolean;
  pushAccess: boolean;
  requiresGithub: boolean;
  githubRepository: string | null;
  ghInstalled: boolean;
  ghVersion: string | null;
  ghAuthenticated: boolean;
  ghAccount: string | null;
  githubWriteAccess: boolean;
  gitReady: boolean;
  prReady: boolean;
  issues: string[];
};

export type LocalAutoHuntConfig = {
  velenOrg: string;
  dataSource?: string | null;
  linearEnabled: boolean;
  linearSource?: string | null;
  linearTeam?: string | null;
  githubRepository?: string | null;
  workflow: AutoHuntWorkflow;
};

export type ConnectedLocalProject = {
  repositoryPath: string;
  workflow: AutoHuntWorkflow;
};

export type ExecutionHost = {
  id: string;
  label: string;
  kind: "local" | "ssh";
  alias?: string;
  hostname?: string;
  username?: string;
  port?: number;
};

export type ResolvedSshHost = {
  alias: string;
  hostname: string;
  username?: string;
  port?: number;
};

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function loadConnectedProjectIds(): Promise<string[] | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("connected_project_ids");
}

export async function pickGitRepository(): Promise<string | null> {
  if (!isTauri()) {
    throw new Error("저장소 선택은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const [{ open }, { invoke }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
  ]);
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Briar에 연결할 Git 저장소 선택",
  });
  if (!selected) return null;
  return invoke<string>("validate_repository_path", { path: selected });
}

export async function inspectRepositoryReadiness(
  repositoryPath: string,
  workflow: AutoHuntWorkflow,
  executionHostId = "local",
) {
  if (!isTauri()) {
    throw new Error("Git 저장소 검사는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RepositoryReadiness>("inspect_repository_readiness", {
    repositoryPath,
    workflow,
    executionHostId,
  });
}

export async function listExecutionHosts(): Promise<ExecutionHost[]> {
  if (!isTauri()) {
    return [{ id: "local", label: "이 컴퓨터", kind: "local" }];
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ExecutionHost[]>("list_execution_hosts");
}

export async function resolveSshHost(alias: string) {
  if (!isTauri()) {
    throw new Error("SSH 호스트 확인은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ResolvedSshHost>("resolve_ssh_host", { alias });
}

export async function addSshHost(alias: string, label?: string) {
  if (!isTauri()) {
    throw new Error("SSH 호스트 추가는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ExecutionHost>("add_ssh_host", {
    alias,
    label: label?.trim() || null,
  });
}

export async function removeSshHost(hostId: string) {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("remove_ssh_host", { hostId });
}

export async function loadProjectRepositoryReadiness(projectId: string) {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RepositoryReadiness>("project_repository_readiness", {
    projectId,
  });
}

export async function installProjectGithubCli(projectId: string) {
  if (!isTauri()) {
    throw new Error("GitHub CLI 설치는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RepositoryReadiness>("install_project_github_cli", {
    projectId,
  });
}

export async function loginProjectGithub(projectId: string) {
  if (!isTauri()) {
    throw new Error("GitHub 로그인은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RepositoryReadiness>("login_project_github", {
    projectId,
  });
}

export async function connectLocalProject(input: {
  projectId: string;
  agentToken: string;
  repositoryPath: string;
  executionHostId?: string;
  autoHunt: LocalAutoHuntConfig;
}) {
  if (!isTauri()) {
    throw new Error("프로젝트 연결은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ConnectedLocalProject>("connect_local_project", {
    apiUrl: briarApiUrl,
    projectId: input.projectId,
    agentToken: input.agentToken,
    repositoryPath: input.repositoryPath,
    executionHostId: input.executionHostId ?? "local",
    autoHunt: input.autoHunt,
  });
}

export async function disconnectLocalProject(projectId: string) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("disconnect_local_project", { projectId });
}

export async function updateLocalProjectWorkflow(
  projectId: string,
  workflow: AutoHuntWorkflow,
) {
  if (!isTauri()) {
    throw new Error("워크플로우 갱신은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AutoHuntWorkflow>("update_local_project_workflow", {
    projectId,
    workflow,
  });
}

export async function updateLocalProjectLinear(
  projectId: string,
  linear: ProjectSettings["linear"],
) {
  if (!isTauri()) {
    throw new Error("Linear 연결 갱신은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProjectSettings["linear"]>("update_local_project_linear", {
    projectId,
    linear,
  });
}

export async function inspectVelen(
  org?: string | null,
  executionHostId = "local",
) {
  if (!isTauri()) {
    throw new Error("Velen 설정은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<VelenInspection>("inspect_velen", {
    org: org || null,
    executionHostId,
  });
}

export async function loadAutoHuntHealth(projectId: string) {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AutoHuntHealth>("auto_hunt_health", { projectId });
}

export async function repairAutoHunt(projectId: string) {
  if (!isTauri()) {
    throw new Error("복구 설치는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AutoHuntHealth>("repair_auto_hunt", { projectId });
}
