import { resolve } from "node:path";
import {
  agentProviders,
  type AgentProvider,
} from "../src/lib/agent-provider";
import {
  cliVersion,
  gitValueAt,
  loadConfig,
  login,
  request,
  saveConfig,
  value,
} from "./command-support";
import {
  configuredManagedComputerCredentialPath,
  loadManagedComputerCredential,
} from "./managed-computer-credential";
import { discoverWorkerProviderCapabilities } from "./provider-capabilities";
import {
  healthyWorkerProviders,
  inspectWorkerProviderHealth,
} from "./provider-health";
export { managedComputerWorkerSupervisor } from "./managed-computer-supervisor";

type SetupSessionResponse = {
  session: {
    id: string;
    managedComputerId: string;
    organizationId: string;
    projectId: string;
    status: "pending" | "consumed";
    expiresAt: string;
  };
  setupToken: string;
  duplicate: boolean;
};

type SetupBindResponse = {
  managedComputerId: string;
  organizationId: string;
  projectId: string;
  deviceId: string;
  worker: {
    id: string;
    label: string;
    state: "online" | "stale" | "disabled";
    maxConcurrentSessions: number;
    acceptingWork: boolean;
    readiness: string;
  };
  duplicate: boolean;
};

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
  const me = await request<{ user: { id: string; name: string; email: string } }>(
    credential.apiOrigin,
    "/me",
    userToken,
  );
  const computer = await request<{
    computer: { requesterUserId: string; state: string; deviceId: string | null };
  }>(
    credential.apiOrigin,
    `/organizations/${credential.organizationId}/managed-computers/${credential.managedComputerId}`,
    userToken,
  );
  if (computer.computer.requesterUserId !== me.user.id) {
    throw new Error(
      "Briar must be logged in as the user who owns this managed computer",
    );
  }
  if (computer.computer.deviceId !== credential.deviceId) {
    throw new Error("This managed computer enrollment does not match the API");
  }

  const existingProject = config.projects.find((project) => project.id === projectId);
  const provider = providerFromFlag(existingProject?.llm?.provider ?? "codex");
  const providerHealth = await inspectWorkerProviderHealth(
    config.agentProviders,
    { openrouterApiKey: config.openrouterApiKey ?? null },
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
    config.agentProviders,
    { refresh: true },
  );
  const requestId = value("--request-id")?.trim() || crypto.randomUUID();
  const setup = await request<SetupSessionResponse>(
    credential.apiOrigin,
    `/organizations/${credential.organizationId}/managed-computers/${credential.managedComputerId}/setup-sessions`,
    userToken,
    {
      method: "POST",
      headers: { "Idempotency-Key": requestId },
      body: JSON.stringify({ projectId, requestId }),
    },
  );
  const binding = await request<SetupBindResponse>(
    credential.apiOrigin,
    `/managed-computers/${credential.managedComputerId}/setup/bind`,
    credential.credential,
    {
      method: "POST",
      body: JSON.stringify({
        setupToken: setup.setupToken,
        worker: {
          agentProvider: provider,
          providers: healthyWorkerProviders(providerHealth),
          providerHealth,
          providerCapabilities,
          versions: { briar: cliVersion },
        },
      }),
    },
  );
  if (
    binding.managedComputerId !== credential.managedComputerId ||
    binding.organizationId !== credential.organizationId ||
    binding.projectId !== projectId ||
    binding.deviceId !== credential.deviceId
  ) {
    throw new Error("Managed computer setup response did not match this device");
  }

  const repositoryRemote = gitValueAt(
    repositoryPath,
    ["remote", "get-url", "origin"],
  ) ?? undefined;
  const project = {
    ...existingProject,
    id: projectId,
    repositoryPath,
    repositoryRemote,
    apiUrl: credential.apiOrigin,
    llm: { provider },
    executionWorker: {
      deviceId: credential.deviceId,
      workerId: binding.worker.id,
      organizationId: credential.organizationId,
      label: binding.worker.label,
      maxConcurrentSessions: binding.worker.maxConcurrentSessions,
    },
  };
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
    signedInAs: { name: me.user.name, email: me.user.email },
    readiness: binding.worker.readiness,
    duplicate: setup.duplicate || binding.duplicate,
  }));
}

export async function managedComputerStatusCommand() {
  const credential = await loadManagedComputerCredential(
    credentialPathFromFlag(),
  );
  const { userToken } = await configForManagedComputer(credential.apiOrigin);
  const status = await request(
    credential.apiOrigin,
    `/organizations/${credential.organizationId}/managed-computers/${credential.managedComputerId}/setup`,
    userToken,
  );
  console.log(JSON.stringify(status));
}
