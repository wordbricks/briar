import { describe, expect, it } from "vitest";
import type { ManagedComputer } from "../types";
import {
  resolveDmAgentComputerTarget,
  sameDmAgentComputerTarget,
} from "./dm-agent-computer";

const computer = (overrides: Partial<ManagedComputer> = {}): ManagedComputer => ({
  id: "computer-1",
  workspaceId: "workspace-1",
  requesterUserId: "user-1",
  state: "ready",
  provider: "aws",
  label: null,
  region: "us-east-1",
  instanceId: "i-1",
  volumeId: "vol-1",
  deviceId: "device-1",
  error: null,
  retryCount: 0,
  retryAvailable: false,
  createdAt: "2026-09-02T00:00:00.000Z",
  expiresAt: "2026-10-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  ...overrides,
});

const worker = {
  deviceId: "device-1",
  label: "Managed computer",
  bindings: [{
    id: "worker-binding-1",
    projectId: "project-1",
    projectName: "Briar",
    agentProvider: "codex" as const,
    providers: ["codex" as const],
    state: "online" as const,
    acceptingWork: true,
    readiness: "available" as const,
    readinessDetail: null,
  }],
};

const agent = {
  agentId: "agent-1",
  name: "QA Engineer",
  projectId: "project-1",
  computerUsePolicy: "unattended" as const,
};

const configuration = {
  id: "agent-1",
  teamId: "project-1",
  computerUsePolicy: "unattended" as const,
  designatedWorkerId: "worker-binding-1",
  designatedWorkerLabel: "QA computer",
};

describe("resolveDmAgentComputerTarget", () => {
  it("maps the designated worker binding through its device to a managed computer", () => {
    expect(resolveDmAgentComputerTarget({
      agents: [agent],
      agentConfigurations: [configuration],
      computers: [computer()],
      workers: [worker],
    })).toMatchObject({
      agentId: "agent-1",
      agentName: "QA Engineer",
      computer: { id: "computer-1", deviceId: "device-1" },
      workerLabel: "QA computer",
    });
  });

  it("does not confuse a worker binding id with a managed-computer device id", () => {
    expect(resolveDmAgentComputerTarget({
      agents: [agent],
      agentConfigurations: [configuration],
      computers: [computer({ deviceId: "worker-binding-1" })],
      workers: [worker],
    })).toBeNull();
  });

  it("hides computers from agents that cannot use the computer unattended", () => {
    expect(resolveDmAgentComputerTarget({
      agents: [{ ...agent, computerUsePolicy: "disabled" }],
      agentConfigurations: [configuration],
      computers: [computer()],
      workers: [worker],
    })).toBeNull();
  });

  it("ignores unavailable managed computers", () => {
    expect(resolveDmAgentComputerTarget({
      agents: [agent],
      agentConfigurations: [configuration],
      computers: [computer({ state: "stopped" })],
      workers: [worker],
    })).toBeNull();
  });

  it("reads a re-resolved screen as the same one", () => {
    const resolve = () => resolveDmAgentComputerTarget({
      agents: [agent],
      agentConfigurations: [configuration],
      computers: [computer()],
      workers: [worker],
    });
    const target = resolve();
    expect(target).not.toBeNull();
    expect(sameDmAgentComputerTarget(target, resolve())).toBe(true);
    expect(sameDmAgentComputerTarget(target, null)).toBe(false);
    expect(sameDmAgentComputerTarget(null, null)).toBe(true);
    expect(sameDmAgentComputerTarget(
      target,
      target && { ...target, agentId: "agent-2" },
    )).toBe(false);
  });
});
