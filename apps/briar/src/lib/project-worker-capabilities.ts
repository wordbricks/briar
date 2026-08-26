import * as Option from "effect/Option";

import type {
  ExecutionWorker,
  ProjectExecutionWorkerPolicy,
} from "../types";
import {
  agentProviderSupportsSelection,
  decodeAgentProviderCapabilityCatalogOption,
  mergeAgentProviderCapabilityAdvertisements,
} from "./agent-provider-contract";
import { agentProviders, type AgentProvider } from "./agent-provider";

export function projectPolicyWorkers(
  workers: readonly ExecutionWorker[],
  policy?: ProjectExecutionWorkerPolicy,
) {
  if (policy?.selectionMode !== "allowlist") return [...workers];
  const allowed = new Set(policy.allowedWorkerIds);
  return workers.filter((worker) => allowed.has(worker.id));
}

export function isProjectWorkerCatalogEligible(worker: ExecutionWorker) {
  return worker.state === "online" &&
    worker.acceptingWork &&
    (worker.readiness === "available" || worker.readiness === "busy");
}

export function projectWorkerProviders(
  workers: readonly ExecutionWorker[],
  policy?: ProjectExecutionWorkerPolicy,
) {
  const eligibleWorkers = projectPolicyWorkers(workers, policy).filter(
    isProjectWorkerCatalogEligible,
  );
  return agentProviders.filter((provider) =>
    eligibleWorkers.some((worker) => worker.providers?.includes(provider))
  );
}

export function projectWorkerCapabilityCatalog(
  workers: readonly ExecutionWorker[],
  policy?: ProjectExecutionWorkerPolicy,
) {
  const advertisements = projectPolicyWorkers(workers, policy)
    .filter(isProjectWorkerCatalogEligible)
    .map((worker) => ({
      providers: worker.providers ?? [],
      providerCapabilities: worker.capabilities.providerCapabilities,
    }));
  return mergeAgentProviderCapabilityAdvertisements(advertisements);
}

export function executionWorkerSupportsSelection(
  worker: ExecutionWorker,
  provider: AgentProvider,
  model: string | null,
  effort: string | null,
) {
  if (!worker.providers?.includes(provider)) return false;
  if (!model && !effort) return true;
  const parsed = decodeAgentProviderCapabilityCatalogOption(
    worker.capabilities.providerCapabilities,
  );
  return Option.isSome(parsed) &&
    agentProviderSupportsSelection(parsed.value[provider], model, effort);
}

export function projectSupportsExecutionSelection(
  workers: readonly ExecutionWorker[],
  policy: ProjectExecutionWorkerPolicy | undefined,
  provider: AgentProvider,
  model: string | null,
  effort: string | null,
) {
  return projectPolicyWorkers(workers, policy).some((worker) =>
    isProjectWorkerCatalogEligible(worker) &&
    executionWorkerSupportsSelection(worker, provider, model, effort)
  );
}
