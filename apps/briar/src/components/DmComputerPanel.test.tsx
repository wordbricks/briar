/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import type {
  ManagedComputer,
  ManagedComputerRemoteSessionTicket,
  OrganizationExecutionWorker,
  ProjectAgent,
} from "../types";
import {
  DmComputerPanel,
  type DmComputerPanelServices,
  type DmComputerRfbConstructor,
} from "./DmComputerPanel";

type FakeRfb = {
  focusOnClick: boolean;
  resizeSession: boolean;
  scaleViewport: boolean;
  target: Element;
  viewOnly: boolean;
  emit: (type: string) => void;
};

const noVncState = {
  instances: [] as FakeRfb[],
};

class FakeRfbClient {
  clipViewport = false;
  compressionLevel = 0;
  focusOnClick = false;
  qualityLevel = 0;
  resizeSession = true;
  scaleViewport = false;
  viewOnly = false;
  readonly target: Element;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(target: HTMLElement) {
    this.target = target;
    noVncState.instances.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  disconnect() {}
  focus() {}
  sendCtrlAltDel() {}

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const managedComputer: ManagedComputer = {
  id: "computer-1",
  organizationId: "organization-1",
  requesterUserId: "user-1",
  state: "ready",
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
};

const organizationWorker: OrganizationExecutionWorker = {
  deviceId: "device-1",
  ownerUserId: "user-1",
  ownerName: "Jay",
  label: "Managed computer",
  state: "online",
  maxConcurrentSessions: 1,
  activeSessions: 0,
  lastHeartbeatAt: "2026-09-02T00:00:00.000Z",
  createdAt: "2026-09-02T00:00:00.000Z",
  bindings: [{
    id: "worker-binding-1",
    projectId: "project-1",
    projectName: "Briar",
    agentProvider: "codex",
    providers: ["codex"],
    state: "online",
    acceptingWork: true,
    readiness: "available",
    readinessDetail: null,
  }],
};

const projectAgent: ProjectAgent = {
  id: "agent-1",
  projectId: "project-1",
  name: "QA Engineer",
  avatar: null,
  codexPet: null,
  provider: "codex",
  model: null,
  effort: null,
  computerUsePolicy: "unattended",
  designatedWorkerId: "worker-binding-1",
  designatedWorkerLabel: "QA computer",
  description: "Checks the product",
  responsibility: "QA",
  skill: "",
  skills: [],
  calendarColor: "#7d5ce7",
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

const ticket: ManagedComputerRemoteSessionTicket = {
  session: {
    id: "remote-session-1",
    managedComputerId: "computer-1",
    agentId: "agent-1",
    state: "created",
    connectionGeneration: 1,
    tokenExpiresAt: "2026-09-02T00:10:00.000Z",
    maxExpiresAt: "2026-09-02T01:00:00.000Z",
    connectedAt: null,
    disconnectedAt: null,
    endedAt: null,
  },
  socket: {
    url: "wss://remote.example.test/session",
    protocol: "briar.remote.v1.test-token",
  },
  reconnected: false,
};

const createRemoteSession = vi.fn<
  DmComputerPanelServices["createRemoteSession"]
>();
const endRemoteSession = vi.fn<
  DmComputerPanelServices["endRemoteSession"]
>();
const loadComputers = vi.fn<DmComputerPanelServices["loadComputers"]>();
const loadProjectAgents = vi.fn<
  DmComputerPanelServices["loadProjectAgents"]
>();
const loadWorkers = vi.fn<DmComputerPanelServices["loadWorkers"]>();
const services: DmComputerPanelServices = {
  createRemoteSession,
  endRemoteSession,
  loadComputers,
  loadProjectAgents,
  loadRfbClient: async () =>
    FakeRfbClient as unknown as DmComputerRfbConstructor,
  loadWorkers,
};

describe("DmComputerPanel", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    window.localStorage.setItem("briar.locale.v1", "en");
    window.sessionStorage.clear();
    noVncState.instances.length = 0;
    loadWorkers.mockReset().mockResolvedValue({
      workers: [organizationWorker],
      latestVersion: null,
      canManage: true,
      generatedAt: "2026-09-02T00:00:00.000Z",
    });
    loadComputers.mockReset().mockResolvedValue({
      computers: [managedComputer],
      generatedAt: "2026-09-02T00:00:00.000Z",
    });
    loadProjectAgents.mockReset().mockResolvedValue([projectAgent]);
    createRemoteSession.mockReset().mockResolvedValue(ticket);
    endRemoteSession.mockReset().mockResolvedValue();
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it("expands the Agent screen without replacing its read-only connection", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <DmComputerPanel
          agents={[{
            agentId: "agent-1",
            name: "QA Engineer",
            avatar: null,
            provider: "codex",
            model: null,
            effort: null,
            computerUsePolicy: "unattended",
            projectId: "project-1",
            projectName: "Briar",
            responsibility: "QA",
            skills: [],
            createdAt: "2026-09-02T00:00:00.000Z",
          }]}
          organizationId="organization-1"
          services={services}
          token="session-token"
        />
      </I18nProvider>,
    );

    await vi.waitFor(() => expect(noVncState.instances).toHaveLength(1));
    const rfb = noVncState.instances[0]!;
    expect(createRemoteSession).toHaveBeenCalledWith(
      "session-token",
      "organization-1",
      "computer-1",
      expect.objectContaining({ agentId: "agent-1" }),
    );
    expect(rfb.viewOnly).toBe(true);
    expect(rfb.resizeSession).toBe(false);

    await act(async () => rfb.emit("connect"));
    const openButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open full screen"]',
    );
    expect(openButton).not.toBeNull();
    await act(async () => openButton?.click());

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(rfb.viewOnly).toBe(false);
    expect(noVncState.instances).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="complementary"]')).not.toBeNull();
    expect(rfb.viewOnly).toBe(true);

    await cleanup();
    expect(endRemoteSession).toHaveBeenCalledWith(
      "session-token",
      "organization-1",
      "computer-1",
      "remote-session-1",
    );
  });
});
