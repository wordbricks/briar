export type ChannelRealtimeNotification = {
  topic: "channels";
  cursor: number;
};

type ChannelRealtimeSocketAttachment = {
  cursor: number;
};

function parseCursor(value: string | null) {
  if (!value || !/^\d+$/u.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

/**
 * Organization-scoped fan-out for channel cursor notifications.
 *
 * D1's channel change log stays authoritative. The Durable Object owns only
 * hibernatable sockets and persists each socket's last cursor as an attachment,
 * so no in-memory controller or timer keeps the object billable while idle.
 */
export class ChannelRealtimeHub {
  constructor(
    private readonly state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/subscribe" && request.method === "GET") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      return this.subscribe(parseCursor(url.searchParams.get("cursor")) ?? 0);
    }
    if (url.pathname === "/notify" && request.method === "POST") {
      const notification = await request.json<ChannelRealtimeNotification>();
      if (
        notification.topic !== "channels" ||
        !Number.isSafeInteger(notification.cursor) ||
        notification.cursor < 0
      ) {
        return new Response("Invalid realtime notification", { status: 400 });
      }
      this.publish(notification);
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  }

  private subscribe(cursor: number) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment(
      { cursor } satisfies ChannelRealtimeSocketAttachment,
    );
    server.send(JSON.stringify({ topic: "channels", cursor }));
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private publish(notification: ChannelRealtimeNotification) {
    const payload = JSON.stringify(notification);
    for (const client of this.state.getWebSockets()) {
      const attachment = client.deserializeAttachment() as
        | ChannelRealtimeSocketAttachment
        | null;
      if ((attachment?.cursor ?? -1) >= notification.cursor) continue;
      try {
        client.send(payload);
        client.serializeAttachment({ cursor: notification.cursor });
      } catch {
        client.close(1011, "Realtime delivery failed");
      }
    }
  }

  webSocketMessage(_socket: WebSocket, _message: string | ArrayBuffer) {
    // Notifications are server-to-client only. Protocol ping/pong is handled
    // by the runtime without waking a hibernated object.
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
    socket.close(1011, "Realtime socket error");
  }
}

export function legacyChannelRealtimeResponse() {
  // Old clients retain their authoritative 60-second delta fallback. A 426
  // makes their reconnect delay back off instead of opening a billable stream
  // or resetting the SSE adapter's delay after every finite 200 response.
  return new Response("WebSocket transport required", {
    status: 426,
    headers: {
      "Cache-Control": "private, no-store",
      "Retry-After": "60",
    },
  });
}

export async function subscribeToChannelRealtime(
  env: Env,
  organizationId: string,
  cursor: number,
) {
  const hub = env.CHANNEL_REALTIME.getByName(organizationId);
  return hub.fetch(
    `https://channel-realtime.internal/subscribe?cursor=${cursor}`,
    { headers: { Upgrade: "websocket" } },
  );
}

export async function publishChannelRealtime(
  env: Env,
  organizationId: string,
  cursor: number,
) {
  const hub = env.CHANNEL_REALTIME.getByName(organizationId);
  const response = await hub.fetch("https://channel-realtime.internal/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "channels", cursor }),
  });
  if (!response.ok) {
    throw new Error(`Channel realtime notification failed (${response.status})`);
  }
}
