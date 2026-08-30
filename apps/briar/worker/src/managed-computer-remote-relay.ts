import { DurableObject } from "cloudflare:workers";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ManagedComputerSetupControllerEndedSchema,
  ManagedComputerSetupControllerReadySchema,
  ManagedComputerSetupToAgentSchema,
  ManagedComputerSetupToControllerSchema,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import {
  isManagedComputerSetupControllerCommand,
  isManagedComputerSetupToController,
} from "../../src/lib/managed-computer-setup-codec";
import {
  managedComputerRemoteHeartbeatRequest,
  managedComputerRemoteHeartbeatResponse,
} from "../../src/lib/managed-computer-remote-protocol";
import {
  expireManagedComputerRemoteSession,
  markManagedComputerRemoteSessionConnected,
  markManagedComputerRemoteSessionDisconnected,
  recordManagedComputerRemoteAuditEvent,
} from "./managed-computer-remote-repository";

type RemoteSocketAttachment = {
  role: "agent" | "controller" | "setup-agent" | "setup-controller";
  sessionId: string | null;
  connectionGeneration: number;
  maxExpiresAt: string | null;
  controllerBytes: number;
  screenBytes: number;
};

type ActiveRemoteSession = {
  sessionId: string;
  organizationId: string;
  managedComputerId: string;
  controllerUserId: string;
  maxExpiresAt: string;
};

const activeSessionStorageKey = "active-session";
const socketOpen = 1;
const maxRemoteFrameBytes = 8 * 1024 * 1024;
const maxSetupFrameBytes = 64 * 1024;

function messageSize(message: string | ArrayBuffer) {
  return typeof message === "string"
    ? new TextEncoder().encode(message).byteLength
    : message.byteLength;
}

function attachment(socket: WebSocket) {
  return socket.deserializeAttachment() as RemoteSocketAttachment | null;
}

function setupControllerControlFrame(
  control: "ready" | "ended",
  sessionId: string,
): ArrayBuffer {
  const message = create(ManagedComputerSetupToAgentSchema, {
    payload: control === "ready"
      ? {
        case: "controllerReady",
        value: create(ManagedComputerSetupControllerReadySchema, { sessionId }),
      }
      : {
        case: "controllerEnded",
        value: create(ManagedComputerSetupControllerEndedSchema, { sessionId }),
      },
  });
  return new Uint8Array(toBinary(ManagedComputerSetupToAgentSchema, message))
    .buffer;
}

export class ManagedComputerRemoteSessionHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        managedComputerRemoteHeartbeatRequest,
        managedComputerRemoteHeartbeatResponse,
      ),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/status" && request.method === "GET") {
      return Response.json({
        agentConnected: this.ctx.getWebSockets("agent").some((socket) =>
          socket.readyState === socketOpen
        ),
        controllerConnected: this.ctx.getWebSockets("controller").some(
          (socket) => socket.readyState === socketOpen,
        ),
        setupAgentConnected: this.ctx.getWebSockets("setup-agent").some(
          (socket) => socket.readyState === socketOpen,
        ),
        setupControllerConnected: this.ctx.getWebSockets("setup-controller")
          .some((socket) => socket.readyState === socketOpen),
      });
    }
    if (url.pathname === "/disconnect" && request.method === "POST") {
      for (const socket of this.ctx.getWebSockets()) {
        socket.close(4005, "Managed computer is no longer available");
      }
      await this.ctx.storage.delete(activeSessionStorageKey);
      await this.ctx.storage.deleteAlarm();
      return new Response(null, { status: 204 });
    }
    if (
      url.pathname === "/disconnect-controller" && request.method === "POST"
    ) {
      const sessionId = request.headers.get("X-Briar-Remote-Session") ?? "";
      for (const socket of this.ctx.getWebSockets("controller")) {
        if (attachment(socket)?.sessionId === sessionId) {
          socket.close(4000, "Remote desktop session ended");
        }
      }
      const active = await this.ctx.storage.get<ActiveRemoteSession>(
        activeSessionStorageKey,
      );
      if (active?.sessionId === sessionId) {
        await this.ctx.storage.delete(activeSessionStorageKey);
        await this.ctx.storage.deleteAlarm();
      }
      this.tellAgentSessionEnded(sessionId);
      return new Response(null, { status: 204 });
    }
    if (url.pathname !== "/connect" || request.method !== "GET") {
      return new Response("Not found", { status: 404 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const role = request.headers.get("X-Briar-Remote-Role");
    if (role === "agent") return this.connectAgent(request);
    if (role === "controller") return this.connectController(request);
    if (role === "setup-agent") return this.connectSetupAgent(request);
    if (role === "setup-controller") {
      return this.connectSetupController(request);
    }
    return new Response("Invalid remote role", { status: 400 });
  }

  private connectSetupAgent(request: Request) {
    const protocol = request.headers.get("X-Briar-Remote-Protocol") ?? "";
    if (!protocol) {
      return new Response("Missing setup agent protocol", { status: 400 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    for (const existing of this.ctx.getWebSockets("setup-agent")) {
      existing.close(4001, "Managed setup agent replaced");
    }
    this.ctx.acceptWebSocket(server, ["setup-agent"]);
    server.serializeAttachment({
      role: "setup-agent",
      sessionId: null,
      connectionGeneration: 0,
      maxExpiresAt: null,
      controllerBytes: 0,
      screenBytes: 0,
    } satisfies RemoteSocketAttachment);
    const controller = this.ctx.getWebSockets("setup-controller").find(
      (socket) => socket.readyState === socketOpen,
    );
    const current = controller ? attachment(controller) : null;
    if (current?.sessionId) {
      server.send(setupControllerControlFrame("ready", current.sessionId));
    }
    return new Response(null, {
      status: 101,
      headers: { "Sec-WebSocket-Protocol": protocol },
      webSocket: client,
    });
  }

  private connectSetupController(request: Request) {
    const sessionId = request.headers.get("X-Briar-Setup-Session") ?? "";
    const expiresAt = request.headers.get("X-Briar-Setup-Expires-At") ?? "";
    const protocol = request.headers.get("X-Briar-Remote-Protocol") ?? "";
    if (
      !sessionId || !Number.isFinite(Date.parse(expiresAt)) ||
      expiresAt <= new Date().toISOString() || !protocol
    ) {
      return new Response("Invalid setup session", { status: 400 });
    }
    const agent = this.ctx.getWebSockets("setup-agent").find((socket) =>
      socket.readyState === socketOpen
    );
    if (!agent) {
      return new Response("Managed setup agent offline", { status: 409 });
    }
    for (const existing of this.ctx.getWebSockets("setup-controller")) {
      existing.close(4002, "Setup controller replaced");
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["setup-controller"]);
    server.serializeAttachment({
      role: "setup-controller",
      sessionId,
      connectionGeneration: 0,
      maxExpiresAt: expiresAt,
      controllerBytes: 0,
      screenBytes: 0,
    } satisfies RemoteSocketAttachment);
    agent.send(setupControllerControlFrame("ready", sessionId));
    return new Response(null, {
      status: 101,
      headers: { "Sec-WebSocket-Protocol": protocol },
      webSocket: client,
    });
  }

  private connectAgent(request: Request) {
    const protocol = request.headers.get("X-Briar-Remote-Protocol") ?? "";
    if (!protocol) return new Response("Missing remote agent protocol", { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    for (const existing of this.ctx.getWebSockets("agent")) {
      existing.close(4001, "Remote display agent replaced");
    }
    this.ctx.acceptWebSocket(server, ["agent"]);
    server.serializeAttachment({
      role: "agent",
      sessionId: null,
      connectionGeneration: 0,
      maxExpiresAt: null,
      controllerBytes: 0,
      screenBytes: 0,
    } satisfies RemoteSocketAttachment);
    const controller = this.ctx.getWebSockets("controller")[0];
    const current = controller ? attachment(controller) : null;
    if (current?.sessionId) {
      server.send(JSON.stringify({
        type: "controller_ready",
        sessionId: current.sessionId,
      }));
    }
    return new Response(null, {
      status: 101,
      headers: { "Sec-WebSocket-Protocol": protocol },
      webSocket: client,
    });
  }

  private async connectController(request: Request) {
    const sessionId = request.headers.get("X-Briar-Remote-Session") ?? "";
    const connectionGeneration = Number(
      request.headers.get("X-Briar-Remote-Generation") ?? "0",
    );
    const maxExpiresAt = request.headers.get("X-Briar-Remote-Expires-At") ?? "";
    const protocol = request.headers.get("X-Briar-Remote-Protocol") ?? "";
    if (
      !sessionId || !Number.isSafeInteger(connectionGeneration) ||
      connectionGeneration < 1 || !Number.isFinite(Date.parse(maxExpiresAt)) ||
      maxExpiresAt <= new Date().toISOString() || !protocol
    ) {
      return new Response("Invalid remote session", { status: 400 });
    }
    const agent = this.ctx.getWebSockets("agent").find((socket) =>
      socket.readyState === socketOpen
    );
    if (!agent) return new Response("Remote display agent offline", { status: 409 });

    const connected = await markManagedComputerRemoteSessionConnected(
      this.env.DB,
      { sessionId, connectionGeneration, observedAt: new Date().toISOString() },
    );
    if (!connected) return new Response("Remote session is no longer active", { status: 409 });

    for (const existing of this.ctx.getWebSockets("controller")) {
      existing.close(4002, "Remote controller replaced by reconnect");
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["controller"]);
    server.serializeAttachment({
      role: "controller",
      sessionId,
      connectionGeneration,
      maxExpiresAt,
      controllerBytes: connected.controller_bytes,
      screenBytes: connected.screen_bytes,
    } satisfies RemoteSocketAttachment);
    const active = {
      sessionId,
      organizationId: connected.organization_id,
      managedComputerId: connected.managed_computer_id,
      controllerUserId: connected.controller_user_id,
      maxExpiresAt,
    } satisfies ActiveRemoteSession;
    await this.ctx.storage.put(activeSessionStorageKey, active);
    await this.ctx.storage.setAlarm(Date.parse(maxExpiresAt));
    await recordManagedComputerRemoteAuditEvent(this.env.DB, {
      organizationId: connected.organization_id,
      managedComputerId: connected.managed_computer_id,
      remoteSessionId: connected.id,
      actorUserId: connected.controller_user_id,
      action: "client_connected",
      occurredAt: new Date().toISOString(),
    });
    agent.send(JSON.stringify({ type: "controller_ready", sessionId }));
    return new Response(null, {
      status: 101,
      headers: { "Sec-WebSocket-Protocol": protocol },
      webSocket: client,
    });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const current = attachment(socket);
    if (!current) {
      socket.close(1008, "Missing remote socket authorization");
      return;
    }
    if (
      current.maxExpiresAt && current.maxExpiresAt <= new Date().toISOString()
    ) {
      socket.close(4006, "Remote desktop session expired");
      return;
    }
    if (
      current.role === "setup-agent" || current.role === "setup-controller"
    ) {
      if (typeof message === "string") {
        if (
          current.role === "setup-agent" &&
          message === managedComputerRemoteHeartbeatRequest
        ) {
          socket.send(managedComputerRemoteHeartbeatResponse);
          return;
        }
        socket.close(1008, "Managed setup control messages must be binary");
        return;
      }
      if (messageSize(message) > maxSetupFrameBytes) {
        socket.close(1009, "Managed setup message is too large");
        return;
      }
      try {
        const valid = current.role === "setup-agent"
          ? isManagedComputerSetupToController(fromBinary(
            ManagedComputerSetupToControllerSchema,
            new Uint8Array(message),
          ))
          : isManagedComputerSetupControllerCommand(fromBinary(
            ManagedComputerSetupToAgentSchema,
            new Uint8Array(message),
          ));
        if (!valid) {
          socket.close(1008, "Managed setup message is invalid");
          return;
        }
      } catch {
        socket.close(1008, "Managed setup message is malformed");
        return;
      }
      const targetRole = current.role === "setup-agent"
        ? "setup-controller"
        : "setup-agent";
      const target = this.ctx.getWebSockets(targetRole).find((candidate) =>
        candidate.readyState === socketOpen
      );
      if (!target) {
        if (current.role === "setup-controller") {
          socket.close(4004, "Managed setup agent offline");
        }
        return;
      }
      const targetState = attachment(target);
      if (
        targetState?.maxExpiresAt &&
        targetState.maxExpiresAt <= new Date().toISOString()
      ) {
        target.close(4006, "Managed setup session expired");
        return;
      }
      target.send(message);
      return;
    }
    if (messageSize(message) > maxRemoteFrameBytes) {
      socket.close(1009, "Remote desktop frame is too large");
      return;
    }
    if (current.role === "controller") {
      if (typeof message === "string") {
        socket.close(1008, "Remote desktop input must be binary");
        return;
      }
      const agent = this.ctx.getWebSockets("agent").find((candidate) =>
        candidate.readyState === socketOpen
      );
      if (!agent) {
        socket.close(4004, "Remote display agent offline");
        return;
      }
      agent.send(message);
      current.controllerBytes += messageSize(message);
      socket.serializeAttachment(current);
      return;
    }
    if (typeof message === "string") {
      for (const controller of this.ctx.getWebSockets("controller")) {
        controller.close(1011, "Remote display unavailable");
      }
      return;
    }
    const controller = this.ctx.getWebSockets("controller").find((candidate) =>
      candidate.readyState === socketOpen
    );
    if (!controller) return;
    controller.send(message);
    const controllerState = attachment(controller);
    if (controllerState) {
      controllerState.screenBytes += messageSize(message);
      controller.serializeAttachment(controllerState);
    }
  }

  async webSocketClose(
    socket: WebSocket,
    code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    const current = attachment(socket);
    if (!current) return;
    if (current.role === "setup-agent") {
      const replacement = this.ctx.getWebSockets("setup-agent").some(
        (candidate) => candidate !== socket && candidate.readyState === socketOpen,
      );
      if (replacement) return;
      for (const controller of this.ctx.getWebSockets("setup-controller")) {
        controller.close(4004, "Managed setup agent offline");
      }
      return;
    }
    if (current.role === "setup-controller") {
      if (!current.sessionId) return;
      for (const agent of this.ctx.getWebSockets("setup-agent")) {
        if (agent.readyState !== socketOpen) continue;
        agent.send(setupControllerControlFrame("ended", current.sessionId));
      }
      return;
    }
    if (current.role === "agent") {
      const replacement = this.ctx.getWebSockets("agent").some((candidate) =>
        candidate !== socket && candidate.readyState === socketOpen
      );
      if (replacement) return;
      for (const controller of this.ctx.getWebSockets("controller")) {
        controller.close(4004, "Remote display agent offline");
      }
      return;
    }
    if (!current.sessionId) return;
    const observedAt = new Date().toISOString();
    const disconnected = await markManagedComputerRemoteSessionDisconnected(
      this.env.DB,
      {
        sessionId: current.sessionId,
        connectionGeneration: current.connectionGeneration,
        reason: code === 4004 ? "agent_offline" : "client_disconnected",
        controllerBytes: current.controllerBytes,
        screenBytes: current.screenBytes,
        observedAt,
      },
    );
    if (disconnected) {
      await recordManagedComputerRemoteAuditEvent(this.env.DB, {
        organizationId: disconnected.organization_id,
        managedComputerId: disconnected.managed_computer_id,
        remoteSessionId: disconnected.id,
        actorUserId: disconnected.controller_user_id,
        action: "client_disconnected",
        reasonCode: disconnected.end_reason,
        controllerBytes: disconnected.controller_bytes,
        screenBytes: disconnected.screen_bytes,
        occurredAt: observedAt,
      });
    }
    if (disconnected) this.tellAgentSessionEnded(current.sessionId);
  }

  async webSocketError(socket: WebSocket) {
    const current = attachment(socket);
    socket.close(1011, "Remote socket error");
    if (
      current?.role === "controller" || current?.role === "setup-controller"
    ) {
      await this.webSocketClose(socket, 1011, "Remote socket error", false);
    }
  }

  async alarm() {
    const active = await this.ctx.storage.get<ActiveRemoteSession>(
      activeSessionStorageKey,
    );
    if (!active) return;
    if (active.maxExpiresAt > new Date().toISOString()) {
      await this.ctx.storage.setAlarm(Date.parse(active.maxExpiresAt));
      return;
    }
    const expired = await expireManagedComputerRemoteSession(
      this.env.DB,
      active.sessionId,
      new Date().toISOString(),
    );
    if (expired) {
      await recordManagedComputerRemoteAuditEvent(this.env.DB, {
        organizationId: expired.organization_id,
        managedComputerId: expired.managed_computer_id,
        remoteSessionId: expired.id,
        actorUserId: expired.controller_user_id,
        action: "session_expired",
        reasonCode: "max_lifetime",
        controllerBytes: expired.controller_bytes,
        screenBytes: expired.screen_bytes,
        occurredAt: new Date().toISOString(),
      });
    }
    for (const controller of this.ctx.getWebSockets("controller")) {
      controller.close(4006, "Remote desktop session expired");
    }
    this.tellAgentSessionEnded(active.sessionId);
    await this.ctx.storage.delete(activeSessionStorageKey);
  }

  private tellAgentSessionEnded(sessionId: string) {
    for (const agent of this.ctx.getWebSockets("agent")) {
      if (agent.readyState !== socketOpen) continue;
      agent.send(JSON.stringify({ type: "controller_ended", sessionId }));
    }
  }
}
