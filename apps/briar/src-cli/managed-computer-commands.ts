import { resolve } from "node:path";
import {
  ManagedComputerSetupService,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import {
  agentProviders,
  normalizeAddedProviders,
  type AgentProvider,
} from "../src/lib/agent-provider";
import {
  cliVersion,
  currentProject,
  gitValueAt,
  loadConfig,
  login,
  openCodeUpstreamConfigured,
  saveConfig,
  value,
} from "./command-support";
import {
  addedAgentProviders,
  enabledAgentProviders,
} from "./config-contract";
import { dashboardWorkerFromProto } from "../src/lib/app-rpc/fleet-mappers";
import { requiredMessage } from "../src/lib/app-rpc/mappers";
import {
  configuredManagedComputerCredentialPath,
  loadManagedComputerCredential,
} from "./managed-computer-credential";
import { discoverWorkerProviderCapabilities } from "./provider-capabilities";
import {
  inspectWorkerProviderHealth,
} from "./provider-health";
import {
  configWithRemoteTeamSettings,
  type FetchRemoteTeamSettings,
  fetchRemoteTeamSettings,
  projectWithRemoteSettings,
  remoteWorkflowState,
} from "./team-settings-sync";
import {
  createManagedComputerSetupSession,
  fetchCurrentUser,
  fetchManagedComputer,
  fetchManagedComputerSetupStatus,
} from "./app-connect-client";
import { createAuthenticatedConnectClient } from "./connect-client";
import {
  createWorkerControlClient,
  workerRuntimeToProto,
} from "./worker-control-client";
export { managedComputerWorkerSupervisor } from "./managed-computer-supervisor";

const sameOrigin = (left: string, right: string) => {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
};

const providerFromFlag = (fallback: AgentProvider) => {
  const requested = value("--provider")?.trim();
  if (!requested) return fallback;
  const provider = agentProviders.find((candidate) => candidate === requested);
  if (!provider) {
    throw new Error(`Unsupported agent provider: ${requested}`);
  }
  return provider;
};

const credentialPathFromFlag = () =>
  value("--credential-file")?.trim() ||
  configuredManagedComputerCredentialPath();

async function configForManagedComputer(apiOrigin: string) {
  let config = await loadConfig();
  if (!sameOrigin(config.apiUrl, apiOrigin)) {
    config = { ...config, apiUrl: apiOrigin, userToken: undefined };
    await saveConfig(config);
  } else if (config.apiUrl !== apiOrigin) {
    config = { ...config, apiUrl: apiOrigin };
    await saveConfig(config);
  }
  let userToken = process.env.BRIAR_USER_TOKEN ?? config.userToken;
  if (!userToken) {
    await login(apiOrigin);
    config = await loadConfig();
    userToken = process.env.BRIAR_USER_TOKEN ?? config.userToken;
  }
  if (!userToken) throw new Error("Briar login did not produce a user session");
  return { config, userToken };
}

type ManagedComputerCredential = Awaited<
  ReturnType<typeof loadManagedComputerCredential>
>;

export type ManagedComputerSyncDependencies = {
  credentialPath: () => string;
  loadCredential: (path: string) => Promise<ManagedComputerCredential>;
  loadAuthentication: typeof configForManagedComputer;
  resolveProjectId: (
    config: Awaited<ReturnType<typeof loadConfig>>,
  ) => Promise<string>;
  fetchTeamSettings: FetchRemoteTeamSettings;
  persistConfig: typeof saveConfig;
  writeOutput: (output: string) => void;
};

const defaultManagedComputerSyncDependencies: ManagedComputerSyncDependencies = {
  credentialPath: credentialPathFromFlag,
  loadCredential: loadManagedComputerCredential,
  loadAuthentication: configForManagedComputer,
  resolveProjectId: async (config) =>
    value("--project")?.trim() || (await currentProject(config)).id,
  fetchTeamSettings: fetchRemoteTeamSettings,
  persistConfig: saveConfig,
  writeOutput: console.log,
};

export async function managedComputerSyncCommand(
  dependencies: Partial<ManagedComputerSyncDependencies> = {},
) {
  const resolved = {
    ...defaultManagedComputerSyncDependencies,
    ...dependencies,
  };
  const credential = await resolved.loadCredential(resolved.credentialPath());
  const { config, userToken } = await resolved.loadAuthentication(
    credential.apiOrigin,
  );
  const projectId = await resolved.resolveProjectId(config);
  const project = config.projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    throw new Error(
      `Briar project ${projectId} is not configured on this managed computer`,
    );
  }
  const settings = await resolved.fetchTeamSettings(
    credential.apiOrigin,
    projectId,
    userToken,
  );
  const nextConfig = configWithRemoteTeamSettings(
    config,
    projectId,
    settings,
  );
  await resolved.persistConfig(nextConfig);
  resolved.writeOutput(JSON.stringify({
    projectId,
    githubRepository: settings.githubRepository,
    workflowState: remoteWorkflowState(settings),
    workflowRequirementCount: settings.workflow.requirements.length,
    synced: true,
  }));
}

