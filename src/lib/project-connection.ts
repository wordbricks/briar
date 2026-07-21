import { briarApiUrl } from "./api";

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

export type LocalAutoHuntConfig = {
  velenOrg: string;
  dataSource?: string | null;
  linearEnabled: boolean;
  linearSource?: string | null;
  linearTeam?: string | null;
  githubRepository?: string | null;
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
  return invoke<string>("connect_local_project", {
    apiUrl: briarApiUrl,
    projectId: input.projectId,
    agentToken: input.agentToken,
    repositoryPath: input.repositoryPath,
    autoHunt: input.autoHunt,
  });
}

export async function inspectVelen(org?: string | null) {
  if (!isTauri()) {
    throw new Error("Velen 설정은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<VelenInspection>("inspect_velen", { org: org || null });
}
