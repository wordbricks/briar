import { describe, expect, it } from "vitest";

import type { ExecutionWorker } from "../types";
import {
  emptyAgentProviderCapabilityCatalog,
  type AgentProviderCapabilityCatalog,
} from "./agent-provider-contract";
import {
  executionWorkerSupportsSelection,
  teamWorkerCapabilityCatalog,
  teamWorkerProviders,
} from "./team-worker-capabilities";

const catalog = (model: string): AgentProviderCapabilityCatalog => {
  const capabilities = emptyAgentProviderCapabilityCatalog();
  capabilities.codex.models = [{
    id: model,
    label: model,
    efforts: [{ id: "high", label: "high" }],
  }];
  return capabilities;
};

const worker = (id: string, model: string): ExecutionWorker => ({
  id,
  deviceId: `device-${id}`,
  ownerUserId: "owner",
  label: id,
  agentProvider: "codex",
  providers: ["codex"],
  versions: {},
  state: "online",
  readiness: "available",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: { providerCapabilities: catalog(model) },
  maxConcurrentSessions: 1,
  activeSessions: 0,
  availableSessions: 1,
  lastHeartbeatAt: "2026-08-24T00:00:00.000Z",
  createdAt: "2026-08-24T00:00:00.000Z",
});

describe("project Worker capabilities", () => {
  it("tracks liveness, policy, and heartbeat capability changes", () => {
    const first = worker("first", "model-first");
    const second = worker("second", "model-second");
    const allowedOnly = {
      selectionMode: "allowlist" as const,
      defaultWorkerId: null,
      allowedWorkerIds: [first.id],
      updatedAt: null,
    };

    expect(
      teamWorkerCapabilityCatalog([first, second]).codex.models.map(
        (modelCapability) => modelCapability.id,
      ),
    ).toEqual(["model-first", "model-second"]);
    expect(
      teamWorkerCapabilityCatalog([first, second], allowedOnly).codex.models
        .map((modelCapability) => modelCapability.id),
    ).toEqual(["model-first"]);

    const expired = { ...first, state: "stale" as const, readiness: "offline" as const };
    expect(teamWorkerProviders([expired])).toEqual([]);
    expect(teamWorkerCapabilityCatalog([expired]).codex.models).toEqual([]);

    const changed = {
      ...first,
      capabilities: { providerCapabilities: catalog("model-after-heartbeat") },
    };
    expect(
      teamWorkerCapabilityCatalog([changed]).codex.models.map(
        (modelCapability) => modelCapability.id,
      ),
    ).toEqual(["model-after-heartbeat"]);
  });

  it("requires an explicit model and effort to be reported by that Worker", () => {
    const selected = worker("selected", "model-supported");
    expect(
      executionWorkerSupportsSelection(
        selected,
        "codex",
        "model-supported",
        "high",
      ),
    ).toBe(true);
    expect(
      executionWorkerSupportsSelection(
        selected,
        "codex",
        "model-unsupported",
        "high",
      ),
    ).toBe(false);
  });
});
