import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  managedComputerRemoteHeartbeatRequest,
  managedComputerRemoteHeartbeatResponse,
} from "../../src/lib/managed-computer-remote-protocol";
import { ManagedComputerRemoteSessionHub } from "./managed-computer-remote-relay";

type Attachment = {
  role: "agent" | "controller";
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

class FakeWebSocketRequestResponsePair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
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
