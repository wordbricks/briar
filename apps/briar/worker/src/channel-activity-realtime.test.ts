import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  AgentActivitySchema,
  AgentReplyActivityFrameSchema,
  ChannelActivityScopeSchema,
  IssueActivityScopeSchema,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { AgentActivityKind } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vitest";
import {
  decodeAgentReplyActivityFrameBinaryOption,
  encodeAgentReplyActivityFrameBinary,
  type AgentReplyActivityFrame,
} from "../../src/lib/channel-agent-activity";
import {
  publishChannelActivity,
  publishIssueActivity,
  subscribeToChannelActivity,
  subscribeToIssueActivity,
} from "./channel-activity-realtime";

const activity = create(AgentActivitySchema, {
  id: "command-1",
  kind: AgentActivityKind.COMMAND,
  headline: "Running tests",
});

const frame = (
  sequence: number,
  frameActivity = activity,
): AgentReplyActivityFrame => create(AgentReplyActivityFrameSchema, {
  replyJobId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  attempt: 1,
  sequence: BigInt(sequence),
  triggerMessageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  parentMessageId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  activity: frameActivity,
  sentAt: timestampFromDate(new Date()),
  expiresAt: timestampFromDate(new Date(Date.now() + 30_000)),
  scope: {
    case: "channel",
    value: create(ChannelActivityScopeSchema, {
      agentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      channelId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
  },
});

const issueFrame = (): AgentReplyActivityFrame =>
  create(AgentReplyActivityFrameSchema, {
    ...frame(1),
    activity: create(AgentActivitySchema, {
      id: "commentary-1",
      kind: AgentActivityKind.MESSAGE,
      headline: "원인을 확인하고 있습니다.",
    }),
    scope: {
      case: "issue",
      value: create(IssueActivityScopeSchema, {
        projectId: "11111111-1111-4111-8111-111111111111",
        runId: "22222222-2222-4222-8222-222222222222",
      }),
    },
  });

const publishRequest = (value: AgentReplyActivityFrame) =>
  new Request("https://activity.test/publish", {
    method: "POST",
    headers: { "Content-Type": "application/protobuf" },
    body: encodeAgentReplyActivityFrameBinary(value),
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
  return Option.getOrThrow(decodeAgentReplyActivityFrameBinaryOption(bytes));
};

function openWebSocket(response: Response) {
  const socket = response.webSocket;
  if (!socket) throw new TypeError("Expected WebSocket upgrade response");
  const queuedMessages: unknown[] = [];
  const waitingMessages: Array<(value: unknown) => void> = [];
  const queuedCloses: Array<{ code: number; reason: string }> = [];
  const waitingCloses: Array<
    (value: { code: number; reason: string }) => void
  > = [];
  socket.addEventListener("message", (event) => {
    const resolve = waitingMessages.shift();
    if (resolve) resolve(event.data);
    else queuedMessages.push(event.data);
  });
  socket.addEventListener("close", (event) => {
    const value = { code: event.code, reason: event.reason };
    const resolve = waitingCloses.shift();
    if (resolve) resolve(value);
    else queuedCloses.push(value);
  });
  socket.accept();
  return {
    socket,
    nextMessage: () => {
      const value = queuedMessages.shift();
      return value === undefined
        ? new Promise<unknown>((resolve) => waitingMessages.push(resolve))
        : Promise.resolve(value);
    },
    nextClose: () => {
      const value = queuedCloses.shift();
      return value === undefined
        ? new Promise<{ code: number; reason: string }>((resolve) =>
          waitingCloses.push(resolve)
        )
        : Promise.resolve(value);
    },
  };
}

async function subscribe(
  stub: DurableObjectStub,
  authorizationExpiresAt = Date.now() + 60_000,
) {
  const query = new URLSearchParams({
    userId: "user-a",
    authorizationExpiresAt: String(authorizationExpiresAt),
  });
  return openWebSocket(await stub.fetch(
    `https://activity.test/subscribe?${query}`,
    { headers: { Upgrade: "websocket" } },
  ));
}

describe("ChannelActivityHub", () => {
  it("fans out the latest sequence and rejects stale updates", async () => {
    const stub = env.CHANNEL_ACTIVITY_REALTIME.getByName(crypto.randomUUID());
    const realtime = await subscribe(stub);
    for (const sequence of [2, 1]) {
      const response = await stub.fetch(publishRequest(frame(sequence)));
      expect(response.status).toBe(204);
    }
    expect(await decodeFrame(await realtime.nextMessage()))
      .toMatchObject({ sequence: 2n });

    const otherReply = create(AgentReplyActivityFrameSchema, {
      ...frame(3),
      replyJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    await stub.fetch(publishRequest(otherReply));
    expect(await decodeFrame(await realtime.nextMessage()))
      .toMatchObject({ replyJobId: otherReply.replyJobId, sequence: 3n });
    realtime.socket.close(1000, "done");
  });

  it("rejects a protobuf frame without a scope oneof", async () => {
    const stub = env.CHANNEL_ACTIVITY_REALTIME.getByName(crypto.randomUUID());
    const invalid = create(AgentReplyActivityFrameSchema, {
      ...frame(1),
      scope: { case: undefined },
    });

    const response = await stub.fetch(publishRequest(invalid));

    expect(response.status).toBe(400);
  });

  it("closes expired subscribers before sending private activity", async () => {
    const stub = env.CHANNEL_ACTIVITY_REALTIME.getByName(crypto.randomUUID());
    const authorizationExpiresAt = Date.now() + 200;
    const realtime = await subscribe(stub, authorizationExpiresAt);
    await evictDurableObject(stub);
    await new Promise((resolve) => {
      setTimeout(resolve, authorizationExpiresAt - Date.now() + 1);
    });

    await stub.fetch(publishRequest(frame(1)));

    await expect(realtime.nextClose()).resolves.toEqual({
      code: 4003,
      reason: "Agent activity authorization expired",
    });
  });

  it("keeps a completion tombstone from being overwritten by a late publish", async () => {
    const stub = env.CHANNEL_ACTIVITY_REALTIME.getByName(crypto.randomUUID());
    const cleared = create(AgentReplyActivityFrameSchema, {
      ...frame(Number.MAX_SAFE_INTEGER),
      activity: undefined,
    });
    for (const update of [cleared, frame(3)]) {
      await stub.fetch(publishRequest(update));
    }
    const realtime = await subscribe(stub);
    const tombstone = await decodeFrame(await realtime.nextMessage());
    expect(tombstone).toMatchObject({
      sequence: BigInt(Number.MAX_SAFE_INTEGER),
    });
    expect(tombstone.activity).toBeUndefined();
    realtime.socket.close(1000, "done");
  });

  it("fans out issue-scoped commentary frames through the same ephemeral hub", async () => {
    const stub = env.CHANNEL_ACTIVITY_REALTIME.getByName(crypto.randomUUID());
    const realtime = await subscribe(stub);
    const issue = issueFrame();
    const response = await stub.fetch(publishRequest(issue));
    expect(response.status).toBe(204);
    expect(await decodeFrame(await realtime.nextMessage())).toMatchObject({
      scope: {
        case: "issue",
        value: { projectId: "11111111-1111-4111-8111-111111111111" },
      },
      activity: { kind: AgentActivityKind.MESSAGE },
    });
    realtime.socket.close(1000, "done");
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
    const issue = issueFrame();

    await expect(publishChannelActivity(
      env,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      issue,
    )).rejects.toThrow("requires channel scope");
    await expect(publishIssueActivity(
      env,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      channelFrame,
    )).rejects.toThrow("requires issue scope");

    await expect(publishChannelActivity(
      env,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      channelFrame,
    )).rejects.toThrow("Channel activity publish failed (503)");
    await expect(publishIssueActivity(
      env,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      issue,
    )).rejects.toThrow("Issue activity publish failed (503)");

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url] of fetch.mock.calls) {
      expect(url).toBe("https://channel-activity.internal/publish");
    }
  });
});
