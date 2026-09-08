import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { protoAgentProvider } from "../src/lib/agent-provider-proto";
import { type AgentProvider } from "../src/lib/agent-provider";
import type { Config } from "./config-contract";
import type { WorkerSupervisorControl } from "./managed-computer-supervisor";
import { createWorkerControlClient } from "./worker-control-client";
import { resolveSandboxUpdatePlan, stageSandboxRuntime } from "./sandbox-update-install";
import {
  clearSandboxUpdate, readSandboxJson, sandboxActivation, sandboxRuntimeEnvironment,
  SandboxUpdateJournal, SandboxUpdateRequest, sandboxUpdateRoot, sandboxUpdateFinished,
  writeSandboxJson, type SandboxActivation, type SandboxUpdateProvider,
} from "./sandbox-update-state";

const DrainedWorker = Schema.Struct({ requestId: Schema.String, pid: Schema.Int, drainedAt: Schema.Finite });
export async function recordSandboxWorkerDrained(workerId: string, requestId: string, root = sandboxUpdateRoot()) {
  await mkdir(join(root, "drained"), { recursive: true, mode: 0o700 });
  await writeSandboxJson(join(root, "drained", `${workerId}.json`), { requestId, pid: process.pid, drainedAt: Date.now() });
}

type UpdateStatus = Awaited<ReturnType<ReturnType<typeof createWorkerControlClient>["getUpdateHandoff"]>>;
export function sandboxRuntimeHealthy(
  status: UpdateStatus, journal: SandboxUpdateJournal, activation: SandboxActivation,
) {
  return status.runtimes.length > 0 && status.runtimes.every(({ runtime, lastHeartbeatAt }) => {
    if (!runtime || runtime.updateRequestId !== journal.serverRequestId ||
      Date.parse(lastHeartbeatAt) < journal.phaseStartedAt) return false;
    if (Object.entries(activation.runtime.versions).some(([name, version]) => runtime.versions[name] !== version)) return false;
    return journal.expectedProviders.every((name) => {
      const provider = protoAgentProvider[name as AgentProvider];
      const health = runtime.providerHealth.find((entry) => entry.provider === provider);
      const capability = runtime.capabilities?.providerCapabilities.find((entry) => entry.provider === provider);
      return health?.installed === true && health.authenticated && health.healthy &&
        capability !== undefined && !capability.error &&
        (capability.models.length > 0 || capability.allowCustomModels);
    });
  });
}

export type SandboxUpdaterDependencies = {
  root: string;
  now: () => number;
  control: typeof createWorkerControlClient;
  plan: typeof resolveSandboxUpdatePlan;
  stage: typeof stageSandboxRuntime;
};

