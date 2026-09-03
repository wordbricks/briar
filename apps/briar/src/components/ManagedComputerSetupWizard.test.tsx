/** @vitest-environment jsdom */

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ManagedComputerSetupChallengeKind,
  ManagedComputerSetupChallengeSchema,
  ManagedComputerSetupChallengeService,
  ManagedComputerSetupCompleteSchema,
  ManagedComputerSetupToAgentSchema,
  ManagedComputerSetupToControllerSchema,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { ManagedComputerSetupWizard } from "./ManagedComputerSetupWizard";

type SocketListener = (event: { data?: unknown }) => void;

class FakeSetupSocket {
  static readonly OPEN = 1;
  static instances: FakeSetupSocket[] = [];

  binaryType: BinaryType = "blob";
  readyState = 0;
  readonly send = vi.fn();
  readonly close = vi.fn(() => {
    this.readyState = 3;
  });
  private readonly listeners = new Map<string, SocketListener[]>();

  constructor(
    readonly url: string,
    readonly protocol: string,
  ) {
    FakeSetupSocket.instances.push(this);
  }

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  open() {
    this.readyState = FakeSetupSocket.OPEN;
    for (const listener of this.listeners.get("open") ?? []) listener({});
  }

  message(data: ArrayBuffer) {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data });
    }
  }
}

afterEach(() => {
  FakeSetupSocket.instances = [];
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const computer = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  requesterUserId: "user-one",
  state: "needs_setup" as const,
  region: "us-east-1",
  instanceId: "i-example",
  volumeId: "vol-example",
  deviceId: "managed-11111111-1111-4111-8111-111111111111",
  error: null,
  retryCount: 0,
  retryAvailable: false,
  createdAt: "2026-08-29T00:00:00.000Z",
  expiresAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

describe("ManagedComputerSetupWizard", () => {
  it("offers Codex, Claude, Grok, and OpenCode from the first setup screen", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const { cleanup, root } = createReactTestRoot({ attachToDocument: true });
    await renderReactTestRoot(
      root,
      <ManagedComputerSetupWizard
        computer={computer}
        onComplete={vi.fn()}
        onOpenChange={vi.fn()}
        open
        organizationId={computer.organizationId}
        projects={[{
          id: "33333333-3333-4333-8333-333333333333",
          name: "Briar",
          issueKeyPrefix: "BR",
          scheduleTabEnabled: true,
          icon: null,
          iconName: null,
          iconColor: null,
          organizationId: computer.organizationId,
          organizationName: "Briar",
          role: "owner",
          createdAt: "2026-08-29T00:00:00.000Z",
        }]}
        token="user-token"
      />,
    );

    const providerRadios = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    expect(providerRadios.map((radio) => radio.textContent)).toEqual([
      expect.stringContaining("Codex"),
      expect.stringContaining("Claude"),
      expect.stringContaining("Grok"),
      expect.stringContaining("OpenCode"),
    ]);
    expect(providerRadios[0]?.getAttribute("aria-checked")).toBe("true");
    await act(async () => providerRadios[3]?.click());
    expect(providerRadios[3]?.getAttribute("aria-checked")).toBe("true");

    await cleanup();
  });

  it("uses generated binary frames for start, challenge, and completion", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("WebSocket", FakeSetupSocket);
    const createSetupSession = vi.fn(async () => ({
      session: {
        id: "44444444-4444-4444-8444-444444444444",
        managedComputerId: computer.id,
        organizationId: computer.organizationId,
        teamId: "33333333-3333-4333-8333-333333333333",
        status: "pending" as const,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      setupToken: `briar_setup_${"a".repeat(43)}`,
      socket: {
        url: "wss://worker.example/setup",
        protocol: "briar-setup-v1.token",
      },
      agentConnected: true,
      duplicate: false,
    }));
    const onComplete = vi.fn();
    const { cleanup, root } = createReactTestRoot({ attachToDocument: true });
    await renderReactTestRoot(
      root,
      <ManagedComputerSetupWizard
        computer={computer}
        createSetupSession={createSetupSession}
        onComplete={onComplete}
        onOpenChange={vi.fn()}
        open
        organizationId={computer.organizationId}
        projects={[{
          id: "33333333-3333-4333-8333-333333333333",
          name: "Briar",
          issueKeyPrefix: "BR",
          scheduleTabEnabled: true,
          icon: null,
          iconName: null,
          iconColor: null,
          organizationId: computer.organizationId,
          organizationName: "Briar",
          role: "owner",
          createdAt: "2026-08-29T00:00:00.000Z",
        }]}
        token="user-token"
      />,
    );

    const start = Array.from(document.querySelectorAll("button")).find(
      (button) => /(?:설정 시작|Start setup|开始设置)/u.test(button.textContent ?? ""),
    )!;
    await act(async () => start.click());
    const socket = FakeSetupSocket.instances[0]!;
    expect(socket.binaryType).toBe("arraybuffer");
    await act(async () => socket.open());
    const startFrame = socket.send.mock.calls[0]![0] as Uint8Array;
    expect(fromBinary(ManagedComputerSetupToAgentSchema, startFrame).payload)
      .toMatchObject({
        case: "start",
        value: {
          setupToken: `briar_setup_${"a".repeat(43)}`,
          provider: AgentProvider.CODEX,
        },
      });

    const challenge = toBinary(
      ManagedComputerSetupToControllerSchema,
      create(ManagedComputerSetupToControllerSchema, {
        payload: {
          case: "challenge",
          value: create(ManagedComputerSetupChallengeSchema, {
            challengeId: "codex-auth",
            service: ManagedComputerSetupChallengeService.PROVIDER,
            kind: ManagedComputerSetupChallengeKind.API_KEY,
            verificationUri: "https://opencode.ai/auth",
            provider: AgentProvider.CODEX,
          }),
        },
      }),
    );
    await act(async () => socket.message(new Uint8Array(challenge).buffer));
    expect(document.querySelector("#managed-setup-credential")).not.toBeNull();

    const complete = toBinary(
      ManagedComputerSetupToControllerSchema,
      create(ManagedComputerSetupToControllerSchema, {
        payload: {
          case: "complete",
          value: create(ManagedComputerSetupCompleteSchema, {
            teamId: "33333333-3333-4333-8333-333333333333",
            provider: AgentProvider.CODEX,
            workerId: "worker-1",
          }),
        },
      }),
    );
    await act(async () => socket.message(new Uint8Array(complete).buffer));
    expect(onComplete).toHaveBeenCalledOnce();

    await cleanup();
  });
});
