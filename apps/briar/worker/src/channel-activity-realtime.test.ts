import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vitest";
import {
  decodeAgentReplyActivityFrameBinaryOption,
  encodeAgentReplyActivityFrameBinary,
  type AgentReplyActivityFrame,
  type ChannelAgentActivityFrame,
  type IssueAgentActivityFrame,
} from "../../src/lib/channel-agent-activity";
import {
  ChannelActivityHub,
  publishChannelActivity,
  publishIssueActivity,
  subscribeToChannelActivity,
  subscribeToIssueActivity,
} from "./channel-activity-realtime";

class FakeSocket {
  sent: Uint8Array[] = [];
  close = vi.fn();

  constructor(
    private readonly attachment: {
      userId: string;
      authorizationExpiresAt: number;
    },
  ) {}

  deserializeAttachment() {
    return this.attachment;
  }

  send(value: Uint8Array) {
    this.sent.push(value.slice());
  }
}

const frame = (sequence: number): ChannelAgentActivityFrame => ({
  replyJobId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  attempt: 1,
  sequence,
  agentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  channelId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  triggerMessageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  parentMessageId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  activity: { id: "command-1", kind: "command", headline: "Running tests" },
  sentAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
});

const publishRequest = (value: AgentReplyActivityFrame) =>
  new Request("https://activity.test/publish", {
    method: "POST",
    headers: { "Content-Type": "application/protobuf" },
    body: encodeAgentReplyActivityFrameBinary(value),
  });

const decodeFrame = (value: Uint8Array) => Option.getOrThrow(
  decodeAgentReplyActivityFrameBinaryOption(value),
);

describe("ChannelActivityHub", () => {
  it("fans out the latest sequence and rejects stale updates", async () => {
    const socket = new FakeSocket({
      userId: "user-a",
      authorizationExpiresAt: Date.now() + 60_000,
    });
    const hub = new ChannelActivityHub(
      { getWebSockets: () => [socket] } as unknown as DurableObjectState,
      {} as Env,
    );
    for (const sequence of [2, 1]) {
      const response = await hub.fetch(publishRequest(frame(sequence)));
      expect(response.status).toBe(204);
    }
    expect(socket.sent).toHaveLength(1);
    expect(decodeFrame(socket.sent[0])).toMatchObject({ sequence: 2 });
  });

  it("closes expired subscribers before sending private activity", async () => {
    const socket = new FakeSocket({
      userId: "user-a",
      authorizationExpiresAt: Date.now() - 1,
    });
    const hub = new ChannelActivityHub(
      { getWebSockets: () => [socket] } as unknown as DurableObjectState,
      {} as Env,
    );
    await hub.fetch(publishRequest(frame(1)));
    expect(socket.sent).toEqual([]);
    expect(socket.close).toHaveBeenCalledWith(
      4003,
      "Agent activity authorization expired",
    );
  });

  it("keeps a completion tombstone from being overwritten by a late publish", async () => {
    const socket = new FakeSocket({
      userId: "user-a",
      authorizationExpiresAt: Date.now() + 60_000,
    });
    const hub = new ChannelActivityHub(
      { getWebSockets: () => [socket] } as unknown as DurableObjectState,
      {} as Env,
    );
    const cleared = {
      ...frame(Number.MAX_SAFE_INTEGER),
      activity: null,
    } satisfies ChannelAgentActivityFrame;
    for (const update of [cleared, frame(3)]) {
      await hub.fetch(publishRequest(update));
    }
    expect(socket.sent).toHaveLength(1);
    expect(decodeFrame(socket.sent[0])).toMatchObject({
      sequence: Number.MAX_SAFE_INTEGER,
      activity: null,
    });
  });

  it("fans out issue-scoped commentary frames through the same ephemeral hub", async () => {
    const socket = new FakeSocket({
      userId: "user-a",
      authorizationExpiresAt: Date.now() + 60_000,
    });
    const hub = new ChannelActivityHub(
      { getWebSockets: () => [socket] } as unknown as DurableObjectState,
      {} as Env,
    );
    const issueFrame: IssueAgentActivityFrame = {
      replyJobId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      attempt: 1,
      sequence: 1,
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      triggerMessageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      parentMessageId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      activity: {
        id: "commentary-1",
        kind: "message",
        headline: "원인을 확인하고 있습니다.",
      },
      sentAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    };
    const response = await hub.fetch(publishRequest(issueFrame));
    expect(response.status).toBe(204);
    expect(decodeFrame(socket.sent[0])).toMatchObject({
      projectId: issueFrame.projectId,
      activity: { kind: "message" },
    });
  });
});

describe("activity hub adapters", () => {
  it("uses distinct hub names while sharing the subscribe request", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(null, { status: 204 })
    );
    const getByName = vi.fn((_name: string) => ({ fetch }));
    const env = {
      CHANNEL_ACTIVITY_REALTIME: { getByName },
    } as unknown as Env;
    const authorizationExpiresAt = Date.now() + 60_000;

    await subscribeToChannelActivity(env, {
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      channelId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      userId: "user-a",
      authorizationExpiresAt,
    });
    await subscribeToIssueActivity(env, {
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      userId: "user-a",
      authorizationExpiresAt,
    });

    expect(getByName.mock.calls.map(([name]) => name)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:issue:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222",
    ]);
    for (const [url, init] of fetch.mock.calls) {
      expect(String(url)).toContain("/subscribe?userId=user-a&authorizationExpiresAt=");
      expect(init).toEqual({ headers: { Upgrade: "websocket" } });
    }
  });

  it("uses the shared publish request and preserves scope-specific errors", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(null, { status: 503 })
    );
    const env = {
      CHANNEL_ACTIVITY_REALTIME: { getByName: vi.fn(() => ({ fetch })) },
    } as unknown as Env;
    const channelFrame = frame(1);
    const issueFrame: IssueAgentActivityFrame = {
      replyJobId: channelFrame.replyJobId,
      attempt: channelFrame.attempt,
      sequence: channelFrame.sequence,
      projectId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      triggerMessageId: channelFrame.triggerMessageId,
      parentMessageId: channelFrame.parentMessageId,
      activity: channelFrame.activity,
      sentAt: channelFrame.sentAt,
      expiresAt: channelFrame.expiresAt,
    };

    await expect(publishChannelActivity(
      env,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      channelFrame,
    )).rejects.toThrow("Channel activity publish failed (503)");
    await expect(publishIssueActivity(
      env,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      issueFrame,
    )).rejects.toThrow("Issue activity publish failed (503)");

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url] of fetch.mock.calls) {
      expect(url).toBe("https://channel-activity.internal/publish");
    }
  });
});
