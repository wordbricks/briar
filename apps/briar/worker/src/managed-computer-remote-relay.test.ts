import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ManagedComputerSetupChallengeKind,
  ManagedComputerSetupChallengeSchema,
  ManagedComputerSetupChallengeService,
  ManagedComputerSetupCompleteSchema,
  ManagedComputerSetupControllerReadySchema,
  ManagedComputerSetupStartSchema,
  ManagedComputerSetupSubmitSchema,
  ManagedComputerSetupToAgentSchema,
  ManagedComputerSetupToControllerSchema,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  managedComputerRemoteHeartbeatRequest,
  managedComputerRemoteHeartbeatResponse,
} from "../../src/lib/managed-computer-remote-protocol";
import { ManagedComputerRemoteSessionHub } from "./managed-computer-remote-relay";

type Attachment = {
  role: "agent" | "controller" | "setup-agent" | "setup-controller";
  sessionId: string | null;
  connectionGeneration: number;
  maxExpiresAt: string | null;
  controllerBytes: number;
  screenBytes: number;
};

class FakeSocket {
  readyState = 1;
  sent: Array<string | ArrayBuffer> = [];
  close = vi.fn();

  constructor(private state: Attachment) {}

  deserializeAttachment() {
    return this.state;
  }

  serializeAttachment(next: Attachment) {
    this.state = next;
  }

  send(value: string | ArrayBuffer) {
    this.sent.push(value);
  }
}

const binaryFrame = (bytes: Uint8Array): ArrayBuffer =>
  new Uint8Array(bytes).buffer;

const setupStartFrame = () => binaryFrame(toBinary(
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
));

const setupSubmitFrame = () => binaryFrame(toBinary(
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
));

