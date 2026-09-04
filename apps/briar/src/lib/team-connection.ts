import { briarApiUrl } from "./api";
import {
  canonicalizeProjectWorkflow,
  isRepositoryWorkflowPending,
  type AutoHuntWorkflow,
} from "./auto-hunt-contract";
import {
  commands,
  type AgentProviderKind,
  type PreparedProjectRepository,
} from "../generated/tauri";
import type { OrganizationRole, ProjectSettings } from "../types";
import type { ProjectGithubCredential } from "./api";
import { hasOrganizationCapability } from "./organization-role";

export type LocalAutoHuntConfig = {
  velenOrg: string | null;
  dataSource?: string | null;
  linearEnabled: boolean;
  linearSource?: string | null;
  linearTeam?: string | null;
  githubRepository?: string | null;
  githubRepositoryId?: number | null;
  workflow: AutoHuntWorkflow;
};

export async function prepareConfiguredTeamRepository(
  settings: Pick<ProjectSettings, "githubRepository" | "githubRepositoryId">,
  createCredential: () => Promise<ProjectGithubCredential>,
  prepareRepository: (
    credential: ProjectGithubCredential,
  ) => Promise<PreparedProjectRepository>,
) {
  if (!settings.githubRepository || settings.githubRepositoryId === null) {
    throw new Error(
      "조직의 GitHub App에서 프로젝트 저장소를 먼저 선택해 주세요.",
    );
  }

  const credential = await createCredential();
  if (
    credential.repository.id !== settings.githubRepositoryId ||
    credential.repository.fullName.toLowerCase() !==
      settings.githubRepository.toLowerCase()
  ) {
    throw new Error("GitHub 자격 증명이 프로젝트 저장소와 일치하지 않습니다.");
  }
  const prepared = await prepareRepository(credential);
  if (
    prepared.repositoryId !== credential.repository.id ||
    prepared.repository.toLowerCase() !==
      credential.repository.fullName.toLowerCase()
  ) {
    throw new Error("준비한 저장소가 프로젝트의 GitHub 저장소와 일치하지 않습니다.");
  }

  return { credential, prepared };
}
export async function preflightThenCreateTeam<T>(
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

export async function resolveTeamConnectionWorkflow(
  role: OrganizationRole | undefined,
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
      shouldPersistTeamSettings: false,
    };
  }
  if (!hasOrganizationCapability(role, "development:manage")) {
    throw new Error(
      "An organization owner, co-owner, or developer must generate the project workflow before connecting a repository.",
    );
  }
  if (
    compatiblePreset &&
    !isRepositoryWorkflowPending(compatiblePreset)
  ) {
    return {
      workflow: canonicalizeProjectWorkflow(compatiblePreset),
      shouldPersistTeamSettings: true,
    };
  }
  return {
    workflow: canonicalizeProjectWorkflow(await generateWorkflow()),
    shouldPersistTeamSettings: true,
  };
}

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function loadConnectedTeamIds(): Promise<string[] | null> {
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

export async function createTeamWorkspace(name: string) {
  if (!isTauri()) {
    throw new Error("새 프로젝트 폴더 만들기는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.createProjectWorkspace(name);
}

export async function prepareTeamRepository(
  projectId: string,
  credential: ProjectGithubCredential,
) {
  if (!isTauri()) {
    throw new Error("이 컴퓨터에서 작업 시작은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return commands.prepareProjectRepository(projectId, credential);
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

export async function loadTeamRepositoryReadiness(projectId: string) {
  if (!isTauri()) return null;
  return commands.projectRepositoryReadiness(projectId);
}

export async function preflightLocalTeamConnection(input: {
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

export async function connectLocalTeam(input: {
  projectId: string;
  agentToken: string;
  repositoryPath: string;
  autoHunt: LocalAutoHuntConfig;
  /** Agent backend the user picked; the native layer resolves one when absent. */
  provider?: AgentProviderKind | null;
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
    input.provider ?? null,
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

export async function disconnectLocalTeam(projectId: string) {
  if (!isTauri()) return;
  await commands.disconnectLocalProject(projectId);
}

export async function updateLocalTeamWorkflow(
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

export async function updateLocalTeamVelenOrg(
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
