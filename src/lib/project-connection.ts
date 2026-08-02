import { briarApiUrl } from "./api";
import {
  isRepositoryWorkflowPending,
  type AutoHuntWorkflow,
} from "./auto-hunt-contract";
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
  requirements?: WorkflowRequirementHealth[];
  issues: string[];
};

export type WorkflowRequirementHealth = {
  id: string;
  label: string;
  kind: NonNullable<AutoHuntWorkflow["requirements"]>[number]["kind"];
  tool: string;
  reason: string;
  healthy: boolean;
  detail: string;
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
  velenOrg: string | null;
  dataSource?: string | null;
  linearEnabled: boolean;
  linearSource?: string | null;
  linearTeam?: string | null;
  githubRepository?: string | null;
  workflow: AutoHuntWorkflow;
};

export type CreatedProjectWorkspace = {
  repositoryPath: string;
  created: boolean;
};

export type ConnectedLocalProject = {
  repositoryPath: string;
  workflow: AutoHuntWorkflow;
};

export async function resolveProjectConnectionWorkflow(
  role: "owner" | "admin" | "member" | undefined,
  existingWorkflow: AutoHuntWorkflow | undefined,
  generateWorkflow: () => Promise<AutoHuntWorkflow>,
) {
  if (
    existingWorkflow &&
    !isRepositoryWorkflowPending(existingWorkflow)
  ) {
    return {
      workflow: existingWorkflow,
      shouldPersistProjectSettings: role !== "member",
    };
  }
  if (role === "member") {
    throw new Error(
      "An organization owner or admin must generate the project workflow before members can connect a repository.",
    );
  }
  return {
    workflow: await generateWorkflow(),
    shouldPersistProjectSettings: true,
  };
}

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

export async function projectWorkspaceRoot(): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("project_workspace_root");
}

export async function createProjectWorkspace(
  name: string,
): Promise<CreatedProjectWorkspace> {
  if (!isTauri()) {
    throw new Error("새 프로젝트 폴더 만들기는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CreatedProjectWorkspace>("create_project_workspace", { name });
}

export async function inspectRepositoryReadiness(
  repositoryPath: string,
  workflow: AutoHuntWorkflow,
) {
  if (!isTauri()) {
    throw new Error("Git 저장소 검사는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RepositoryReadiness>("inspect_repository_readiness", {
    repositoryPath,
    workflow,
  });
}

export async function discoverRepositoryIcon(
  repositoryPath: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("discover_repository_icon", {
    repositoryPath,
  });
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

export async function updateLocalProjectVelenOrg(
  projectId: string,
  org: string | null,
) {
  if (!isTauri()) {
    throw new Error("Velen 연결 갱신은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("update_local_project_velen_org", {
    projectId,
    org,
  });
}

export async function inspectVelen(org?: string | null) {
  if (!isTauri()) {
    throw new Error("Velen 설정은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<VelenInspection>("inspect_velen", {
    org: org || null,
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
