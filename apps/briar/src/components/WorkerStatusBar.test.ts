import { describe, expect, it } from "vitest";

import type { ExecutionWorker, ManagedComputer } from "../types";
import { managedComputerShortcutTarget } from "./WorkerStatusBar";

const organizationId = "11111111-1111-4111-8111-111111111111";
const ownerUserId = "managed-computer-owner";

const worker: ExecutionWorker = {
  id: "managed-worker",
  deviceId: "managed-device",
  ownerUserId,
  label: "Briar managed computer",
  agentProvider: "codex",
  providers: ["codex"],
  versions: { briar: "1.2.162" },
  state: "online",
  readiness: "available",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 0,
  availableSessions: 1,
  lastHeartbeatAt: "2026-08-26T00:00:00.000Z",
  createdAt: "2026-08-26T00:00:00.000Z",
};

const computer: ManagedComputer = {
  id: "22222222-2222-4222-8222-222222222222",
  organizationId,
  requesterUserId: ownerUserId,
  state: "ready",
  provider: "aws",
  label: null,
  region: "us-east-1",
  instanceId: "i-managed",
  volumeId: "vol-managed",
  deviceId: worker.deviceId,
  error: null,
  retryCount: 0,
  retryAvailable: false,
  createdAt: "2026-08-26T00:00:00.000Z",
  expiresAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

const target = ({
  candidate = computer,
  enabled = true,
  userId = ownerUserId,
}: {
  candidate?: ManagedComputer;
  enabled?: boolean;
  userId?: string | null;
} = {}) => managedComputerShortcutTarget({
  managedComputersByDeviceId: candidate.deviceId
    ? { [candidate.deviceId]: candidate }
    : {},
  organizationId,
  remoteDesktopEnabled: enabled,
  userId,
  worker,
});

describe("managedComputerShortcutTarget", () => {
  it("returns an eligible managed computer for its owner", () => {
    expect(target()).toBe(computer);
    expect(target({ candidate: { ...computer, state: "needs_setup" } }))
      .toMatchObject({ id: computer.id });
  });

  it("hides the shortcut outside the owner boundary", () => {
    expect(target({ userId: "organization-member" })).toBeNull();
    expect(target({ candidate: {
      ...computer,
      requesterUserId: "another-requester",
    } })).toBeNull();
    expect(managedComputerShortcutTarget({
      managedComputersByDeviceId: { [worker.deviceId]: computer },
      organizationId,
      remoteDesktopEnabled: true,
      userId: ownerUserId,
      worker: { ...worker, ownerUserId: "another-owner" },
    })).toBeNull();
  });

  it("requires the feature, organization, eligible state, and matching device", () => {
    expect(target({ enabled: false })).toBeNull();
    expect(target({ candidate: { ...computer, state: "failed" } })).toBeNull();
    expect(target({ candidate: {
      ...computer,
      organizationId: "another-organization",
    } })).toBeNull();
    expect(target({ candidate: { ...computer, deviceId: "another-device" } }))
      .toBeNull();
  });
});
