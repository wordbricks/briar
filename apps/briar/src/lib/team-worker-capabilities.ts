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

export function teamPolicyWorkers(
  workers: readonly ExecutionWorker[],
  policy?: ProjectExecutionWorkerPolicy,
) {
  if (policy?.selectionMode !== "allowlist") return [...workers];
  const allowed = new Set(policy.allowedWorkerIds);
  return workers.filter((worker) => allowed.has(worker.id));
}

export function isTeamWorkerCatalogEligible(worker: ExecutionWorker) {
  return worker.state === "online" &&
    worker.acceptingWork &&
    (worker.readiness === "available" || worker.readiness === "busy");
}

export function teamWorkerProviders(
  workers: readonly ExecutionWorker[],
  policy?: ProjectExecutionWorkerPolicy,
) {
  const eligibleWorkers = teamPolicyWorkers(workers, policy).filter(
    isTeamWorkerCatalogEligible,
  );
  return agentProviders.filter((provider) =>
    eligibleWorkers.some((worker) => worker.providers.includes(provider))
  );
}

export function teamWorkerCapabilityCatalog(
  workers: readonly ExecutionWorker[],
  policy?: ProjectExecutionWorkerPolicy,
) {
  const advertisements = teamPolicyWorkers(workers, policy)
    .filter(isTeamWorkerCatalogEligible)
    .map((worker) => ({
      providers: worker.providers,
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
  if (!worker.providers.includes(provider)) return false;
  if (!model && !effort) return true;
  const parsed = decodeAgentProviderCapabilityCatalogOption(
    worker.capabilities.providerCapabilities,
  );
  return Option.isSome(parsed) &&
    agentProviderSupportsSelection(parsed.value[provider], model, effort);
}

export function teamSupportsExecutionSelection(
  workers: readonly ExecutionWorker[],
  policy: ProjectExecutionWorkerPolicy | undefined,
  provider: AgentProvider,
  model: string | null,
  effort: string | null,
) {
  return teamPolicyWorkers(workers, policy).some((worker) =>
    isTeamWorkerCatalogEligible(worker) &&
    executionWorkerSupportsSelection(worker, provider, model, effort)
  );
}
