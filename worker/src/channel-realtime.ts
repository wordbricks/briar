export type OrganizationRealtimeNotification =
  | {
      topic: "channels";
      cursor: number;
    }
  | {
      topic: "inbox";
      version: number;
    }
  | {
      topic: "project";
      projectId: string;
      cursor: number;
    }
  | {
      topic: "project-session";
      projectId: string;
      version: number;
    };

type OrganizationRealtimeSocketAttachment = {
  cursors: Record<string, number>;
};

function parseCursor(value: string | null) {
  if (!value || !/^\d+$/u.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

/**
 * Organization-scoped fan-out for channel, Inbox, and project notifications.
 *
 * D1's change logs and Inbox revision stay authoritative. The Durable Object
 * owns only hibernatable sockets and persists each topic's last version as an
 * attachment, so no in-memory controller or timer keeps it billable while idle.
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
      return this.subscribe({
        channels: parseCursor(url.searchParams.get("cursor")) ?? 0,
        inbox: parseCursor(url.searchParams.get("inboxVersion")) ?? 0,
      });
    }
    if (url.pathname === "/notify" && request.method === "POST") {
      const notification = await request.json<OrganizationRealtimeNotification>();
      const valid = notification.topic === "channels"
        ? Number.isSafeInteger(notification.cursor) && notification.cursor >= 0
        : notification.topic === "inbox"
          ? Number.isSafeInteger(notification.version) &&
            notification.version >= 0
          : notification.topic === "project"
            ? /^[0-9a-f-]+$/iu.test(notification.projectId) &&
              Number.isSafeInteger(notification.cursor) &&
              notification.cursor >= 0
            : notification.topic === "project-session"
              ? /^[0-9a-f-]+$/iu.test(notification.projectId) &&
                Number.isSafeInteger(notification.version) &&
                notification.version >= 0
              : false;
      if (!valid) {
        return new Response("Invalid realtime notification", { status: 400 });
      }
      this.publish(notification);
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  }

  private subscribe(cursors: { channels: number; inbox: number }) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment(
      {
        cursors,
      } satisfies OrganizationRealtimeSocketAttachment,
    );
    server.send(JSON.stringify({ topic: "ready" }));
    server.send(JSON.stringify({ topic: "channels", cursor: cursors.channels }));
    server.send(JSON.stringify({ topic: "inbox", version: cursors.inbox }));
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private publish(notification: OrganizationRealtimeNotification) {
    const payload = JSON.stringify(notification);
    const cursorKey = notification.topic === "channels"
      ? "channels"
      : notification.topic === "inbox"
        ? "inbox"
        : notification.topic === "project"
          ? `project:${notification.projectId}`
          : `project-session:${notification.projectId}`;
    const nextVersion = notification.topic === "inbox"
      ? notification.version
      : notification.topic === "project-session"
        ? notification.version
        : notification.cursor;
    for (const client of this.state.getWebSockets()) {
      const attachment = client.deserializeAttachment() as
        | OrganizationRealtimeSocketAttachment
        | { cursor: number }
        | null;
      const cursors = attachment && "cursors" in attachment
        ? attachment.cursors
        : { channels: attachment?.cursor ?? -1 };
      if ((cursors[cursorKey] ?? -1) >= nextVersion) continue;
      try {
        client.send(payload);
        client.serializeAttachment({
          cursors: { ...cursors, [cursorKey]: nextVersion },
        } satisfies OrganizationRealtimeSocketAttachment);
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

export async function subscribeToOrganizationRealtime(
  env: Env,
  organizationId: string,
  cursors: { channels: number; inbox: number },
) {
  const hub = env.CHANNEL_REALTIME.getByName(organizationId);
  return hub.fetch(
    `https://channel-realtime.internal/subscribe?cursor=${cursors.channels}` +
      `&inboxVersion=${cursors.inbox}`,
    { headers: { Upgrade: "websocket" } },
  );
}

export async function publishInboxRealtime(
  env: Env,
  organizationId: string,
  version: number,
) {
  const hub = env.CHANNEL_REALTIME.getByName(organizationId);
  const response = await hub.fetch("https://channel-realtime.internal/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "inbox", version }),
  });
  if (!response.ok) {
    throw new Error(`Inbox realtime notification failed (${response.status})`);
  }
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

export async function publishProjectRealtime(
  env: Env,
  organizationId: string,
  projectId: string,
  cursor: number,
) {
  const hub = env.CHANNEL_REALTIME.getByName(organizationId);
  const response = await hub.fetch("https://channel-realtime.internal/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "project", projectId, cursor }),
  });
  if (!response.ok) {
    throw new Error(`Project realtime notification failed (${response.status})`);
  }
}

export async function publishProjectAgentSessionRealtime(
  env: Env,
  organizationId: string,
  projectId: string,
  version: number,
) {
  const hub = env.CHANNEL_REALTIME.getByName(organizationId);
  const response = await hub.fetch("https://channel-realtime.internal/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: "project-session",
      projectId,
      version,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Project Agent session realtime notification failed (${response.status})`,
    );
  }
}