export async function managedComputerSetupCommand() {
  const credentialFile = credentialPathFromFlag();
  const credential = await loadManagedComputerCredential(credentialFile);
  const requestedComputerId = value("--computer")?.trim();
  if (
    requestedComputerId && requestedComputerId !== credential.managedComputerId
  ) {
    throw new Error("The requested computer does not match this enrolled device");
  }
  const projectId = value("--project")?.trim();
  if (!projectId) throw new Error("--project is required");
  const repositoryInput = value("--repository")?.trim();
  if (!repositoryInput) throw new Error("--repository is required");
  const requestedRepositoryPath = resolve(repositoryInput);
  const repositoryRoot = gitValueAt(
    requestedRepositoryPath,
    ["rev-parse", "--show-toplevel"],
  );
  if (!repositoryRoot) {
    throw new Error("--repository must point to an existing Git repository");
  }
  const repositoryPath = resolve(repositoryRoot);

  const { config, userToken } = await configForManagedComputer(
    credential.apiOrigin,
  );
  const user = await fetchCurrentUser(
    credential.apiOrigin,
    userToken,
  );
  const computer = await fetchManagedComputer(
    credential.apiOrigin,
    userToken,
    credential.organizationId,
    credential.managedComputerId,
  );
  if (computer.requesterUserId !== user.id) {
    throw new Error(
      "Briar must be logged in as the user who owns this managed computer",
    );
  }
  if (computer.deviceId !== credential.deviceId) {
    throw new Error("This managed computer enrollment does not match the API");
  }

  const authoritativeSettings = await fetchRemoteTeamSettings(
    credential.apiOrigin,
    projectId,
    userToken,
  );

  const existingProject = config.projects.find((project) => project.id === projectId);
  const provider = providerFromFlag(existingProject?.llm?.provider ?? "codex");
  // `--provider` names the provider this managed computer runs on, so setup
  // adds it the way the desktop's "Add provider" button would. A headless
  // machine has no add screen; naming the provider is the same gesture.
  config.addedProviders = normalizeAddedProviders([
    ...addedAgentProviders(config),
    provider,
  ]);
  config.agentProviders[provider] = true;
  const providerHealth = await inspectWorkerProviderHealth(
    enabledAgentProviders(config),
    {
      upstreamConfigured: (provider) =>
        openCodeUpstreamConfigured(config, provider),
    },
  );
  const selectedProviderHealth = providerHealth[provider];
  if (!selectedProviderHealth.installed) {
    throw new Error(`${provider} CLI is not installed on this managed computer`);
  }
  if (!selectedProviderHealth.authenticated) {
    throw new Error(`${provider} CLI is not authenticated on this managed computer`);
  }
  if (!selectedProviderHealth.healthy) {
    throw new Error(
      `${provider} CLI is not ready: ${selectedProviderHealth.reason ?? "unknown"}`,
    );
  }
  const providerCapabilities = await discoverWorkerProviderCapabilities(
    enabledAgentProviders(config),
    { refresh: true },
  );
  const requestId = value("--request-id")?.trim() || crypto.randomUUID();
  const setup = await createManagedComputerSetupSession(
    credential.apiOrigin,
    userToken,
    credential.organizationId,
    credential.managedComputerId,
    projectId,
    requestId,
  );
  const setupRpc = createAuthenticatedConnectClient(
    ManagedComputerSetupService,
    credential.apiOrigin,
    credential.credential,
    { binary: true },
  );
  const response = await setupRpc.bindManagedComputerSetup({
    managedComputerId: credential.managedComputerId,
    setupToken: setup.setupToken,
    runtime: workerRuntimeToProto({
      agentProvider: provider,
      providerHealth,
      providerCapabilities,
      versions: { briar: cliVersion },
      worktrees: true,
    }),
  });
  const binding = {
    ...response,
    worker: dashboardWorkerFromProto(
      requiredMessage(response.worker, "managedComputerSetup.worker"),
    ),
  };
  if (
    binding.managedComputerId !== credential.managedComputerId ||
    binding.organizationId !== credential.organizationId ||
    binding.teamId !== projectId ||
    binding.deviceId !== credential.deviceId
  ) {
    throw new Error("Managed computer setup response did not match this device");
  }

  const repositoryRemote = gitValueAt(
    repositoryPath,
    ["remote", "get-url", "origin"],
  ) ?? undefined;
  const project = projectWithRemoteSettings({
    ...existingProject,
    id: projectId,
    repositoryPath,
    repositoryRemote,
    apiUrl: credential.apiOrigin,
    llm: { provider, approvalPolicy: "never" },
    executionWorker: {
      deviceId: credential.deviceId,
      workerId: binding.worker.id,
      organizationId: credential.organizationId,
      label: binding.worker.label,
      maxConcurrentSessions: binding.worker.maxConcurrentSessions,
    },
  }, authoritativeSettings);
  config.apiUrl = credential.apiOrigin;
  config.managedComputer = {
    managedComputerId: credential.managedComputerId,
    deviceId: credential.deviceId,
    organizationId: credential.organizationId,
    credentialFile,
  };
  config.projects = [
    ...config.projects.filter((candidate) => candidate.id !== projectId),
    project,
  ];
  await saveConfig(config);
  console.log(JSON.stringify({
    managedComputerId: credential.managedComputerId,
    organizationId: credential.organizationId,
    projectId,
    deviceId: credential.deviceId,
    workerId: binding.worker.id,
    provider,
    signedInAs: { name: user.name, email: user.email },
    readiness: binding.worker.readiness,
    duplicate: setup.duplicate || binding.duplicate,
  }));
}

