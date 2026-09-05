import { homedir } from "node:os";
import {
  basename,
  join,
  resolve,
} from "node:path";
import { create } from "@bufbuild/protobuf";
import {
  type Team as TeamMessage,
  TeamService,
  UpdateTeamSettingsRequestSchema,
} from "@briar/contracts/gen/briar/app/v1/team_pb";
import {
  isRepositoryWorkflowPending,
  repositoryWorkflowPendingStageId,
} from "../src/lib/auto-hunt-contract";
import {
  teamRoleFromProto,
  requiredMessage,
} from "../src/lib/app-rpc/mappers";
import { workflowToProto } from "../src/lib/app-rpc/team-configuration-mappers";
import {
  projectWorktreeRoot,
  resolveBaseRef,
} from "./worktree";
import {
  type Config,
  type TeamConfig,
} from "./config-contract";
import { decodeVelenEnvelope } from "./command-contract";
import {
  args,
  value,
  has,
  required,
  loadConfig,
  saveConfig,
  login,
  gitValue,
  currentRepositoryPath,
  runGit,
  worktreeSettings,
  worktreesEnabled,
  currentProject,
} from "./command-support";
import {
  fetchProjects,
  isUnauthenticatedConnectError,
} from "./app-connect-client";
import { createAuthenticatedConnectClient } from "./connect-client";
import {
  configWithRemoteTeamSettings,
  type FetchRemoteTeamSettings,
  fetchRemoteTeamSettings,
  projectWithRemoteSettings,
  remoteWorkflowState,
} from "./team-settings-sync";

export type TeamListDependencies = {
  loadAuthentication: () => Promise<{
    apiUrl: string;
    userToken?: string;
  }>;
  environmentToken: () => string | undefined;
  fetchTeams: (
    apiUrl: string,
    userToken: string,
  ) => Promise<TeamMessage[]>;
  jsonOutput: () => boolean;
  writeOutput: (output: string) => void;
};

const defaultTeamListDependencies: TeamListDependencies = {
  loadAuthentication: loadConfig,
  environmentToken: () => process.env.BRIAR_USER_TOKEN,
  fetchTeams: fetchProjects,
  jsonOutput: () => has("--json"),
  writeOutput: console.log,
};

async function listTeamsCommand(
  dependencies: Partial<TeamListDependencies> = {},
) {
  const resolved = { ...defaultTeamListDependencies, ...dependencies };
  const authentication = await resolved.loadAuthentication();
  const userToken =
    resolved.environmentToken()?.trim() || authentication.userToken?.trim();
  if (!userToken) {
    throw new Error(
      "Briar에 로그인되어 있지 않습니다. `briar login`을 실행하세요.",
    );
  }

  let response: TeamMessage[];
  try {
    response = await resolved.fetchTeams(authentication.apiUrl, userToken);
  } catch (error) {
    if (isUnauthenticatedConnectError(error)) {
      throw new Error(
        "Briar 로그인이 만료되었거나 유효하지 않습니다. `briar login`을 다시 실행하세요.",
      );
    }
    throw error;
  }

  const teams = response.map((team) => ({
    id: team.id,
    name: team.name,
    organizationId: team.organizationId,
    organizationName: team.organizationName,
    role: teamRoleFromProto(team.role),
  }));
  if (resolved.jsonOutput()) {
    resolved.writeOutput(JSON.stringify({ teams }, null, 2));
    return;
  }
  if (teams.length === 0) {
    resolved.writeOutput("접근 가능한 Briar 팀이 없습니다.");
    return;
  }
  resolved.writeOutput(
    teams.map((team) =>
      [
        team.name,
        `  Team ID: ${team.id}`,
        `  Organization: ${team.organizationName} (${team.organizationId})`,
        `  Role: ${team.role}`,
      ].join("\n")
    ).join("\n\n"),
  );
}

