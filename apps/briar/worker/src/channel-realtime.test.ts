import {
  ChannelsChangedSchema,
  InboxChangedSchema,
  type OrganizationNotification,
  OrganizationNotificationSchema,
  ProjectAgentSessionsChangedSchema,
  ProjectChangedSchema,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const notifyRequest = (notification: OrganizationNotification) =>
  new Request("https://realtime.test/notify", {
    method: "POST",
    headers: { "Content-Type": "application/protobuf" },
    body: toBinary(OrganizationNotificationSchema, notification),
  });

const decodeFrame = async (value: unknown) => {
  let bytes: Uint8Array;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else if (value instanceof Blob) {
    bytes = new Uint8Array(await value.arrayBuffer());
  } else {
    throw new TypeError("Expected a binary WebSocket message");
  }
  return fromBinary(OrganizationNotificationSchema, bytes);
};

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
    nextMessage: () => {
      const value = queued.shift();
      return value === undefined
        ? new Promise<unknown>((resolve) => waiting.push(resolve))
        : Promise.resolve(value);
    },
  };
}

async function subscribe(cursor: number) {
  const stub = env.CHANNEL_REALTIME.getByName(crypto.randomUUID());
  const realtime = openWebSocket(await stub.fetch(
    `https://realtime.test/subscribe?cursor=${cursor}&inboxVersion=0`,
    { headers: { Upgrade: "websocket" } },
  ));
  const initial = [];
  for (let index = 0; index < 3; index += 1) {
    initial.push(await decodeFrame(await realtime.nextMessage()));
  }
  expect(initial.map((item) => item.notification.case)).toEqual([
    "ready",
    "channelsChanged",
    "inboxChanged",
  ]);
  return { stub, ...realtime };
}

describe("ChannelRealtimeHub", () => {
  it("fans out only newer protobuf cursor frames", async () => {
    const realtime = await subscribe(9);
    const channelsChanged = (cursor: bigint) =>
      create(OrganizationNotificationSchema, {
        notification: {
          case: "channelsChanged",
          value: create(ChannelsChangedSchema, { cursor }),
        },
      });

    const published = await realtime.stub.fetch(
      notifyRequest(channelsChanged(12n)),
    );
    expect(published.status).toBe(204);
    expect((await decodeFrame(await realtime.nextMessage())).notification)
      .toMatchObject({
        case: "channelsChanged",
        value: { cursor: 12n },
      });

    await evictDurableObject(realtime.stub);
    await realtime.stub.fetch(notifyRequest(channelsChanged(11n)));
    await realtime.stub.fetch(notifyRequest(create(
      OrganizationNotificationSchema,
      {
        notification: {
          case: "inboxChanged",
          value: create(InboxChangedSchema, { version: 1n }),
        },
      },
    )));
    expect((await decodeFrame(await realtime.nextMessage())).notification.case)
      .toBe("inboxChanged");
    realtime.socket.close(1000, "done");
  });

  it("tracks protobuf oneof revisions independently", async () => {
    const realtime = await subscribe(42);
    const projectId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const projectChanged = (cursor: bigint) =>
      create(OrganizationNotificationSchema, {
        notification: {
          case: "projectChanged",
          value: create(ProjectChangedSchema, { projectId, cursor }),
        },
      });
    const sessionsChanged = (version: bigint) =>
      create(OrganizationNotificationSchema, {
        notification: {
          case: "projectAgentSessionsChanged",
          value: create(ProjectAgentSessionsChangedSchema, {
            projectId,
            version,
          }),
        },
      });

    await realtime.stub.fetch(notifyRequest(projectChanged(3n)));
    await realtime.stub.fetch(notifyRequest(sessionsChanged(8n)));

    expect((await decodeFrame(await realtime.nextMessage())).notification.case)
      .toBe("projectChanged");
    expect((await decodeFrame(await realtime.nextMessage())).notification.case)
      .toBe("projectAgentSessionsChanged");

    await realtime.stub.fetch(notifyRequest(projectChanged(2n)));
    await realtime.stub.fetch(notifyRequest(sessionsChanged(7n)));
    await realtime.stub.fetch(notifyRequest(create(
      OrganizationNotificationSchema,
      {
        notification: {
          case: "channelsChanged",
          value: create(ChannelsChangedSchema, { cursor: 43n }),
        },
      },
    )));
    expect((await decodeFrame(await realtime.nextMessage())).notification)
      .toMatchObject({ case: "channelsChanged", value: { cursor: 43n } });
    realtime.socket.close(1000, "done");
  });

  it("rejects a frame without a notification oneof", async () => {
    const stub = env.CHANNEL_REALTIME.getByName(crypto.randomUUID());
    const response = await stub.fetch(notifyRequest(
      create(OrganizationNotificationSchema),
    ));
    expect(response.status).toBe(400);
  });
});
