import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ManagedComputerSetupChallengeKind,
  ManagedComputerSetupChallengeSchema,
  ManagedComputerSetupChallengeService,
  ManagedComputerSetupCompleteSchema,
  ManagedComputerSetupStartSchema,
  ManagedComputerSetupSubmitSchema,
  ManagedComputerSetupToAgentSchema,
  ManagedComputerSetupToControllerSchema,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  encodeManagedComputerRemoteAgentControlFrame,
  managedComputerRemoteHeartbeatRequest,
  managedComputerRemoteHeartbeatResponse,
} from "../../src/lib/managed-computer-remote-protocol";
import type { ManagedComputerRemoteSessionHub } from "./managed-computer-remote-relay";

type Role = "agent" | "controller" | "setup-agent" | "setup-controller";

type Attachment = {
  role: Role;
  sessionId: string | null;
  connectionGeneration: number;
  maxExpiresAt: string | null;
  controllerBytes: number;
  screenBytes: number;
  agentId: string | null;
};

const sessionId = "11111111-1111-4111-8111-111111111111";

const setupStartFrame = () => toBinary(
  ManagedComputerSetupToAgentSchema,
  create(ManagedComputerSetupToAgentSchema, {
    payload: {
      case: "start",
      value: create(ManagedComputerSetupStartSchema, {
        setupToken: `briar_setup_${"a".repeat(43)}`,
        provider: AgentProvider.CODEX,
      }),
    },
  }),
);

const setupSubmitFrame = () => toBinary(
  ManagedComputerSetupToAgentSchema,
  create(ManagedComputerSetupToAgentSchema, {
    payload: {
      case: "submit",
      value: create(ManagedComputerSetupSubmitSchema, {
        challengeId: "codex-auth",
        value: "ABCD-EFGH",
      }),
    },
  }),
);

const setupChallengeFrame = () => toBinary(
  ManagedComputerSetupToControllerSchema,
  create(ManagedComputerSetupToControllerSchema, {
    payload: {
      case: "challenge",
      value: create(ManagedComputerSetupChallengeSchema, {
        challengeId: "codex-auth",
        service: ManagedComputerSetupChallengeService.PROVIDER,
        kind: ManagedComputerSetupChallengeKind.DEVICE_CODE,
        verificationUri: "https://auth.openai.com/activate",
        userCode: "ABCD-EFGH",
        provider: AgentProvider.CODEX,
      }),
    },
  }),
);

const setupCompleteFrame = () => toBinary(
  ManagedComputerSetupToControllerSchema,
  create(ManagedComputerSetupToControllerSchema, {
    payload: {
      case: "complete",
      value: create(ManagedComputerSetupCompleteSchema, {
        projectId: "22222222-2222-4222-8222-222222222222",
        provider: AgentProvider.CODEX,
        workerId: "worker-1",
      }),
    },
  }),
);

function responseWebSocket(response: Response) {
  const socket = response.webSocket;
  if (!socket) throw new TypeError("Expected WebSocket upgrade response");
  socket.accept();
  return socket;
}

function waitForMessage(socket: WebSocket) {
  return new Promise<string | ArrayBuffer>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 5_000);
    socket.addEventListener("message", (event) => {
      clearTimeout(timeout);
      const data: unknown = event.data;
      if (typeof data === "string" || data instanceof ArrayBuffer) {
        resolve(data);
        return;
      }
      if (ArrayBuffer.isView(data)) {
        resolve(new Uint8Array(
          data.buffer,
          data.byteOffset,
          data.byteLength,
        ).slice().buffer);
        return;
      }
      if (data instanceof Blob) {
        void data.arrayBuffer().then(resolve, reject);
        return;
      }
      reject(new TypeError(
        `Unexpected WebSocket message type: ${Object.prototype.toString.call(data)}`,
      ));
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket failed while waiting for message"));
    }, { once: true });
  });
}

function waitForClose(socket: WebSocket) {
  return new Promise<{ code: number; reason: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for WebSocket close"));
    }, 5_000);
    socket.addEventListener("close", (event) => {
      clearTimeout(timeout);
      resolve({ code: event.code, reason: event.reason });
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket failed while waiting for close"));
    }, { once: true });
  });
}

