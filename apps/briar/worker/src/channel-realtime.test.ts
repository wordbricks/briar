import {
  ChannelsChangedSchema,
  type OrganizationNotification,
  OrganizationNotificationSchema,
  ProjectAgentSessionsChangedSchema,
  ProjectChangedSchema,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { ChannelRealtimeHub } from "./channel-realtime";

class FakeSocket {
  sent: Uint8Array[] = [];
  attachment: { cursors: Record<string, number> } | null;
  close = vi.fn();

  constructor(cursor: number) {
    this.attachment = { cursors: { channels: cursor } };
  }

  deserializeAttachment() {
    return this.attachment;
  }

  serializeAttachment(
    attachment: { cursors: Record<string, number> },
  ) {
    this.attachment = attachment;
  }

  send(value: Uint8Array) {
    this.sent.push(value.slice());
  }
}

const notifyRequest = (notification: OrganizationNotification) =>
  new Request("https://realtime.test/notify", {
    method: "POST",
    headers: { "Content-Type": "application/protobuf" },
    body: toBinary(OrganizationNotificationSchema, notification),
  });

const decodeFrame = (value: Uint8Array) =>
  fromBinary(OrganizationNotificationSchema, value);

describe("ChannelRealtimeHub", () => {
  it("fans out only newer protobuf cursor frames", async () => {
    const socket = new FakeSocket(9);
    const hub = new ChannelRealtimeHub(
      { getWebSockets: () => [socket] } as unknown as DurableObjectState,
      {} as Env,
    );
    const channelsChanged = (cursor: bigint) =>
      create(OrganizationNotificationSchema, {
        notification: {
          case: "channelsChanged",
          value: create(ChannelsChangedSchema, { cursor }),
        },
      });

    const published = await hub.fetch(notifyRequest(channelsChanged(12n)));
    expect(published.status).toBe(204);
    expect(decodeFrame(socket.sent[0]).notification).toMatchObject({
      case: "channelsChanged",
      value: { cursor: 12n },
    });
    expect(socket.attachment).toEqual({ cursors: { channels: 12 } });

    await hub.fetch(notifyRequest(channelsChanged(11n)));
    expect(socket.sent).toHaveLength(1);
  });

  it("tracks protobuf oneof revisions independently", async () => {
    const socket = new FakeSocket(42);
    const hub = new ChannelRealtimeHub(
      { getWebSockets: () => [socket] } as unknown as DurableObjectState,
      {} as Env,
    );
    const projectId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    await hub.fetch(notifyRequest(create(OrganizationNotificationSchema, {
      notification: {
        case: "projectChanged",
        value: create(ProjectChangedSchema, { projectId, cursor: 3n }),
      },
    })));
    await hub.fetch(notifyRequest(create(OrganizationNotificationSchema, {
      notification: {
        case: "projectAgentSessionsChanged",
        value: create(ProjectAgentSessionsChangedSchema, {
          projectId,
          version: 8n,
        }),
      },
    })));

    expect(socket.sent.map(decodeFrame).map((frame) => frame.notification.case))
      .toEqual(["projectChanged", "projectAgentSessionsChanged"]);
    expect(socket.attachment).toEqual({
      cursors: {
        channels: 42,
        [`project:${projectId}`]: 3,
        [`project-session:${projectId}`]: 8,
      },
    });
  });

  it("rejects a frame without a notification oneof", async () => {
    const hub = new ChannelRealtimeHub(
      {} as DurableObjectState,
      {} as Env,
    );
    const response = await hub.fetch(notifyRequest(
      create(OrganizationNotificationSchema),
    ));
    expect(response.status).toBe(400);
  });
});
