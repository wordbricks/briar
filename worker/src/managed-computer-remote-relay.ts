import { DurableObject } from "cloudflare:workers";
import {
  expireManagedComputerRemoteSession,
  markManagedComputerRemoteSessionConnected,
  markManagedComputerRemoteSessionDisconnected,
  recordManagedComputerRemoteAuditEvent,
} from "./managed-computer-remote-repository";

type RemoteSocketAttachment = {
  role: "agent" | "controller";
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

function messageSize(message: string | ArrayBuffer) {
  return typeof message === "string"
    ? new TextEncoder().encode(message).byteLength
    : message.byteLength;
}

function attachment(socket: WebSocket) {
  return socket.deserializeAttachment() as RemoteSocketAttachment | null;
}

export class ManagedComputerRemoteSessionHub extends DurableObject<Env> {
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
    return new Response("Invalid remote role", { status: 400 });
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
    if (current?.role === "controller") {
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