const forgedSetupReadyFrame = () => binaryFrame(toBinary(
  ManagedComputerSetupToAgentSchema,
  create(ManagedComputerSetupToAgentSchema, {
    payload: {
      case: "controllerReady",
      value: create(ManagedComputerSetupControllerReadySchema, {
        sessionId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  }),
));

const setupChallengeFrame = () => binaryFrame(toBinary(
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
));

const setupCompleteFrame = () => binaryFrame(toBinary(
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
));

class FakeWebSocketRequestResponsePair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}

class FakeWebSocketPair {
  readonly 0: FakeSocket;
  readonly 1: FakeSocket;

  constructor() {
    const initial = {
      role: "setup-controller" as const,
      sessionId: null,
      connectionGeneration: 0,
      maxExpiresAt: null,
      controllerBytes: 0,
      screenBytes: 0,
    };
    this[0] = new FakeSocket(initial);
    this[1] = new FakeSocket(initial);
  }
}

class FakeUpgradeResponse {
  readonly status: number;

  constructor(
    _body: BodyInit | null,
    init: ResponseInit & { webSocket?: WebSocket },
  ) {
    this.status = init.status ?? 200;
  }
}

beforeEach(() => {
  vi.stubGlobal(
    "WebSocketRequestResponsePair",
    FakeWebSocketRequestResponsePair,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ManagedComputerRemoteSessionHub", () => {
  it("answers agent heartbeats without waking the relay", () => {
    const setWebSocketAutoResponse = vi.fn();
    new ManagedComputerRemoteSessionHub(
      {
        getWebSockets: () => [],
        setWebSocketAutoResponse,
      } as unknown as DurableObjectState,
      {} as Env,
    );

    expect(setWebSocketAutoResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        request: managedComputerRemoteHeartbeatRequest,
        response: managedComputerRemoteHeartbeatResponse,
      }),
    );
  });

  it("relays only binary RFB frames between one controller and one agent", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const controller = new FakeSocket({
      role: "controller",
      sessionId,
      connectionGeneration: 1,
      maxExpiresAt: "2099-01-01T00:00:00.000Z",
      controllerBytes: 0,
      screenBytes: 0,
    });
    const agent = new FakeSocket({
      role: "agent",
      sessionId: null,
      connectionGeneration: 0,
      maxExpiresAt: null,
      controllerBytes: 0,
      screenBytes: 0,
    });
    const hub = new ManagedComputerRemoteSessionHub(
      {
        getWebSockets: (tag?: string) =>
          tag === "agent"
            ? [agent]
            : tag === "controller"
              ? [controller]
              : [agent, controller],
        setWebSocketAutoResponse: vi.fn(),
      } as unknown as DurableObjectState,
      {} as Env,
    );
    const input = new Uint8Array([1, 2, 3]).buffer;
    const screen = new Uint8Array([4, 5, 6, 7]).buffer;
    await hub.webSocketMessage(controller as unknown as WebSocket, input);
    await hub.webSocketMessage(agent as unknown as WebSocket, screen);
    expect(agent.sent).toEqual([input]);
    expect(controller.sent).toEqual([screen]);
    expect(controller.deserializeAttachment()).toMatchObject({
      controllerBytes: 3,
      screenBytes: 4,
    });
  });

  it("never forwards text payloads from either side", async () => {
    const controller = new FakeSocket({
      role: "controller",
      sessionId: "11111111-1111-4111-8111-111111111111",
      connectionGeneration: 1,
      maxExpiresAt: "2099-01-01T00:00:00.000Z",
      controllerBytes: 0,
      screenBytes: 0,
    });
    const agent = new FakeSocket({
      role: "agent",
      sessionId: null,
      connectionGeneration: 0,
      maxExpiresAt: null,
      controllerBytes: 0,
      screenBytes: 0,
    });
    const hub = new ManagedComputerRemoteSessionHub(
      {
        getWebSockets: (tag?: string) =>
          tag === "agent"
            ? [agent]
            : tag === "controller"
              ? [controller]
              : [agent, controller],
        setWebSocketAutoResponse: vi.fn(),
      } as unknown as DurableObjectState,
      {} as Env,
    );
    await hub.webSocketMessage(controller as unknown as WebSocket, "secret");
    expect(controller.close).toHaveBeenCalledWith(
      1008,
      "Remote desktop input must be binary",
    );
    expect(agent.sent).toEqual([]);

    await hub.webSocketMessage(agent as unknown as WebSocket, "display_error");
    expect(controller.close).toHaveBeenCalledWith(
      1011,
      "Remote display unavailable",
    );
  });

  it("relays a validated binary challenge and completion flow", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const controller = new FakeSocket({
      role: "setup-controller",
      sessionId,
      connectionGeneration: 0,
      maxExpiresAt: "2099-01-01T00:00:00.000Z",
      controllerBytes: 0,
      screenBytes: 0,
    });
    const agent = new FakeSocket({
      role: "setup-agent",
      sessionId: null,
      connectionGeneration: 0,
      maxExpiresAt: null,
      controllerBytes: 0,
      screenBytes: 0,
    });
    const hub = new ManagedComputerRemoteSessionHub(
      {
        getWebSockets: (tag?: string) =>
          tag === "setup-agent"
            ? [agent]
            : tag === "setup-controller"
              ? [controller]
              : [agent, controller],
        setWebSocketAutoResponse: vi.fn(),
      } as unknown as DurableObjectState,
      {} as Env,
    );
    const start = setupStartFrame();
    const challenge = setupChallengeFrame();
    const submit = setupSubmitFrame();
    const complete = setupCompleteFrame();
    await hub.webSocketMessage(controller as unknown as WebSocket, start);
    await hub.webSocketMessage(agent as unknown as WebSocket, challenge);
    await hub.webSocketMessage(controller as unknown as WebSocket, submit);
    await hub.webSocketMessage(agent as unknown as WebSocket, complete);

    expect(agent.sent).toEqual([start, submit]);
    expect(controller.sent).toEqual([challenge, complete]);
    expect(agent.sent.map((frame) =>
      typeof frame === "string"
        ? null
        : fromBinary(
          ManagedComputerSetupToAgentSchema,
          new Uint8Array(frame),
        ).payload.case
    )).toEqual(["start", "submit"]);
    expect(controller.sent.map((frame) =>
      typeof frame === "string"
        ? null
        : fromBinary(
          ManagedComputerSetupToControllerSchema,
          new Uint8Array(frame),
        ).payload.case
    )).toEqual(["challenge", "complete"]);
  });

  it("rejects wrong-direction, malformed, and non-heartbeat text frames", async () => {
    const controller = new FakeSocket({
      role: "setup-controller",
      sessionId: "11111111-1111-4111-8111-111111111111",
      connectionGeneration: 0,
      maxExpiresAt: "2099-01-01T00:00:00.000Z",
      controllerBytes: 0,
      screenBytes: 0,
    });
    const agent = new FakeSocket({
      role: "setup-agent",
      sessionId: null,
      connectionGeneration: 0,
      maxExpiresAt: null,
      controllerBytes: 0,
      screenBytes: 0,
    });
    const hub = new ManagedComputerRemoteSessionHub(
      {
        getWebSockets: (tag?: string) =>
          tag === "setup-agent"
            ? [agent]
            : tag === "setup-controller"
              ? [controller]
              : [agent, controller],
        setWebSocketAutoResponse: vi.fn(),
      } as unknown as DurableObjectState,
      {} as Env,
    );

    await hub.webSocketMessage(
      agent as unknown as WebSocket,
      setupStartFrame(),
    );
    expect(agent.close).toHaveBeenCalledWith(
      1008,
      "Managed setup message is invalid",
    );
    expect(controller.sent).toEqual([]);

    await hub.webSocketMessage(
      controller as unknown as WebSocket,
      forgedSetupReadyFrame(),
    );
    expect(controller.close).toHaveBeenCalledWith(
      1008,
      "Managed setup message is invalid",
    );
    expect(agent.sent).toEqual([]);

    await hub.webSocketMessage(controller as unknown as WebSocket, "not-json");
    expect(controller.close).toHaveBeenCalledWith(
      1008,
      "Managed setup control messages must be binary",
    );

    await hub.webSocketMessage(
      controller as unknown as WebSocket,
      new Uint8Array([0xff]).buffer,
    );
    expect(controller.close).toHaveBeenCalledWith(
      1008,
      "Managed setup message is malformed",
    );
  });

  it("emits protobuf controller-ready and controller-ended relay controls", async () => {
    vi.stubGlobal("WebSocketPair", FakeWebSocketPair);
    vi.stubGlobal("Response", FakeUpgradeResponse);
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const agent = new FakeSocket({
      role: "setup-agent",
      sessionId: null,
      connectionGeneration: 0,
      maxExpiresAt: null,
      controllerBytes: 0,
      screenBytes: 0,
    });
    const acceptWebSocket = vi.fn();
    const hub = new ManagedComputerRemoteSessionHub(
      {
        getWebSockets: (tag?: string) => tag === "setup-agent" ? [agent] : [],
        setWebSocketAutoResponse: vi.fn(),
        acceptWebSocket,
      } as unknown as DurableObjectState,
      {} as Env,
    );

    const response = await hub.fetch(new Request(
      "https://managed-computer-remote.internal/connect",
      {
        headers: {
          Upgrade: "websocket",
          "X-Briar-Remote-Role": "setup-controller",
          "X-Briar-Setup-Session": sessionId,
          "X-Briar-Setup-Expires-At": "2099-01-01T00:00:00.000Z",
          "X-Briar-Remote-Protocol": "briar-setup-v1.token",
        },
      },
    ));
    expect(response.status).toBe(101);
    const controller = acceptWebSocket.mock.calls[0]![0] as FakeSocket;

    await hub.webSocketClose(
      controller as unknown as WebSocket,
      1000,
      "done",
      true,
    );

    expect(agent.sent.map((frame) => {
      if (typeof frame === "string") return null;
      const decoded = fromBinary(
        ManagedComputerSetupToAgentSchema,
        new Uint8Array(frame),
      );
      return decoded.payload.case === "controllerReady" ||
          decoded.payload.case === "controllerEnded"
        ? [decoded.payload.case, decoded.payload.value.sessionId]
        : null;
    })).toEqual([
      ["controllerReady", sessionId],
      ["controllerEnded", sessionId],
    ]);
  });

  it("keeps the controller alive when an agent socket is replaced", async () => {
    const controller = new FakeSocket({
      role: "controller",
      sessionId: "11111111-1111-4111-8111-111111111111",
      connectionGeneration: 2,
      maxExpiresAt: "2099-01-01T00:00:00.000Z",
      controllerBytes: 0,
      screenBytes: 0,
    });
    const oldAgent = new FakeSocket({
      role: "agent",
      sessionId: null,
      connectionGeneration: 0,
      maxExpiresAt: null,
      controllerBytes: 0,
      screenBytes: 0,
    });
    oldAgent.readyState = 3;
    const replacementAgent = new FakeSocket({
      role: "agent",
      sessionId: null,
      connectionGeneration: 0,
      maxExpiresAt: null,
      controllerBytes: 0,
      screenBytes: 0,
    });
    const hub = new ManagedComputerRemoteSessionHub(
      {
        getWebSockets: (tag?: string) =>
          tag === "agent"
            ? [oldAgent, replacementAgent]
            : tag === "controller"
              ? [controller]
              : [oldAgent, replacementAgent, controller],
        setWebSocketAutoResponse: vi.fn(),
      } as unknown as DurableObjectState,
      {} as Env,
    );
    await hub.webSocketClose(
      oldAgent as unknown as WebSocket,
      4001,
      "replaced",
      true,
    );
    expect(controller.close).not.toHaveBeenCalled();
  });

  it("rejects oversized binary frames before forwarding them", async () => {
    const controller = new FakeSocket({
      role: "controller",
      sessionId: "11111111-1111-4111-8111-111111111111",
      connectionGeneration: 1,
      maxExpiresAt: "2099-01-01T00:00:00.000Z",
      controllerBytes: 0,
      screenBytes: 0,
    });
    const agent = new FakeSocket({
      role: "agent",
      sessionId: null,
      connectionGeneration: 0,
      maxExpiresAt: null,
      controllerBytes: 0,
      screenBytes: 0,
    });
    const hub = new ManagedComputerRemoteSessionHub(
      {
        getWebSockets: (tag?: string) =>
          tag === "agent"
            ? [agent]
            : tag === "controller"
              ? [controller]
              : [agent, controller],
        setWebSocketAutoResponse: vi.fn(),
      } as unknown as DurableObjectState,
      {} as Env,
    );
    await hub.webSocketMessage(
      controller as unknown as WebSocket,
      new ArrayBuffer(8 * 1024 * 1024 + 1),
    );
    expect(controller.close).toHaveBeenCalledWith(
      1009,
      "Remote desktop frame is too large",
    );
    expect(agent.sent).toEqual([]);
  });
});
