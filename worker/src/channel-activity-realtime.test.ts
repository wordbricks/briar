import { describe, expect, it, vi } from "vitest";
import {
  CHANNEL_AGENT_ACTIVITY_VERSION,
  type ChannelAgentActivityFrame,
  type IssueAgentActivityFrame,
} from "../../src/lib/channel-agent-activity";
import { ChannelActivityHub } from "./channel-activity-realtime";

class FakeSocket {
  sent: string[] = [];
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

  send(value: string) {
    this.sent.push(value);
  }
}

const frame = (sequence: number): ChannelAgentActivityFrame => ({
  version: CHANNEL_AGENT_ACTIVITY_VERSION,
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
      const response = await hub.fetch(new Request("https://activity.test/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(frame(sequence)),
      }));
      expect(response.status).toBe(204);
    }
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toMatchObject({ sequence: 2 });
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
    await hub.fetch(new Request("https://activity.test/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(frame(1)),
    }));
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
      await hub.fetch(new Request("https://activity.test/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      }));
    }
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toMatchObject({
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
      version: CHANNEL_AGENT_ACTIVITY_VERSION,
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
    const response = await hub.fetch(new Request("https://activity.test/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(issueFrame),
    }));
    expect(response.status).toBe(204);
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      projectId: issueFrame.projectId,
      activity: { kind: "message" },
    });
  });
});
