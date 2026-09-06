import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  decodeWorkerWakeFrame,
  encodeWorkerWakeFrame,
  workerWakeCredentialFromProtocols,
  workerWakeProtocolHeader,
  workerWakeSubprotocol,
} from "../../src/lib/worker-wake-protocol";

const wakeRequest = (body: string) =>
  new Request("https://worker-wake.test/wake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

function openWebSocket(response: Response) {
  const socket = response.webSocket;
  if (!socket) throw new TypeError("Expected WebSocket upgrade response");
  const queued: unknown[] = [];
  const waiting: Array<(value: unknown) => void> = [];
  socket.addEventListener("message", (event) => {
    const resolve = waiting.shift();
    if (resolve) resolve(event.data);
    else queued.push(event.data);
  });
  socket.accept();
  return {
    socket,
    nextFrame: async () => {
      const value = queued.shift() ??
        await new Promise<unknown>((resolve) => waiting.push(resolve));
      if (typeof value !== "string") {
        throw new TypeError("Expected a text worker wake frame");
      }
      return decodeWorkerWakeFrame(value);
    },
  };
}

async function subscribe(
  stub: DurableObjectStub,
  protocol = workerWakeSubprotocol("briar_worker_test-credential"),
) {
  const response = await stub.fetch(
    "https://worker-wake.test/subscribe",
    { headers: { Upgrade: "websocket", [workerWakeProtocolHeader]: protocol } },
  );
  expect(response.status).toBe(101);
  expect(response.headers.get("Sec-WebSocket-Protocol")).toBe(protocol);
  const opened = openWebSocket(response);
  // The hub greets every subscriber so the CLI can log a live socket without
  // waiting for the first wake.
  expect(await opened.nextFrame()).toEqual({ type: "ready" });
  return opened;
}

describe("WorkerWakeHub", () => {
  it("fans a wake out to every Worker connected to the organization", async () => {
    const stub = env.WORKER_WAKE.getByName(crypto.randomUUID());
    const first = await subscribe(stub);
    const second = await subscribe(stub);

    const published = await stub.fetch(wakeRequest(
      encodeWorkerWakeFrame({ type: "wake", reason: "channel_reply_enqueued" }),
    ));
    expect(published.status).toBe(204);
    expect(await first.nextFrame()).toEqual({
      type: "wake",
      reason: "channel_reply_enqueued",
    });
    expect(await second.nextFrame()).toEqual({
      type: "wake",
      reason: "channel_reply_enqueued",
    });

    first.socket.close(1000, "done");
    second.socket.close(1000, "done");
  });

  it("keeps delivering after the object hibernates", async () => {
    const stub = env.WORKER_WAKE.getByName(crypto.randomUUID());
    const wake = await subscribe(stub);

    await evictDurableObject(stub);
    await stub.fetch(wakeRequest(
      encodeWorkerWakeFrame({ type: "wake", reason: "issue_reply_enqueued" }),
    ));
    expect(await wake.nextFrame()).toEqual({
      type: "wake",
      reason: "issue_reply_enqueued",
    });
    wake.socket.close(1000, "done");
  });

  it("rejects a wake body that is not a wake frame", async () => {
    const stub = env.WORKER_WAKE.getByName(crypto.randomUUID());
    for (
      const body of [
        "not json",
        JSON.stringify({ type: "wake", reason: "something_else" }),
        JSON.stringify({ type: "wake" }),
        encodeWorkerWakeFrame({ type: "ready" }),
      ]
    ) {
      const response = await stub.fetch(wakeRequest(body));
      expect(response.status).toBe(400);
    }
  });

  it("refuses a subscribe that is not a WebSocket upgrade", async () => {
    const stub = env.WORKER_WAKE.getByName(crypto.randomUUID());
    const response = await stub.fetch("https://worker-wake.test/subscribe");
    expect(response.status).toBe(426);
    const unknown = await stub.fetch("https://worker-wake.test/other");
    expect(unknown.status).toBe(404);
  });
});

describe("worker wake credential", () => {
  it("accepts exactly one Worker credential offered as a subprotocol", () => {
    expect(
      workerWakeCredentialFromProtocols(
        workerWakeSubprotocol("briar_worker_abc-123"),
      ),
    ).toEqual({
      protocol: "briar-worker-wake-v1.briar_worker_abc-123",
      token: "briar_worker_abc-123",
    });
    expect(
      workerWakeCredentialFromProtocols(
        `chat, ${workerWakeSubprotocol("briar_worker_abc-123")}`,
      ),
    ).toMatchObject({ token: "briar_worker_abc-123" });
  });

  it("rejects a missing, duplicated, or malformed credential", () => {
    expect(workerWakeCredentialFromProtocols(null)).toBeNull();
    expect(workerWakeCredentialFromProtocols("chat")).toBeNull();
    // An agent token or a session token must never open this socket.
    expect(workerWakeCredentialFromProtocols(
      workerWakeSubprotocol("briar_agent_abc"),
    )).toBeNull();
    expect(workerWakeCredentialFromProtocols(
      `${workerWakeSubprotocol("briar_worker_a")}, ${
        workerWakeSubprotocol("briar_worker_b")
      }`,
    )).toBeNull();
  });
});
