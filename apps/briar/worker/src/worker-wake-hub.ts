import {
  decodeWorkerWakeFrame,
  encodeWorkerWakeFrame,
  workerWakeHeartbeatRequest,
  workerWakeHeartbeatResponse,
  workerWakeProtocolHeader,
  type WorkerWakeReason,
} from "../../src/lib/worker-wake-protocol";

const socketOpen = 1;

const readyFrame = () => encodeWorkerWakeFrame({ type: "ready" });

/**
 * Workspace-scoped fan-out that tells connected execution Workers to claim
 * immediately instead of finishing their idle sleep.
 *
 * D1 stays authoritative for every queue: this object owns only hibernatable
 * sockets and keeps no storage, so an evicted hub costs a Worker one poll
 * interval rather than a lost job. Heartbeats are answered by the runtime's
 * auto-response pair, which never wakes a hibernated object.
 */
export class WorkerWakeHub {
  constructor(
    private readonly state: DurableObjectState,
    _env: Env,
  ) {
    state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        workerWakeHeartbeatRequest,
        workerWakeHeartbeatResponse,
      ),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/subscribe" && request.method === "GET") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      return this.subscribe(request.headers.get(workerWakeProtocolHeader));
    }
    if (url.pathname === "/wake" && request.method === "POST") {
      let frame;
      try {
        frame = decodeWorkerWakeFrame(await request.text());
      } catch {
        return new Response("Invalid worker wake frame", { status: 400 });
      }
      if (frame.type !== "wake") {
        return new Response("Invalid worker wake frame", { status: 400 });
      }
      this.publish(encodeWorkerWakeFrame(frame));
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  }

  private subscribe(protocol: string | null) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.send(readyFrame());
    return new Response(null, {
      status: 101,
      ...(protocol ? { headers: { "Sec-WebSocket-Protocol": protocol } } : {}),
      webSocket: client,
    });
  }

  private publish(payload: string) {
    for (const client of this.state.getWebSockets()) {
      if (client.readyState !== socketOpen) continue;
      try {
        client.send(payload);
      } catch {
        client.close(1011, "Worker wake delivery failed");
      }
    }
  }

  webSocketMessage(_socket: WebSocket, _message: string | ArrayBuffer) {
    // Wake frames are server-to-client only, and heartbeats are answered by
    // the auto-response pair registered in the constructor.
  }

  webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ) {
    socket.close(code, reason);
  }

  webSocketError(socket: WebSocket) {
    socket.close(1011, "Worker wake socket error");
  }
}

export async function subscribeToWorkerWake(
  env: Env,
  workspaceId: string,
  protocol: string,
) {
  const hub = env.WORKER_WAKE.getByName(workspaceId);
  return hub.fetch("https://worker-wake.internal/subscribe", {
    headers: {
      Upgrade: "websocket",
      [workerWakeProtocolHeader]: protocol,
    },
  });
}

export async function publishWorkerWake(
  env: Env,
  workspaceId: string,
  reason: WorkerWakeReason,
) {
  const hub = env.WORKER_WAKE.getByName(workspaceId);
  const response = await hub.fetch("https://worker-wake.internal/wake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: encodeWorkerWakeFrame({ type: "wake", reason }),
  });
  if (!response.ok) {
    throw new Error(`Worker wake publish failed (${response.status})`);
  }
}

/**
 * Fire-and-forget poke. A wake only shortens a poll interval, so a Durable
 * Object failure must never fail the request that enqueued the work; the
 * Worker's own polling still picks the job up.
 */
export function wakeWorkspaceWorkers(
  env: Env,
  workspaceId: string,
  reason: WorkerWakeReason,
  context?: ExecutionContext,
) {
  if (!env.WORKER_WAKE) return;
  const wake = publishWorkerWake(env, workspaceId, reason).catch((error) => {
    console.error(JSON.stringify({
      message: "Worker wake publish failed",
      workspaceId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  if (context) context.waitUntil(wake);
  else void wake;
}