function binaryMessage(message: string | ArrayBuffer) {
  if (typeof message === "string") {
    throw new TypeError("Expected binary WebSocket message");
  }
  return new Uint8Array(message);
}

async function connectSetupAgent(
  stub: DurableObjectStub<ManagedComputerRemoteSessionHub>,
) {
  return responseWebSocket(await stub.fetch(
    "https://managed-computer-remote.internal/connect",
    {
      headers: {
        Upgrade: "websocket",
        "X-Briar-Remote-Role": "setup-agent",
        "X-Briar-Remote-Protocol": "briar-setup-agent-v1.token",
      },
    },
  ));
}

async function connectSetupController(
  stub: DurableObjectStub<ManagedComputerRemoteSessionHub>,
) {
  return responseWebSocket(await stub.fetch(
    "https://managed-computer-remote.internal/connect",
    {
      headers: {
        Upgrade: "websocket",
        "X-Briar-Remote-Role": "setup-controller",
        "X-Briar-Setup-Session": sessionId,
        "X-Briar-Setup-Expires-At": "2099-01-01T00:00:00.000Z",
        "X-Briar-Remote-Protocol": "briar-setup-controller-v1.token",
      },
    },
  ));
}

function attachSocket(
  state: DurableObjectState,
  role: Role,
  overrides: Partial<Attachment> = {},
) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  state.acceptWebSocket(server, [role]);
  server.serializeAttachment({
    role,
    sessionId: null,
    connectionGeneration: 0,
    maxExpiresAt: null,
    controllerBytes: 0,
    screenBytes: 0,
    agentId: null,
    ...overrides,
  } satisfies Attachment);
  client.accept();
  return { client, server };
}

