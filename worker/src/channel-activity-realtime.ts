import {
  channelAgentActivityFrameSchema,
  type ChannelAgentActivityFrame,
} from "../../src/lib/channel-agent-activity";

type ChannelActivitySocketAttachment = {
  userId: string;
  authorizationExpiresAt: number;
};

const activityHubName = (organizationId: string, channelId: string) =>
  `${organizationId}:${channelId}`;

/**
 * Channel-scoped, ephemeral fan-out for user-visible Agent activity.
 *
 * D1 remains authoritative for reply status and final messages. This object
 * deliberately uses no Durable Object storage: after hibernation or eviction,
 * clients fall back to the durable generic "Agent is replying" state until the
 * next activity frame arrives.
 */
export class ChannelActivityHub {
  private readonly latestByReply = new Map<string, ChannelAgentActivityFrame>();

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
      const userId = url.searchParams.get("userId") ?? "";
      const authorizationExpiresAt = Number(
        url.searchParams.get("authorizationExpiresAt") ?? "0",
      );
      if (
        !userId || !Number.isSafeInteger(authorizationExpiresAt) ||
        authorizationExpiresAt <= Date.now()
      ) {
        return new Response("Invalid activity subscription", { status: 400 });
      }
      return this.subscribe({ userId, authorizationExpiresAt });
    }
    if (url.pathname === "/publish" && request.method === "POST") {
      const parsed = channelAgentActivityFrameSchema.safeParse(
        await request.json<unknown>(),
      );
      if (!parsed.success) {
        return new Response("Invalid activity frame", { status: 400 });
      }
      this.publish(parsed.data);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/disconnect" && request.method === "POST") {
      for (const socket of this.state.getWebSockets()) {
        socket.close(4003, "Channel access changed");
      }
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  }

  private subscribe(attachment: ChannelActivitySocketAttachment) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    const now = Date.now();
    for (const [replyJobId, frame] of this.latestByReply) {
      if (Date.parse(frame.expiresAt) <= now) {
        this.latestByReply.delete(replyJobId);
        continue;
      }
      server.send(JSON.stringify(frame));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private publish(frame: ChannelAgentActivityFrame) {
    const now = Date.now();
    for (const [replyJobId, current] of this.latestByReply) {
      if (Date.parse(current.expiresAt) <= now) {
        this.latestByReply.delete(replyJobId);
      }
    }
    const previous = this.latestByReply.get(frame.replyJobId);
    if (
      previous &&
      (previous.attempt > frame.attempt ||
        (previous.attempt === frame.attempt &&
          previous.sequence >= frame.sequence))
    ) {
      return;
    }
    // Keep clear frames as short-lived tombstones so an HTTP publish that was
    // already in flight cannot resurrect activity after reply completion.
    this.latestByReply.set(frame.replyJobId, frame);

    const payload = JSON.stringify(frame);
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as
        | ChannelActivitySocketAttachment
        | null;
      if (!attachment || attachment.authorizationExpiresAt <= now) {
        socket.close(4003, "Channel activity authorization expired");
        continue;
      }
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "Activity delivery failed");
      }
    }
  }

  webSocketMessage(socket: WebSocket, _message: string | ArrayBuffer) {
    socket.close(1008, "Channel activity is server-to-client only");
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
    socket.close(1011, "Activity socket error");
  }
}

export async function subscribeToChannelActivity(
  env: Env,
  input: {
    organizationId: string;
    channelId: string;
    userId: string;
    authorizationExpiresAt: number;
  },
) {
  const hub = env.CHANNEL_ACTIVITY_REALTIME.getByName(
    activityHubName(input.organizationId, input.channelId),
  );
  const query = new URLSearchParams({
    userId: input.userId,
    authorizationExpiresAt: String(input.authorizationExpiresAt),
  });
  return hub.fetch(`https://channel-activity.internal/subscribe?${query}`, {
    headers: { Upgrade: "websocket" },
  });
}

export async function publishChannelActivity(
  env: Env,
  organizationId: string,
  frame: ChannelAgentActivityFrame,
) {
  const hub = env.CHANNEL_ACTIVITY_REALTIME.getByName(
    activityHubName(organizationId, frame.channelId),
  );
  const response = await hub.fetch("https://channel-activity.internal/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(frame),
  });
  if (!response.ok) {
    throw new Error(`Channel activity publish failed (${response.status})`);
  }
}

export async function disconnectChannelActivitySubscribers(
  env: Env,
  organizationId: string,
  channelId: string,
) {
  const hub = env.CHANNEL_ACTIVITY_REALTIME.getByName(
    activityHubName(organizationId, channelId),
  );
  const response = await hub.fetch("https://channel-activity.internal/disconnect", {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Channel activity disconnect failed (${response.status})`);
  }
}
