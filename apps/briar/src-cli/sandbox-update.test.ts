import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workerRuntimeToProto, type WorkerRuntimeInput } from "../src/lib/worker-runtime-proto";
import { emptyAgentProviderCapabilityCatalog } from "../src/lib/agent-provider-contract";
import { agentProviders } from "../src/lib/agent-provider";
import type { Config } from "./config-contract";
import { createWorkerControlClient } from "./worker-control-client";
import { createSandboxUpdater, recordSandboxWorkerDrained } from "./sandbox-update-supervisor";
import {
  readSandboxJson, sandboxActivation, SandboxUpdateJournal, submitSandboxUpdate,
  writeSandboxJson, type SandboxRuntime,
} from "./sandbox-update-state";
import { safeSandboxArchiveEntry, sandboxArtifactUrl } from "./sandbox-update-install";

const requestId = "11111111-1111-4111-8111-111111111111";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "briar-sandbox-update-test-"));
  directories.push(root);
  let now = Date.parse("2026-09-08T01:00:00Z");
  const before: SandboxRuntime = { id: "old", cli: "/old/briar", paths: ["/old/bin"], versions: { briar: "1.2.216", codex: "0.149.1" }, integrity: {} };
  const staged: SandboxRuntime = { ...before, id: "new", cli: "/new/briar", paths: ["/new/bin"], versions: { briar: "1.2.216", codex: "0.153.4" } };
  await writeSandboxJson(join(root, "current.json"), { runtime: before, previous: null });
  const runtime = workerRuntimeToProto({
    agentProvider: "codex", versions: {}, worktrees: true,
    providerCapabilities: emptyAgentProviderCapabilityCatalog(),
    providerHealth: Object.fromEntries(agentProviders.map((provider) => [provider, {
      installed: provider === "codex", authenticated: provider === "codex", healthy: provider === "codex",
    }])) as WorkerRuntimeInput["providerHealth"],
  });
  runtime.versions = { ...before.versions };
  runtime.capabilities!.providerCapabilities[0]!.models = [{
    $typeName: "briar.types.v1.AgentModelCapability", id: "codex", label: "Codex", efforts: [],
  }];
  let status: Awaited<ReturnType<ReturnType<typeof createWorkerControlClient>["getUpdateHandoff"]>> = {
    activeWorkCount: 0, ready: true, update: null,
    runtimes: [{ $typeName: "briar.worker.v1.WorkerUpdateRuntime", workerId: "worker", runtime, lastHeartbeatAt: new Date(now).toISOString() }],
  };
  const client = {
    getUpdateHandoff: vi.fn(async () => status),
    prepareUpdateHandoff: vi.fn(async () => {
      status = { ...status, ready: false, activeWorkCount: 1, update: {
        id: requestId, targetVersion: "1.2.216", status: "requested", requestedAt: new Date(now).toISOString(),
        handoffState: "draining", handoffError: null,
      } };
      return { update: status.update!, activeWorkCount: 1, ready: false };
    }),
    finishUpdate: vi.fn(async () => ({})),
    failUpdateHandoff: vi.fn(async () => ({})),
  };
  const stage = vi.fn(async () => staged);
  const dependencies = {
    root, now: () => now,
    control: (() => client) as unknown as typeof createWorkerControlClient,
    plan: vi.fn(async () => ({ briarVersion: "1.2.216", updateBriar: false,
      artifacts: [{ provider: "codex" as const, version: "0.153.4", url: "https://registry.npmjs.org/codex.tgz" }] })), stage,
  };
  const config = {
    apiUrl: "https://briar.example", teams: [{ id: "team", executionWorker: { workerId: "worker", token: "credential" } }],
  } as Config;
  const control = { workers: [{ projectId: "team", pid: process.pid }], stopWorkers: vi.fn(async () => undefined) };
  const updater = createSandboxUpdater(dependencies);
  await submitSandboxUpdate({ id: requestId, provider: "codex", rollback: false }, root);
  const ready = async () => {
    status = { ...status, activeWorkCount: 0, ready: true };
    await recordSandboxWorkerDrained("worker", requestId, root);
  };
  const healthy = (version = "0.153.4") => {
    runtime.versions.codex = version;
    runtime.updateRequestId = requestId;
    status.runtimes[0]!.lastHeartbeatAt = new Date(now + 1).toISOString();
  };
  return {
    root, before, staged, config, control, client, stage, updater, dependencies,
    tick: () => updater.reconcile(config, control), ready, healthy,
    status: () => status,
    setStatus: (change: Partial<typeof status>) => { status = { ...status, ...change }; },
    advance: (ms: number) => { now += ms; },
    journal: () => readSandboxJson(join(root, "journal.json"), SandboxUpdateJournal),
  };
}

