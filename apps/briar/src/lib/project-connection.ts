import { briarApiUrl } from "./api";
import {
  canonicalizeProjectWorkflow,
  isRepositoryWorkflowPending,
  type AutoHuntWorkflow,
} from "./auto-hunt-contract";
import { commands } from "../generated/tauri";

export type LocalAutoHuntConfig = {
  velenOrg: string | null;
  dataSource?: string | null;
  linearEnabled: boolean;
  linearSource?: string | null;
  linearTeam?: string | null;
  githubRepository?: string | null;
  workflow: AutoHuntWorkflow;
};

export async function preflightThenCreateProject<T>(
  preflight: () => Promise<T>,
  create?: () => Promise<unknown>,
  assertCurrent: () => void = () => undefined,
) {
  const prepared = await preflight();
  assertCurrent();
  await create?.();
  assertCurrent();
  return prepared;
}

export async function resolveProjectConnectionWorkflow(
  role: "owner" | "admin" | "member" | undefined,
  existingWorkflow: AutoHuntWorkflow | undefined,
  generateWorkflow: () => Promise<AutoHuntWorkflow>,
  compatiblePreset?: AutoHuntWorkflow,
) {
  if (
    existingWorkflow &&
    !isRepositoryWorkflowPending(existingWorkflow)
  ) {
    return {
      workflow: canonicalizeProjectWorkflow(existingWorkflow),
      shouldPersistProjectSettings: false,
    };
  }
  if (role === "member") {
    throw new Error(
      "An organization owner or admin must generate the project workflow before members can connect a repository.",
    );
  }
  if (
    compatiblePreset &&
    !isRepositoryWorkflowPending(compatiblePreset)
  ) {
    return {
      workflow: canonicalizeProjectWorkflow(compatiblePreset),
      shouldPersistProjectSettings: true,
    };
  }
  return {
    workflow: canonicalizeProjectWorkflow(await generateWorkflow()),
    shouldPersistProjectSettings: true,
  };
}

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function loadConnectedProjectIds(): Promise<string[] | null> {
  if (!isTauri()) return null;
  return commands.connectedProjectIds();
}

export async function pickGitRepository(): Promise<string | null> {
  if (!isTauri()) {
    throw new Error("저장소 선택은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Briar에 연결할 Git 저장소 선택",
  });
  if (!selected) return null;
  return commands.validateRepositoryPath(selected);
}

export async function createProjectWorkspace(name: string) {
  if (!isTauri()) {
    throw new Error("새 프로젝트 폴더 만들기는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.createProjectWorkspace(name);
}

export async function cloneGithubSshRepository(repositoryUrl: string) {
  if (!isTauri()) {
    throw new Error("GitHub 저장소 가져오기는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.cloneGithubSshRepository(repositoryUrl);
}

export async function inspectRepositoryReadiness(
  repositoryPath: string,
  workflow: AutoHuntWorkflow,
) {
  if (!isTauri()) {
    throw new Error("Git 저장소 검사는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.inspectRepositoryReadiness(repositoryPath, workflow);
}

export async function inspectLovableRepositoryCompatibility(
  repositoryPath: string,
) {
  if (!isTauri()) {
    throw new Error("Lovable 저장소 검사는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.inspectLovableRepositoryCompatibility(repositoryPath);
}

export async function discoverRepositoryIcon(
  repositoryPath: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  return commands.discoverRepositoryIcon(repositoryPath);
}

export async function loadProjectRepositoryReadiness(projectId: string) {
  if (!isTauri()) return null;
  return commands.projectRepositoryReadiness(projectId);
}

export async function installProjectGithubCli(projectId: string) {
  if (!isTauri()) {
    throw new Error("GitHub CLI 설치는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.installProjectGithubCli(projectId);
}

export async function loginProjectGithub(projectId: string) {
  if (!isTauri()) {
    throw new Error("GitHub 로그인은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.loginProjectGithub(projectId);
}

export async function preflightLocalProjectConnection(input: {
  repositoryPath: string;
  autoHunt: LocalAutoHuntConfig;
}) {
  if (!isTauri()) {
    throw new Error("프로젝트 연결 검사는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.preflightLocalProjectConnection(
    input.repositoryPath,
    input.autoHunt,
  );
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
  const connected = await commands.connectLocalProject(
    briarApiUrl,
    input.projectId,
    input.agentToken,
    input.repositoryPath,
    input.autoHunt,
  );
  return {
    ...connected,
    workflow: canonicalizeProjectWorkflow(connected.workflow),
  };
}

export async function configureLocalExecutionWorker(
  projectId: string,
  userToken: string,
  enabled: boolean,
) {
  if (!isTauri()) {
    throw new Error("Worker 설정은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  try {
    return await commands.configureExecutionWorker(projectId, userToken, enabled);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const cleanupIncompletePrefix = "BRIAR_WORKER_CLEANUP_INCOMPLETE: ";
    if (message.startsWith(cleanupIncompletePrefix)) {
      throw new Error(message.slice(cleanupIncompletePrefix.length));
    }
    throw caught;
  }
}

export async function disconnectLocalProject(projectId: string) {
  if (!isTauri()) return;
  await commands.disconnectLocalProject(projectId);
}

export async function updateLocalProjectWorkflow(
  projectId: string,
  workflow: AutoHuntWorkflow,
) {
  if (!isTauri()) {
    throw new Error("워크플로우 갱신은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return canonicalizeProjectWorkflow(
    await commands.updateLocalProjectWorkflow(projectId, workflow),
  );
}

export async function updateLocalProjectVelenOrg(
  projectId: string,
  org: string | null,
) {
  if (!isTauri()) {
    throw new Error("Velen 연결 갱신은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.updateLocalProjectVelenOrg(projectId, org);
}

export async function inspectVelen(org?: string | null) {
  if (!isTauri()) {
    throw new Error("Velen 설정은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.inspectVelen(org || null);
}

export async function loadAutoHuntHealth(projectId: string) {
  if (!isTauri()) return null;
  return commands.autoHuntHealth(projectId);
}

export async function repairAutoHunt(projectId: string) {
  if (!isTauri()) {
    throw new Error("복구 설치는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.repairAutoHunt(projectId);
}
