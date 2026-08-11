export type ChannelRealtimeNotification = {
  topic: "channels";
  cursor: number;
};

const encoder = new TextEncoder();

export function encodeChannelRealtimeEvent(
  notification: ChannelRealtimeNotification,
  event = "change",
) {
  return encoder.encode(
    `id: ${notification.cursor}\nevent: ${event}\ndata: ${JSON.stringify(notification)}\n\n`,
  );
}

function parseCursor(value: string | null) {
  if (!value || !/^\d+$/u.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

/**
 * Organization-scoped fan-out for channel cursor notifications.
 *
 * The Durable Object owns only live transports. D1's channel change log stays
 * authoritative, so reconnecting clients always recover through the delta API
 * and a later WebSocket transport can reuse the same notification envelope.
 */
export class ChannelRealtimeHub {
  private readonly clients = new Map<
    string,
    ReadableStreamDefaultController<Uint8Array>
  >();
  private latestCursor = 0;

  constructor(_state: DurableObjectState, _env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/subscribe" && request.method === "GET") {
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
    const clientId = crypto.randomUUID();
    const initialCursor = Math.max(cursor, this.latestCursor);
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.clients.set(clientId, controller);
        controller.enqueue(
          encoder.encode("retry: 3000\n\n"),
        );
        controller.enqueue(
          encodeChannelRealtimeEvent(
            { topic: "channels", cursor: initialCursor },
            "ready",
          ),
        );
      },
      cancel: () => {
        this.clients.delete(clientId);
      },
    });
    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  }

  private publish(notification: ChannelRealtimeNotification) {
    if (notification.cursor < this.latestCursor) return;
    this.latestCursor = notification.cursor;
    const payload = encodeChannelRealtimeEvent(notification);
    for (const [clientId, controller] of this.clients) {
      try {
        controller.enqueue(payload);
      } catch {
        this.clients.delete(clientId);
      }
    }
  }
}

export async function subscribeToChannelRealtime(
  env: Env,
  organizationId: string,
  cursor: number,
) {
  const hub = env.CHANNEL_REALTIME.getByName(organizationId);
  return hub.fetch(
    `https://channel-realtime.internal/subscribe?cursor=${cursor}`,
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