describe("ManagedComputerRemoteSessionHub", () => {
  it("runs the authenticated protobuf setup lifecycle over real hibernatable sockets", async () => {
    const stub = env.MANAGED_COMPUTER_REMOTE.getByName(crypto.randomUUID());
    const agent = await connectSetupAgent(stub);

    const heartbeat = waitForMessage(agent);
    agent.send(managedComputerRemoteHeartbeatRequest);
    await expect(heartbeat).resolves.toBe(managedComputerRemoteHeartbeatResponse);

    const ready = waitForMessage(agent);
    const controller = await connectSetupController(stub);
    expect(fromBinary(
      ManagedComputerSetupToAgentSchema,
      binaryMessage(await ready),
    ).payload.case).toBe("controllerReady");

    const start = waitForMessage(agent);
    controller.send(setupStartFrame());
    expect(fromBinary(
      ManagedComputerSetupToAgentSchema,
      binaryMessage(await start),
    ).payload.case).toBe("start");

    const challenge = waitForMessage(controller);
    agent.send(setupChallengeFrame());
    expect(fromBinary(
      ManagedComputerSetupToControllerSchema,
      binaryMessage(await challenge),
    ).payload.case).toBe("challenge");

    const submit = waitForMessage(agent);
    controller.send(setupSubmitFrame());
    expect(fromBinary(
      ManagedComputerSetupToAgentSchema,
      binaryMessage(await submit),
    ).payload.case).toBe("submit");

    const complete = waitForMessage(controller);
    agent.send(setupCompleteFrame());
    expect(fromBinary(
      ManagedComputerSetupToControllerSchema,
      binaryMessage(await complete),
    ).payload.case).toBe("complete");

    const ended = waitForMessage(agent);
    controller.close(1000, "done");
    expect(fromBinary(
      ManagedComputerSetupToAgentSchema,
      binaryMessage(await ended),
    ).payload.case).toBe("controllerEnded");
    agent.close(1000, "done");
  });

  it("rejects a valid protobuf message sent by the unauthorized direction", async () => {
    const stub = env.MANAGED_COMPUTER_REMOTE.getByName(crypto.randomUUID());
    const agent = await connectSetupAgent(stub);
    const controller = await connectSetupController(stub);
    const closed = waitForClose(agent);

    agent.send(setupStartFrame());

    await expect(closed).resolves.toEqual({
      code: 1008,
      reason: "Managed setup message is invalid",
    });
    controller.close(1000, "done");
  });

  it("relays only bounded binary RFB frames in both directions", async () => {
    const stub = env.MANAGED_COMPUTER_REMOTE.getByName(crypto.randomUUID());
    const result = await runInDurableObject(
      stub,
      async (hub: ManagedComputerRemoteSessionHub, state) => {
        const controller = attachSocket(state, "controller", {
          sessionId,
          connectionGeneration: 1,
          maxExpiresAt: "2099-01-01T00:00:00.000Z",
        });
        const agent = attachSocket(state, "agent");

        const agentInput = waitForMessage(agent.client);
        await hub.webSocketMessage(
          controller.server,
          new Uint8Array([1, 2, 3]).buffer,
        );
        const forwardedInput = [...binaryMessage(await agentInput)];

        const controllerScreen = waitForMessage(controller.client);
        await hub.webSocketMessage(
          agent.server,
          new Uint8Array([4, 5, 6, 7]).buffer,
        );
        const forwardedScreen = [...binaryMessage(await controllerScreen)];
        const transferred = controller.server
          .deserializeAttachment() as Attachment;

        const textClose = waitForClose(controller.client);
        await hub.webSocketMessage(controller.server, "secret");
        const textRejection = await textClose;

        const oversized = attachSocket(state, "controller", {
          sessionId,
          connectionGeneration: 2,
          maxExpiresAt: "2099-01-01T00:00:00.000Z",
        });
        const oversizedClose = waitForClose(oversized.client);
        await hub.webSocketMessage(
          oversized.server,
          new ArrayBuffer(8 * 1024 * 1024 + 1),
        );
        const oversizedRejection = await oversizedClose;
        agent.client.close(1000, "done");
        return {
          forwardedInput,
          forwardedScreen,
          textRejection,
          oversizedRejection,
          byteCounts: {
            controller: transferred.controllerBytes,
            screen: transferred.screenBytes,
          },
        };
      },
    );

    expect(result).toEqual({
      forwardedInput: [1, 2, 3],
      forwardedScreen: [4, 5, 6, 7],
      textRejection: {
        code: 1008,
        reason: "Remote desktop input must be binary",
      },
      oversizedRejection: {
        code: 1009,
        reason: "Remote desktop frame is too large",
      },
      byteCounts: { controller: 3, screen: 4 },
    });
  });

  it("accepts only typed agent failures for the latest matching controller", async () => {
    const stub = env.MANAGED_COMPUTER_REMOTE.getByName(crypto.randomUUID());
    const result = await runInDurableObject(
      stub,
      async (hub: ManagedComputerRemoteSessionHub, state) => {
        const stale = attachSocket(state, "controller", {
          sessionId,
          connectionGeneration: 1,
          maxExpiresAt: "2099-01-01T00:00:00.000Z",
        });
        const current = attachSocket(state, "controller", {
          sessionId,
          connectionGeneration: 2,
          maxExpiresAt: "2099-01-01T00:00:00.000Z",
        });
        const agent = attachSocket(state, "agent");

        await hub.webSocketMessage(
          agent.server,
          encodeManagedComputerRemoteAgentControlFrame({
            type: "display_error",
            sessionId: "22222222-2222-4222-8222-222222222222",
            code: "display_closed",
          }),
        );
        const unmatchedControllerState = current.client.readyState;

        const currentClose = waitForClose(current.client);
        await hub.webSocketMessage(
          agent.server,
          encodeManagedComputerRemoteAgentControlFrame({
            type: "display_error",
            sessionId,
            code: "display_closed",
          }),
        );
        const matchedRejection = await currentClose;
        const staleControllerState = stale.client.readyState;

        const agentClose = waitForClose(agent.client);
        await hub.webSocketMessage(
          agent.server,
          JSON.stringify({
            type: "display_error",
            sessionId,
            code: "display_closed",
            injected: true,
          }),
        );
        const forgedRejection = await agentClose;
        stale.client.close(1000, "done");

        return {
          unmatchedControllerState,
          staleControllerState,
          matchedRejection,
          forgedRejection,
        };
      },
    );

    expect(result).toEqual({
      unmatchedControllerState: WebSocket.OPEN,
      staleControllerState: WebSocket.OPEN,
      matchedRejection: {
        code: 1011,
        reason: "Remote display unavailable",
      },
      forgedRejection: {
        code: 1008,
        reason: "Remote display control is invalid",
      },
    });
  });
});