export function createSandboxUpdater(overrides: Partial<SandboxUpdaterDependencies> = {}) {
  const dependencies: SandboxUpdaterDependencies = {
    root: sandboxUpdateRoot(), now: Date.now, control: createWorkerControlClient,
    plan: resolveSandboxUpdatePlan, stage: stageSandboxRuntime, ...overrides,
  };
  const root = dependencies.root;
  const journalPath = join(root, "journal.json");
  let activation: SandboxActivation = { runtime: { id: "image", cli: process.env.BRIAR_CLI!, paths: [], versions: {}, integrity: {} }, previous: null };
  const save = async (journal: SandboxUpdateJournal) => {
    await mkdir(join(root, "journals"), { recursive: true, mode: 0o700 });
    await writeSandboxJson(join(root, "journals", `${journal.request.id}.json`), journal);
    await writeSandboxJson(journalPath, journal);
    console.log(JSON.stringify({ event: "sandbox_update", requestId: journal.request.id, phase: journal.phase, error: journal.error }));
  };

  const reconcile = async (config: Config, supervisor: WorkerSupervisorControl) => {
    activation = await sandboxActivation(root);
    const request = await readSandboxJson(join(root, "pending.json"), SandboxUpdateRequest);
    if (!request) return;
    const project = config.teams.find((team) => team.executionWorker?.token);
    if (!project?.executionWorker?.token) throw new Error("No sandbox Worker credential is available");
    const workerId = project.executionWorker.workerId;
    const client = dependencies.control(config.apiUrl, project.executionWorker.token);
    let journal = await readSandboxJson(journalPath, SandboxUpdateJournal);
    if (journal?.request.id === request.id && journal.phase === "failed") {
      const retry = await client.getUpdateHandoff(workerId, journal.serverRequestId);
      if (retry.update?.status === "requested" && retry.update.handoffState !== "failed") journal = null;
    }
    if (journal?.request.id !== request.id) {
      journal = {
        request, phase: "preparing", startedAt: dependencies.now(), phaseStartedAt: dependencies.now(),
        before: activation, expectedProviders: [],
        serverRequestId: request.id,
      };
      await save(journal);
    }
    if (sandboxUpdateFinished(journal.phase)) {
      await clearSandboxUpdate(request.id, root);
      return;
    }
    try {
      if (journal.phase === "preparing") {
        const baseline = await client.getUpdateHandoff(workerId);
        if (baseline.update?.status === "requested") {
          // The panel and host CLI can race. Adopt the server's device-wide ID
          // instead of leaving its request orphaned after the launcher coalesces.
          journal = { ...journal, serverRequestId: baseline.update.id };
        }
        const baseVersions = baseline.runtimes[0]?.runtime?.versions ?? {};
        journal = { ...journal, before: {
          ...journal.before,
          runtime: { ...journal.before.runtime, versions: { ...baseVersions, ...journal.before.runtime.versions } },
        } };
        const installed = new Set<SandboxUpdateProvider>();
        const expected = new Set<string>();
        for (const { runtime } of baseline.runtimes) {
          for (const [provider, id] of Object.entries(protoAgentProvider)) {
            const health = runtime?.providerHealth.find((entry) => entry.provider === id);
            if (health?.healthy) expected.add(provider);
            if (health?.installed && ["codex", "claude", "opencode", "grok"].includes(provider)) installed.add(provider as SandboxUpdateProvider);
          }
        }
        if (expected.size === 0) throw new Error("No healthy sandbox provider to preserve; fix provider authentication first");
        let staged = journal.staged ?? (request.rollback ? journal.before.previous : null);
        if (!staged && !request.rollback) {
          const plan = await dependencies.plan({ request, before: journal.before, apiUrl: config.apiUrl, installed: [...installed] });
          if (baseline.update?.status === "requested" && baseline.update.targetVersion !== plan.briarVersion) {
            throw new Error("A different sandbox update target is pending; retry after it is cancelled");
          }
          if (!plan.updateBriar && plan.artifacts.length === 0) {
            if (baseline.update?.status === "requested") await client.finishUpdate(workerId, baseline.update.id, true);
            await save({ ...journal, phase: "completed", phaseStartedAt: dependencies.now() });
            await clearSandboxUpdate(request.id, root);
            return;
          }
          staged = await dependencies.stage({ plan, before: journal.before, apiUrl: config.apiUrl, root });
        }
        if (!staged) throw new Error("There is no previous sandbox runtime to roll back to");
        journal = { ...journal, staged, expectedProviders: [...expected] };
        // Persist the staged release before requesting any interruption.
        await save(journal);
        const prepared = await client.prepareUpdateHandoff(workerId, staged.versions.briar!, true, journal.serverRequestId);
        journal = { ...journal, serverRequestId: prepared.update.id, phase: "draining", phaseStartedAt: dependencies.now() };
        await save(journal);
      }
      if (journal.phase === "draining") {
        const status = await client.getUpdateHandoff(workerId, journal.serverRequestId);
        if (!status.update || status.update.id !== journal.serverRequestId || status.update.status !== "requested") {
          throw new Error("Sandbox update is no longer pending; runtime was not replaced");
        }
        if (status.update?.handoffState === "failed") throw new Error("Sandbox work could not be handed off safely");
        let locallyDrained = true;
        for (const child of supervisor.workers) {
          const binding = config.teams.find((team) => team.id === child.projectId)?.executionWorker;
          const ack = binding && await readSandboxJson(join(root, "drained", `${binding.workerId}.json`), DrainedWorker);
          if (!ack || ack.requestId !== journal.serverRequestId || ack.pid !== child.pid ||
            ack.drainedAt < journal.phaseStartedAt) locallyDrained = false;
        }
        if (!status.ready || status.activeWorkCount !== 0 || !locallyDrained) {
          if (dependencies.now() - journal.phaseStartedAt > 120_000) throw new Error("Sandbox handoff timed out; runtime was not replaced");
          return;
        }
        await supervisor.stopWorkers();
        journal = { ...journal, phase: "activating", phaseStartedAt: dependencies.now() };
        await save(journal);
      }
      if (journal.phase === "activating") {
        if (!journal.staged || !journal.serverRequestId) throw new Error("Staged sandbox runtime is missing");
        const status = await client.getUpdateHandoff(workerId, journal.serverRequestId);
        if (status.update?.id !== journal.serverRequestId || status.update.status !== "requested" ||
          status.update.handoffState === "failed" || !status.ready || status.activeWorkCount !== 0) {
          // Recovery must re-establish the fence before touching children.
          journal = { ...journal, phase: "draining", phaseStartedAt: dependencies.now() };
          await save(journal);
          return;
        }
        // Also stop children after recovery from a supervisor crash in this phase.
        await supervisor.stopWorkers();
        activation = { runtime: journal.staged, previous: journal.before.runtime, updateRequestId: journal.serverRequestId };
        await writeSandboxJson(join(root, "current.json"), activation);
        journal = { ...journal, phase: "verifying", phaseStartedAt: dependencies.now() };
        await save(journal);
        return;
      }
      const status = await client.getUpdateHandoff(workerId, journal.serverRequestId);
      if (!status.update || status.update.status !== "requested") {
        // Completion may have succeeded just before the connection was lost.
        // A cancellation also removes the claim fence: never stop workers then.
        journal = { ...journal, phase: status.update?.status === "completed" ? "completed" : "failed",
          phaseStartedAt: dependencies.now(),
          ...(status.update?.status === "completed" ? {} : { error: "Update was cancelled externally; running runtime was left unchanged" }) };
        await save(journal);
        await clearSandboxUpdate(request.id, root);
        return;
      }
      if (sandboxRuntimeHealthy(status, journal, activation)) {
        const rolledBack = journal.phase === "rolling_back" || request.rollback;
        await client.finishUpdate(workerId, journal.serverRequestId!, rolledBack, journal.error);
        journal = { ...journal, phase: rolledBack ? "rolled_back" : "completed", phaseStartedAt: dependencies.now() };
        await save(journal);
        await clearSandboxUpdate(request.id, root);
      } else if (dependencies.now() - journal.phaseStartedAt > 180_000) {
        throw new Error("Sandbox workers did not report the expected versions, provider health and model catalog");
      }
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).slice(0, 1_900);
      if (journal.phase === "verifying" || journal.phase === "activating") {
        const fence = await client.getUpdateHandoff(workerId, journal.serverRequestId);
        if (!fence.update || fence.update.status !== "requested" || !fence.ready || fence.activeWorkCount !== 0) {
          if (fence.update?.status === "completed") {
            await save({ ...journal, phase: "completed", phaseStartedAt: dependencies.now() });
            await clearSandboxUpdate(request.id, root);
          }
          // Unknown or removed fence: leave children and activation untouched.
          return;
        }
        // The server is still fencing claims. Only idle, handed-off workers run here.
        await supervisor.stopWorkers();
        activation = { ...journal.before, updateRequestId: journal.serverRequestId };
        await writeSandboxJson(join(root, "current.json"), activation);
        journal = { ...journal, error: detail, phase: "rolling_back", phaseStartedAt: dependencies.now() };
        await save(journal);
        return;
      }
      if (journal.phase === "rolling_back") {
        await client.failUpdateHandoff(workerId, journal.serverRequestId!, `Rollback health check failed: ${detail}`);
      } else if (journal.serverRequestId) {
        // Downloads/drain failed before activation. Leave the running binary alone.
        const pending = await client.getUpdateHandoff(workerId, journal.serverRequestId);
        if (pending.update?.id === journal.serverRequestId && pending.update.status === "requested") {
          await client.finishUpdate(workerId, journal.serverRequestId, true, detail);
        }
      }
      journal = { ...journal, phase: "failed", error: detail, phaseStartedAt: dependencies.now() };
      await save(journal);
      await clearSandboxUpdate(request.id, root);
    }
  };
  return {
    reconcile,
    environment: () => sandboxRuntimeEnvironment(activation),
    command: (projectId: string) => [activation.runtime.cli, "worker", "--team", projectId],
  };
}