describe("sandbox runtime updates", () => {
  it("does not interrupt work when all installed versions are already current", async () => {
    const test = await fixture();
    test.dependencies.plan.mockResolvedValue({ briarVersion: "1.2.216", updateBriar: false, artifacts: [] });
    await test.tick();
    expect((await test.journal())?.phase).toBe("completed");
    expect(test.stage).not.toHaveBeenCalled();
    expect(test.client.prepareUpdateHandoff).not.toHaveBeenCalled();
    expect(test.control.stopWorkers).not.toHaveBeenCalled();
  });

  it("does not touch running workers if release staging fails", async () => {
    const test = await fixture();
    test.stage.mockRejectedValue(new Error("signature mismatch"));
    await test.tick();
    expect((await test.journal())?.phase).toBe("failed");
    expect(test.client.prepareUpdateHandoff).not.toHaveBeenCalled();
    expect(test.control.stopWorkers).not.toHaveBeenCalled();
  });

  it("does not roll back after an external cancellation removes the claim fence", async () => {
    const test = await fixture();
    await test.tick(); await test.ready(); await test.tick();
    const stops = test.control.stopWorkers.mock.calls.length;
    test.setStatus({ update: { ...test.status().update!, status: "cancelled" } });
    test.advance(180_001);
    await test.tick();
    expect(test.control.stopWorkers).toHaveBeenCalledTimes(stops);
    expect((await sandboxActivation(test.root)).runtime).toEqual(test.staged);
    expect((await test.journal())?.phase).toBe("failed");
  });

  it("stages before interruption and requires both the lease handoff and process acknowledgement", async () => {
    const test = await fixture();
    await test.tick();
    expect(test.stage.mock.invocationCallOrder[0]).toBeLessThan(test.client.prepareUpdateHandoff.mock.invocationCallOrder[0]!);
    expect(test.control.stopWorkers).not.toHaveBeenCalled();
    expect((await test.journal())?.phase).toBe("draining");
    expect((await sandboxActivation(test.root)).runtime).toEqual(test.before);
    await test.ready();
    await test.tick();
    expect((await test.journal())?.phase).toBe("verifying");
    expect((await sandboxActivation(test.root)).runtime).toEqual(test.staged);
    expect(test.client.finishUpdate).not.toHaveBeenCalled();
    await test.tick();
    expect(test.client.finishUpdate).not.toHaveBeenCalled();
    test.healthy();
    await test.tick();
    expect(test.client.finishUpdate).toHaveBeenCalledWith("worker", requestId, false, undefined);
    expect((await test.journal())?.phase).toBe("completed");
  });

  it("does not stop or switch a runtime when handoff times out", async () => {
    const test = await fixture();
    await test.tick();
    test.advance(120_001);
    await test.tick();
    expect(test.control.stopWorkers).not.toHaveBeenCalled();
    expect((await sandboxActivation(test.root)).runtime).toEqual(test.before);
    expect((await test.journal())?.phase).toBe("failed");
    expect(test.client.finishUpdate).toHaveBeenCalledWith("worker", requestId, true, expect.stringContaining("handoff timed out"));
  });

  it("recovers a staged update from its journal without downloading it again", async () => {
    const test = await fixture();
    await test.tick();
    await test.ready();
    const recovered = createSandboxUpdater(test.dependencies);
    await recovered.reconcile(test.config, test.control);
    expect(test.stage).toHaveBeenCalledTimes(1);
    expect((await test.journal())?.phase).toBe("verifying");
  });

  it("restores the previous runtime when new heartbeats fail health verification", async () => {
    const test = await fixture();
    await test.tick(); await test.ready(); await test.tick();
    test.advance(180_001);
    await test.tick();
    expect((await sandboxActivation(test.root)).runtime).toEqual(test.before);
    expect((await test.journal())?.phase).toBe("rolling_back");
    expect(test.client.finishUpdate).not.toHaveBeenCalled();
    test.healthy("0.149.1");
    await test.tick();
    expect((await test.journal())?.phase).toBe("rolled_back");
    expect(test.client.finishUpdate).toHaveBeenCalledWith("worker", requestId, true, expect.stringContaining("expected versions"));
  });

  it("keeps the queue closed if rollback health verification fails too", async () => {
    const test = await fixture();
    await test.tick(); await test.ready(); await test.tick();
    test.advance(180_001); await test.tick();
    test.advance(180_001); await test.tick();
    expect(test.client.failUpdateHandoff).toHaveBeenCalled();
    expect(test.client.finishUpdate).not.toHaveBeenCalled();
    expect((await test.journal())?.phase).toBe("failed");
  });

  it("coalesces duplicate requests while refusing a different update", async () => {
    const test = await fixture();
    expect(await submitSandboxUpdate({ id: requestId, rollback: false }, test.root)).toMatchObject({ provider: "codex" });
    await expect(submitSandboxUpdate({ id: "22222222-2222-4222-8222-222222222222", provider: "claude", rollback: false }, test.root)).rejects.toThrow("different sandbox update");
    expect(JSON.parse(await readFile(join(test.root, "pending.json"), "utf8"))).toMatchObject({ id: requestId, provider: "codex" });
  });

  it("rejects artifact URL injection and archive traversal", () => {
    expect(sandboxArtifactUrl("https://registry.npmjs.org/@openai/codex/-/codex.tgz", ["registry.npmjs.org"])).toContain("codex.tgz");
    for (const url of ["http://registry.npmjs.org/a", "https://registry.npmjs.org.evil.test/a", "https://user:secret@registry.npmjs.org/a"]) {
      expect(() => sandboxArtifactUrl(url, ["registry.npmjs.org"])).toThrow();
    }
    expect(safeSandboxArchiveEntry("./lib/briar.js")).toBe(true);
    for (const path of ["../../auth.json", "/etc/passwd", "lib/../outside", "lib\\..\\outside"]) expect(safeSandboxArchiveEntry(path)).toBe(false);
  });
});