async function createTeam() {
  const config = await loadConfig();
  if (!config.userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const repositoryPath = await currentRepositoryPath();
  const name = value("--name") ?? basename(repositoryPath);
  const result = await createAuthenticatedConnectClient(
    TeamService,
    config.apiUrl,
    config.userToken,
  ).createTeam({ name });
  const createdTeam = requiredMessage(result.team, "createTeam.team");
  config.teams = [
    ...config.teams.filter((project) => project.id !== createdTeam.id),
    {
      id: createdTeam.id,
      repositoryPath,
      repositoryRemote: gitValue(["remote", "get-url", "origin"]) ?? undefined,
      agentToken: result.agentToken,
      apiUrl: config.apiUrl,
    },
  ];
  await saveConfig(config);
  console.log(`팀 ${createdTeam.name}을 연결했습니다.`);
  console.log(`Team ID: ${createdTeam.id}`);
}

async function connectTeam() {
  const config = await loadConfig();
  const teamId = required("--team-id");
  const agentToken = required("--agent-token");
  const repositoryPath = await currentRepositoryPath();
  config.teams = [
    ...config.teams.filter((project) => project.id !== teamId),
    {
      id: teamId,
      repositoryPath,
      repositoryRemote: gitValue(["remote", "get-url", "origin"]) ?? undefined,
      agentToken,
      apiUrl: config.apiUrl,
    },
  ];
  await saveConfig(config);
  console.log(`${repositoryPath}를 Briar 팀 ${teamId}에 연결했습니다.`);
  console.log("저장소 경로와 Agent 토큰은 이 컴퓨터에만 저장됩니다.");
}

const velenExecutable = () =>
  Bun.which("velen") ?? join(homedir(), ".local", "bin", "velen");

function runVelen(commandArgs: string[]) {
  const result = Bun.spawnSync([
    velenExecutable(),
    "--output",
    "json",
    ...commandArgs,
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const message = result.stderr.toString().trim() || result.stdout.toString().trim();
    throw new Error(`Velen CLI 확인 실패: ${message || `exit ${result.exitCode}`}`);
  }
  return decodeVelenEnvelope(JSON.parse(result.stdout.toString()));
}

function ensureConfiguredVelen(project?: TeamConfig) {
  const configuredOrg = project?.autoHunt?.velenOrg;
  const linearEnabled = project?.autoHunt?.linear?.enabled ?? false;
  if (!configuredOrg) {
    if (linearEnabled) {
      throw new Error("Linear 연동에는 Velen 조직과 Linear source가 필요합니다.");
    }
    if (project?.autoHunt?.dataSource) {
      throw new Error("Velen data source를 사용하려면 Velen 조직을 설정하세요.");
    }
    return null;
  }
  if (!Bun.file(velenExecutable()).size) {
    throw new Error(
      "이 팀에 설정된 Velen CLI 기능을 사용하려면 `bun install -g @wordbricks/velen`으로 CLI를 설치하세요.",
    );
  }
  const auth = runVelen(["auth", "whoami"]);
  const org = runVelen(["--org", configuredOrg, "org", "current"]);
  const linearSource = linearEnabled
    ? project?.autoHunt?.linear?.source
    : undefined;
  if (linearEnabled && !linearSource) {
    throw new Error("Linear 연동이 켜져 있지만 Velen Linear source가 없습니다.");
  }
  const linear = linearSource
    ? runVelen(["--org", configuredOrg!, "source", "show", linearSource])
    : null;
  return { auth, org, linear };
}

function configuredWorkflow(project: TeamConfig) {
  const workflow = project.autoHunt?.workflow;
  if (
    !workflow ||
    workflow.stages.some((stage) => stage.id === repositoryWorkflowPendingStageId)
  ) {
    throw new Error(
      "저장소 기반 워크플로우가 아직 생성되지 않았습니다. Briar 앱에서 이 저장소 연결을 완료하세요.",
    );
  }
  return workflow;
}

async function configureTeam() {
  const allowedOptions = new Set([
    "--velen-org",
    "--disable-velen",
    "--data-source",
    "--enable-linear",
    "--linear-source",
    "--linear-team",
    "--disable-linear",
    "--enable-worktrees",
    "--disable-worktrees",
    "--worktree-root",
    "--branch-prefix",
    "--enable-full-access",
    "--disable-full-access",
    "--i-understand-the-risk",
    "--github-repository",
  ]);
  const unknownOption = args.slice(2).find(
    (argument) => argument.startsWith("--") && !allowedOptions.has(argument),
  );
  if (unknownOption) throw new Error(`알 수 없는 옵션입니다: ${unknownOption}`);
  const config = await loadConfig();
  const project = await currentProject(config);
  const disableVelen = has("--disable-velen");
  const requestedVelenOrg = value("--velen-org");
  if (disableVelen && requestedVelenOrg) {
    throw new Error("--velen-org와 --disable-velen을 함께 쓸 수 없습니다.");
  }
  const velenOrg = disableVelen
    ? undefined
    : requestedVelenOrg ?? project.autoHunt?.velenOrg;
  const linearDisabled = has("--disable-linear");
  const linearSource = value("--linear-source");
  if (!linearDisabled && !linearSource && has("--enable-linear")) {
    throw new Error("--enable-linear requires --linear-source");
  }
  if (has("--enable-worktrees") && has("--disable-worktrees")) {
    throw new Error("--enable-worktrees와 --disable-worktrees를 함께 쓸 수 없습니다.");
  }
  if (has("--enable-full-access") && has("--disable-full-access")) {
    throw new Error("--enable-full-access와 --disable-full-access를 함께 쓸 수 없습니다.");
  }
  // Explicitly re-enabling the default unrestricted mode still requires a
  // deliberate acknowledgement because Auto Hunt input is untrusted.
  if (has("--enable-full-access") && !has("--i-understand-the-risk")) {
    throw new Error(
      "--enable-full-access는 샌드박스를 완전히 해제해 에이전트가 파일시스템 전체에 쓸 수 있게 합니다. 확인을 위해 --i-understand-the-risk를 함께 지정하세요.",
    );
  }
  const nextAutoHunt = {
    ...project.autoHunt,
    velenOrg,
    dataSource: disableVelen
      ? undefined
      : value("--data-source") ?? project.autoHunt?.dataSource,
    githubRepository:
      value("--github-repository") ?? project.autoHunt?.githubRepository,
    linear: linearDisabled || disableVelen
      ? { enabled: false }
      : linearSource
        ? {
            enabled: true,
            source: linearSource,
            teamKey: value("--linear-team") ?? project.autoHunt?.linear?.teamKey,
          }
        : (project.autoHunt?.linear ?? { enabled: false }),
    workflow: configuredWorkflow(project),
    worktrees: {
      ...project.autoHunt?.worktrees,
      ...(has("--disable-worktrees") ? { enabled: false } : {}),
      ...(has("--enable-worktrees") ? { enabled: true } : {}),
      ...(value("--worktree-root") ? { root: resolve(required("--worktree-root")) } : {}),
      ...(value("--branch-prefix") ? { branchPrefix: required("--branch-prefix") } : {}),
    },
    sandbox: {
      ...project.autoHunt?.sandbox,
      ...(has("--enable-full-access") ? { fullAccess: true } : {}),
      ...(has("--disable-full-access") ? { fullAccess: false } : {}),
    },
  };
  const nextProject = {
    ...project,
    repositoryRemote:
      gitValue(["remote", "get-url", "origin"]) ?? project.repositoryRemote,
    autoHunt: nextAutoHunt,
  };
  ensureConfiguredVelen(nextProject);
  config.teams = config.teams.map((candidate) =>
    candidate.id === project.id ? nextProject : candidate,
  );
  await saveConfig(config);

  if (config.userToken) {
    await createAuthenticatedConnectClient(
      TeamService,
      config.apiUrl,
      config.userToken,
    ).updateTeamSettings(
      create(UpdateTeamSettingsRequestSchema, {
        teamId: project.id,
        velenOrg: velenOrg ?? undefined,
        dataSource: nextAutoHunt.dataSource,
        linear: {
          enabled: nextAutoHunt.linear?.enabled ?? false,
          source: nextAutoHunt.linear?.source,
          teamKey: nextAutoHunt.linear?.teamKey,
        },
        githubRepository: nextAutoHunt.githubRepository,
        workflow: workflowToProto(nextAutoHunt.workflow),
      }),
    );
  }
  console.log(
    JSON.stringify({
      teamId: project.id,
      velenOrg: velenOrg ?? null,
      linearEnabled: nextAutoHunt.linear?.enabled ?? false,
      linearSource: nextAutoHunt.linear?.source ?? null,
      fullAccess: nextAutoHunt.sandbox?.fullAccess ?? true,
    }),
  );
}

export type TeamDoctorDependencies = {
  loadConfiguration: () => Promise<Config>;
  selectProject: (config: Config) => Promise<TeamConfig>;
  environmentToken: () => string | undefined;
  fetchTeamSettings: FetchRemoteTeamSettings;
  persistConfig: (config: Config) => Promise<void>;
  inspectVelen: typeof ensureConfiguredVelen;
  resolveTeamBaseRef: (project: TeamConfig) => string | null;
  writeOutput: (output: string) => void;
};

const defaultTeamDoctorDependencies: TeamDoctorDependencies = {
  loadConfiguration: loadConfig,
  selectProject: currentProject,
  environmentToken: () => process.env.BRIAR_USER_TOKEN,
  fetchTeamSettings: fetchRemoteTeamSettings,
  persistConfig: saveConfig,
  inspectVelen: ensureConfiguredVelen,
  resolveTeamBaseRef: (project) =>
    resolveBaseRef(runGit, project.repositoryPath),
  writeOutput: console.log,
};

type TeamDoctorWorkflowSync = {
  status:
    | "local_ready"
    | "refreshed"
    | "server_generation_pending"
    | "local_persistence_failed"
    | "session_unavailable"
    | "api_unavailable"
    | "network_unavailable";
  source: "local" | "server";
  persisted: boolean;
  serverWorkflowState: "ready" | "generation_pending" | null;
  message: string;
};

const unavailableWorkflowSync = (
  error: unknown,
): TeamDoctorWorkflowSync => {
  if (isUnauthenticatedConnectError(error)) {
    return {
      status: "session_unavailable",
      source: "server",
      persisted: false,
      serverWorkflowState: null,
      message: "Briar login session is invalid or expired",
    };
  }
  if (error instanceof TypeError) {
    return {
      status: "network_unavailable",
      source: "server",
      persisted: false,
      serverWorkflowState: null,
      message: "Project settings could not be reached over the network",
    };
  }
  return {
    status: "api_unavailable",
    source: "server",
    persisted: false,
    serverWorkflowState: null,
    message: "Project settings API did not return usable settings",
  };
};

async function teamDoctor(
  dependencies: Partial<TeamDoctorDependencies> = {},
) {
  const resolved = { ...defaultTeamDoctorDependencies, ...dependencies };
  const config = await resolved.loadConfiguration();
  const project = await resolved.selectProject(config);
  let effectiveProject = project;
  let workflow = project.autoHunt?.workflow;
  let workflowSync: TeamDoctorWorkflowSync = {
    status: "local_ready",
    source: "local",
    persisted: true,
    serverWorkflowState: null,
    message: "Local repository workflow is ready",
  };

  if (!workflow || isRepositoryWorkflowPending(workflow)) {
    const userToken = resolved.environmentToken()?.trim() ||
      config.userToken?.trim();
    if (!userToken) {
      workflow = undefined;
      workflowSync = {
        status: "session_unavailable",
        source: "server",
        persisted: false,
        serverWorkflowState: null,
        message: "Briar login session is unavailable",
      };
    } else {
      try {
        const settings = await resolved.fetchTeamSettings(
          config.apiUrl,
          project.id,
          userToken,
        );
        const serverWorkflowState = remoteWorkflowState(settings);
        effectiveProject = projectWithRemoteSettings(project, settings);
        workflow = serverWorkflowState === "ready"
          ? settings.workflow
          : undefined;
        try {
          await resolved.persistConfig(configWithRemoteTeamSettings(
            config,
            project.id,
            settings,
          ));
          workflowSync = serverWorkflowState === "ready"
            ? {
                status: "refreshed",
                source: "server",
                persisted: true,
                serverWorkflowState,
                message: "Repository workflow was refreshed from Briar",
              }
            : {
                status: "server_generation_pending",
                source: "server",
                persisted: true,
                serverWorkflowState,
                message: "Briar is still generating the repository workflow",
              };
        } catch {
          workflowSync = {
            status: "local_persistence_failed",
            source: "server",
            persisted: false,
            serverWorkflowState,
            message: "Remote project settings exist but local config could not be updated",
          };
        }
      } catch (error) {
        workflow = undefined;
        workflowSync = unavailableWorkflowSync(error);
      }
    }
  }

  let velen: ReturnType<typeof ensureConfiguredVelen> = null;
  let velenError: string | null = null;
  try {
    velen = resolved.inspectVelen(effectiveProject);
  } catch (error) {
    velenError = error instanceof Error ? error.message : String(error);
  }
  const result = {
    ok: Boolean(workflow) && workflowSync.status !== "local_persistence_failed",
    teamId: project.id,
    repositoryPath: project.repositoryPath,
    velenOrg: effectiveProject.autoHunt?.velenOrg ?? null,
    linearEnabled: effectiveProject.autoHunt?.linear?.enabled ?? false,
    linearSource: effectiveProject.autoHunt?.linear?.source ?? null,
    dataSource: effectiveProject.autoHunt?.dataSource ?? null,
    githubRepository: effectiveProject.autoHunt?.githubRepository ?? null,
    workflow: workflow ?? null,
    workflowSync,
    worktrees: {
      enabled: worktreesEnabled(effectiveProject),
      root: projectWorktreeRoot(
        worktreeSettings(effectiveProject).root,
        effectiveProject.id,
      ),
      branchPrefix: worktreeSettings(effectiveProject).branchPrefix,
      // null means no origin/HEAD and no main/master: allocation would fail.
      baseRef: resolved.resolveTeamBaseRef(effectiveProject),
    },
    sandbox: {
      // true is the default; false opts into checkout/worktree-confined writes.
      fullAccess: effectiveProject.autoHunt?.sandbox?.fullAccess ?? true,
    },
    velenHealthy: velenError === null,
    velenError,
    requestIds: [velen?.auth.requestId, velen?.org.requestId, velen?.linear?.requestId].filter(
      Boolean,
    ),
  };
  resolved.writeOutput(JSON.stringify(result));
  if (!result.ok) {
    throw new Error(
      `Team doctor could not use the repository workflow: ${workflowSync.status}`,
    );
  }
}

async function showWorkflow() {
  const config = await loadConfig();
  const project = await currentProject(config);
  console.log(
    JSON.stringify({
      teamId: project.id,
      workflow: configuredWorkflow(project),
    }),
  );
}

export {
  listTeamsCommand,
  createTeam,
  connectTeam,
  velenExecutable,
  runVelen,
  ensureConfiguredVelen,
  configuredWorkflow,
  configureTeam,
  teamDoctor,
  showWorkflow,
};