export async function managedComputerStatusCommand() {
  const credential = await loadManagedComputerCredential(
    credentialPathFromFlag(),
  );
  const { userToken } = await configForManagedComputer(credential.apiOrigin);
  const status = await fetchManagedComputerSetupStatus(
    credential.apiOrigin,
    userToken,
    credential.organizationId,
    credential.managedComputerId,
  );
  console.log(JSON.stringify(status));
}

export async function managedComputerWorkerUpdateStatusCommand() {
  const credential = await loadManagedComputerCredential(
    credentialPathFromFlag(),
  );
  const workerId = value("--worker")?.trim();
  const requestId = value("--request-id")?.trim();
  const targetVersion = value("--target-version")?.trim();
  if (!workerId || !requestId || !targetVersion) {
    throw new Error("Worker update status requires worker, request ID, and target version");
  }
  const status = await createWorkerControlClient(
    credential.apiOrigin,
    credential.credential,
  ).getUpdateHandoff(workerId, requestId);
  if (
    !status.update || status.update.id !== requestId ||
    status.update.targetVersion !== targetVersion
  ) {
    throw new Error("Worker update status did not match the requested update");
  }
  if (status.update.status === "completed") {
    console.log("completed");
  } else if (
    status.update.status === "cancelled" ||
    status.update.handoffState === "failed"
  ) {
    console.log("failed");
  } else if (status.ready && status.activeWorkCount === 0) {
    console.log("ready");
  } else {
    console.log("pending");
  }
}

export async function managedComputerWorkerUpdateFailCommand() {
  const credential = await loadManagedComputerCredential(
    credentialPathFromFlag(),
  );
  const workerId = value("--worker")?.trim();
  const requestId = value("--request-id")?.trim();
  const error = value("--error")?.trim();
  if (!workerId || !requestId || !error) {
    throw new Error("Worker update failure requires worker, request ID, and error");
  }
  await createWorkerControlClient(
    credential.apiOrigin,
    credential.credential,
  ).failUpdateHandoff(workerId, requestId, error);
}
