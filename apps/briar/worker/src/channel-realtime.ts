import {
  ChannelsChangedSchema,
  InboxChangedSchema,
  type OrganizationNotification,
  OrganizationNotificationSchema,
  ProjectAgentSessionsChangedSchema,
  ProjectChangedSchema,
  ReadySchema,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

type OrganizationRealtimeSocketAttachment = {
  cursors: Record<string, number>;
};

function parseCursor(value: string | null) {
  if (!value || !/^\d+$/u.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

const PROJECT_ID_PATTERN = /^[0-9a-f-]+$/iu;

type NotificationCursor = {
  key: string;
  version: number;
};

const encodeNotification = (notification: OrganizationNotification) =>
  toBinary(OrganizationNotificationSchema, notification);

const readyNotification = () => create(OrganizationNotificationSchema, {
  notification: {
    case: "ready",
    value: create(ReadySchema),
  },
});

const channelsNotification = (cursor: number) =>
  create(OrganizationNotificationSchema, {
    notification: {
      case: "channelsChanged",
      value: create(ChannelsChangedSchema, { cursor: BigInt(cursor) }),
    },
  });

const inboxNotification = (version: number) =>
  create(OrganizationNotificationSchema, {
    notification: {
      case: "inboxChanged",
      value: create(InboxChangedSchema, { version: BigInt(version) }),
    },
  });

const projectNotification = (
  projectId: string,
  cursor: number,
) => create(OrganizationNotificationSchema, {
  notification: {
    case: "projectChanged",
    value: create(ProjectChangedSchema, {
      projectId,
      cursor: BigInt(cursor),
    }),
  },
});

const projectAgentSessionsNotification = (
  projectId: string,
  version: number,
) => create(OrganizationNotificationSchema, {
  notification: {
    case: "projectAgentSessionsChanged",
    value: create(ProjectAgentSessionsChangedSchema, {
      projectId,
      version: BigInt(version),
    }),
  },
});

function notificationCursor(
  message: OrganizationNotification,
): NotificationCursor | null {
  const notification = message.notification;
  let key: string;
  let revision: bigint;
  switch (notification.case) {
    case "channelsChanged":
      key = "channels";
      revision = notification.value.cursor;
      break;
    case "inboxChanged":
      key = "inbox";
      revision = notification.value.version;
      break;
    case "projectChanged":
      if (!PROJECT_ID_PATTERN.test(notification.value.projectId)) return null;
      key = `project:${notification.value.projectId}`;
      revision = notification.value.cursor;
      break;
    case "projectAgentSessionsChanged":
      if (!PROJECT_ID_PATTERN.test(notification.value.projectId)) return null;
      key = `project-session:${notification.value.projectId}`;
      revision = notification.value.version;
      break;
    case "ready":
    case undefined:
      return null;
  }
  if (revision > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { key, version: Number(revision) };
}

async function decodeNotificationRequest(request: Request) {
  try {
    return fromBinary(
      OrganizationNotificationSchema,
      new Uint8Array(await request.arrayBuffer()),
    );
  } catch {
    return null;
  }
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
      const notification = await decodeNotificationRequest(request);
      const cursor = notification && notificationCursor(notification);
      if (!notification || !cursor) {
        return new Response("Invalid realtime notification", { status: 400 });
      }
      this.publish(notification, cursor);
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
    server.send(encodeNotification(readyNotification()));
    server.send(encodeNotification(channelsNotification(cursors.channels)));
    server.send(encodeNotification(inboxNotification(cursors.inbox)));
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private publish(
    notification: OrganizationNotification,
    cursor: NotificationCursor,
  ) {
    const payload = encodeNotification(notification);
    for (const client of this.state.getWebSockets()) {
      const attachment = client.deserializeAttachment() as
        | OrganizationRealtimeSocketAttachment
        | { cursor: number }
        | null;
      const cursors = attachment && "cursors" in attachment
        ? attachment.cursors
        : { channels: attachment?.cursor ?? -1 };
      if ((cursors[cursor.key] ?? -1) >= cursor.version) continue;
      try {
        client.send(payload);
        client.serializeAttachment({
          cursors: { ...cursors, [cursor.key]: cursor.version },
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
  const notification = inboxNotification(version);
  const hub = env.CHANNEL_REALTIME.getByName(organizationId);
  const response = await hub.fetch("https://channel-realtime.internal/notify", {
    method: "POST",
    headers: { "Content-Type": "application/protobuf" },
    body: encodeNotification(notification),
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
  const notification = channelsNotification(cursor);
  const hub = env.CHANNEL_REALTIME.getByName(organizationId);
  const response = await hub.fetch("https://channel-realtime.internal/notify", {
    method: "POST",
    headers: { "Content-Type": "application/protobuf" },
    body: encodeNotification(notification),
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
  const notification = projectNotification(projectId, cursor);
  const hub = env.CHANNEL_REALTIME.getByName(organizationId);
  const response = await hub.fetch("https://channel-realtime.internal/notify", {
    method: "POST",
    headers: { "Content-Type": "application/protobuf" },
    body: encodeNotification(notification),
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
  const notification = projectAgentSessionsNotification(projectId, version);
  const hub = env.CHANNEL_REALTIME.getByName(organizationId);
  const response = await hub.fetch("https://channel-realtime.internal/notify", {
    method: "POST",
    headers: { "Content-Type": "application/protobuf" },
    body: encodeNotification(notification),
  });
  if (!response.ok) {
    throw new Error(
      `Project Agent session realtime notification failed (${response.status})`,
    );
  }
}
