/** @vitest-environment jsdom */

import { act } from "react";
import { remoteDesktopCapturesKeyboard } from "../lib/remote-desktop-focus";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { ApiError } from "../lib/api/errors";
import { createReactTestRoot, flush, renderReactTestRoot } from "../test/react";
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

type FakeRfb = FakeRfbClient;

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
  readonly target: HTMLCanvasElement;
  inputs: string[] = [];
  clipboardPasteFrom = vi.fn();
  sendKey = vi.fn();
  disconnect = vi.fn();
  blur = vi.fn();
  sendCtrlAltDel = vi.fn();
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(target: HTMLElement) {
    this.target = document.createElement("canvas");
    this.target.tabIndex = 0;
    target.appendChild(this.target);
    for (const type of ["mousedown", "mouseup", "mousemove", "click", "wheel", "keydown", "keyup", "pointerdown", "pointermove", "pointerup", "touchstart", "touchend"]) {
      this.target.addEventListener(type, () => this.inputs.push(type));
    }
    noVncState.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  focus() { this.target.focus(); }

  emit(type: string, text?: string) {
    const event = new CustomEvent(type, { detail: { text } });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const managedComputer: ManagedComputer = {
  id: "computer-1",
  organizationId: "organization-1",
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
  teamId: "project-1",
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

const dmAgent = () => ({
  agentId: "agent-1",
  name: "QA Engineer",
  avatar: null,
  provider: "codex" as const,
  model: null,
  effort: null,
  computerUsePolicy: "unattended" as const,
  projectId: "project-1",
  projectName: "Briar",
  responsibility: "QA",
  skills: [],
  createdAt: "2026-09-02T00:00:00.000Z",
});

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
const nativeClipboardWrite = vi.fn().mockResolvedValue(undefined);
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
    nativeClipboardWrite.mockReset().mockResolvedValue(undefined);
    mockIPC(nativeClipboardWrite);
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
    clearMocks();
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
    await act(async () => rfb.emit("clipboard", "preview text"));
    expect(nativeClipboardWrite).not.toHaveBeenCalled();
    const openButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open full screen"]',
    );
    expect(openButton).not.toBeNull();
    await act(async () => openButton?.click());

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(rfb.viewOnly).toBe(true);
    const control = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(control.getAttribute("aria-label")).toBe("Computer control");
    expect(document.activeElement).toBe(control);
    await act(async () => control.click());
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(rfb.viewOnly).toBe(false);
    expect(noVncState.instances).toHaveLength(1);

    await act(async () => rfb.emit("clipboard", "한글\nremote copy"));
    await vi.waitFor(() => expect(nativeClipboardWrite).toHaveBeenCalledWith(
      "plugin:clipboard-manager|write_text",
      { text: "한글\nremote copy" },
    ));
    expect(container.textContent).toContain("Copied to local");

    nativeClipboardWrite.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    await act(async () => rfb.emit("clipboard", "retry copy"));
    await vi.waitFor(() => expect(container.textContent).toContain("Automatic copy failed"));
    const copyButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy to local",
    );
    expect(copyButton).toBeDefined();
    await act(async () => copyButton?.click());
    await vi.waitFor(() => expect(container.textContent).toContain("Copied to local"));
    expect(nativeClipboardWrite).toHaveBeenLastCalledWith(
      "plugin:clipboard-manager|write_text",
      { text: "retry copy" },
    );

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="complementary"]')).not.toBeNull();
    expect(rfb.viewOnly).toBe(true);
    await act(async () => rfb.emit("clipboard", "collapsed copy"));
    expect(nativeClipboardWrite).toHaveBeenCalledTimes(3);

    await cleanup();
    rfb.emit("clipboard", "after closing");
    expect(nativeClipboardWrite).toHaveBeenCalledTimes(3);
    expect(endRemoteSession).toHaveBeenCalledWith(
      "session-token",
      "organization-1",
      "computer-1",
      "remote-session-1",
    );
  });

  async function openScreen() {
    const testRoot = createReactTestRoot({ attachToDocument: true });
    await renderReactTestRoot(testRoot.root, <I18nProvider>
      <DmComputerPanel agents={[dmAgent()]} organizationId="organization-1" services={services} token="session-token" />
    </I18nProvider>);
    await vi.waitFor(() => expect(noVncState.instances).toHaveLength(1));
    const rfb = noVncState.instances[0]!;
    await act(async () => rfb.emit("connect"));
    const open = testRoot.container.querySelector<HTMLButtonElement>('[aria-label="Open full screen"]')!;
    await act(async () => open.click());
    const control = testRoot.container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    return { ...testRoot, rfb, control };
  }

  function paste(target: Element, text: string) {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
    target.dispatchEvent(event);
  }

  it("blocks screen input until explicit control and cancels queued paste on opt-out", async () => {
    const { cleanup, container, control, rfb } = await openScreen();
    expect(remoteDesktopCapturesKeyboard()).toBe(false);
    const sendInputs = () => {
      for (const type of ["mousedown", "mouseup", "mousemove", "click", "wheel", "keydown", "keyup", "pointerdown", "pointermove", "pointerup", "touchstart", "touchend"]) {
        rfb.target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
      }
      paste(rfb.target, "private clipboard");
    };
    await act(async () => sendInputs());
    expect(rfb.inputs).toEqual([]);
    expect(rfb.clipboardPasteFrom).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Input blocked");
    expect(container.textContent).toContain("sign in, or take over from the agent");
    const cad = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Ctrl Alt Del"))!;
    expect(cad.disabled).toBe(true);
    await act(async () => control.click());
    expect(remoteDesktopCapturesKeyboard()).toBe(true);
    expect(rfb.focusOnClick).toBe(true);
    await act(async () => {
      rfb.target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, buttons: 1 }));
      rfb.target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1 }));
      rfb.target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 10 }));
      rfb.target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
      cad.click();
      paste(rfb.target, "first");
      paste(rfb.target, "queued");
    });
    expect(rfb.inputs).toEqual(["mousedown", "mousemove", "wheel", "keydown"]);
    expect(rfb.sendCtrlAltDel).toHaveBeenCalledTimes(1);
    expect(rfb.clipboardPasteFrom).toHaveBeenCalledWith("first");
    const releaseCapture = vi.fn((event: MouseEvent) => {
      rfb.target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, buttons: 0 }));
      event.preventDefault();
    });
    window.addEventListener("mouseup", releaseCapture, { once: true });
    await act(async () => control.click());
    expect(rfb.inputs.at(-1)).toBe("mouseup");
    expect(rfb.blur).toHaveBeenCalled();
    expect(releaseCapture).toHaveBeenCalledTimes(1);
    expect(rfb.viewOnly).toBe(true);
    expect(rfb.focusOnClick).toBe(false);
    expect(remoteDesktopCapturesKeyboard()).toBe(false);
    rfb.inputs = [];
    await act(async () => sendInputs());
    await act(async () => new Promise(resolve => setTimeout(resolve, 600)));
    expect(rfb.inputs).toEqual([]);
    expect(rfb.sendKey).not.toHaveBeenCalled();
    expect(rfb.clipboardPasteFrom).toHaveBeenCalledTimes(1);
    expect(createRemoteSession).toHaveBeenCalledTimes(1);
    expect(endRemoteSession).not.toHaveBeenCalled();
    expect(rfb.disconnect).not.toHaveBeenCalled();
    await cleanup();
  });

  it("pastes only after consent while keeping the existing handoff session", async () => {
    const { cleanup, control, rfb } = await openScreen();
    await act(async () => control.click());
    await act(async () => paste(rfb.target, "login text"));
    await act(async () => new Promise(resolve => setTimeout(resolve, 600)));
    expect(rfb.clipboardPasteFrom).toHaveBeenCalledWith("login text");
    expect(rfb.sendKey.mock.calls).toEqual([
      [0xffe1, "ShiftLeft", true], [0xff63, "Insert", true],
      [0xff63, "Insert", false], [0xffe1, "ShiftLeft", false],
    ]);
    expect(createRemoteSession).toHaveBeenCalledTimes(1);
    expect(endRemoteSession).not.toHaveBeenCalled();
    await cleanup();
  });

  it.each(["disconnect", "securityfailure"])("resets consent after %s and ignores stale connection events", async (event) => {
    const { cleanup, container, control, rfb } = await openScreen();
    await act(async () => control.click());
    await act(async () => rfb.emit(event));
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(control.disabled).toBe(true);
    expect(rfb.viewOnly).toBe(true);
    expect(remoteDesktopCapturesKeyboard()).toBe(false);
    const reconnect = [...container.querySelectorAll("button")].find(button => button.textContent === "Reconnect")!;
    await act(async () => reconnect.click());
    await vi.waitFor(() => expect(noVncState.instances).toHaveLength(2));
    const next = noVncState.instances[1]!;
    await act(async () => next.emit("connect"));
    expect(next.viewOnly).toBe(true);
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(createRemoteSession).toHaveBeenLastCalledWith("session-token", "organization-1", "computer-1", expect.objectContaining({ reconnectSessionId: ticket.session.id }));
    await act(async () => control.click());
    await act(async () => rfb.emit("disconnect"));
    expect(next.viewOnly).toBe(false);
    await cleanup();
    expect(remoteDesktopCapturesKeyboard()).toBe(false);
  });

  it("returns keyboard focus to control with Tab and reopens in view-only after Escape", async () => {
    const { cleanup, container, control, rfb } = await openScreen();
    expect(document.activeElement).toBe(control);
    await act(async () => control.click());
    rfb.focus();
    await act(async () => rfb.target.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(control);
    expect(rfb.inputs).toEqual([]);
    await act(async () => rfb.target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(rfb.viewOnly).toBe(true);
    const open = container.querySelector<HTMLButtonElement>('[aria-label="Open full screen"]')!;
    expect(document.activeElement).toBe(open);
    await act(async () => open.click());
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    expect(rfb.viewOnly).toBe(true);
    expect(createRemoteSession).toHaveBeenCalledTimes(1);
    expect(endRemoteSession).not.toHaveBeenCalled();
    await cleanup();
  });

  it("keeps the live screen when the DM roster resolves again", async () => {
    const { cleanup, root } = createReactTestRoot({ attachToDocument: true });
    const panel = () => (
      <I18nProvider>
        <DmComputerPanel
          agents={[dmAgent()]}
          organizationId="organization-1"
          services={services}
          token="session-token"
        />
      </I18nProvider>
    );
    await renderReactTestRoot(root, panel());
    await vi.waitFor(() => expect(noVncState.instances).toHaveLength(1));

    await renderReactTestRoot(root, panel());
    await flush();

    expect(createRemoteSession).toHaveBeenCalledTimes(1);
    expect(endRemoteSession).not.toHaveBeenCalled();
    expect(noVncState.instances).toHaveLength(1);
    await cleanup();
  });

  it("waits for a computer the previous screen is still releasing", async () => {
    createRemoteSession.mockRejectedValueOnce(
      new ApiError(
        409,
        "Managed computer is already being controlled",
        "MANAGED_COMPUTER_REMOTE_IN_USE",
      ),
    );
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <DmComputerPanel
          agents={[dmAgent()]}
          organizationId="organization-1"
          services={services}
          token="session-token"
        />
      </I18nProvider>,
    );

    await vi.waitFor(() => expect(noVncState.instances).toHaveLength(1), {
      timeout: 4_000,
    });
    expect(createRemoteSession).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("already being controlled");
    await cleanup();
  });
});
