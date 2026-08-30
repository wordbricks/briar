import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vitest";
import {
  type AgentReplyActivityFrame,
  decodeAgentReplyActivityFrameBinaryOption,
} from "../../src/lib/channel-agent-activity";
import {
  channelActivityCredential,
  flushOrganizationInboxRealtimeOutbox,
  issueActivityCredential,
  scheduleChannelActivityClear,
  scheduleInboxRealtimeFlush,
  scheduleIssueActivityClear,
} from "./realtime-scheduling";
import {
  verifyChannelActivityPublishToken,
  verifyIssueActivityPublishToken,
} from "./channel-activity-ticket";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const channelId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const replyJobId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const agentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const triggerMessageId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const parentMessageId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const channelJob = (leaseExpiresAt: string | null) => ({
  id: replyJobId,
  organization_id: organizationId,
  channel_id: channelId,
  agent_id: agentId,
  trigger_message_id: triggerMessageId,
  parent_message_id: parentMessageId,
  attempts: 2,
  lease_expires_at: leaseExpiresAt,
});

const issueJob = (leaseExpiresAt: string | null) => ({
  id: replyJobId,
  project_id: projectId,
  run_id: runId,
  trigger_message_id: triggerMessageId,
  parent_message_id: parentMessageId,
  attempts: 3,
  lease_expires_at: leaseExpiresAt,
});

describe("activity scheduling adapters", () => {
  it("preserves channel and issue credential payload scopes", async () => {
    const now = Date.now();
    const leaseExpiresAt = new Date(now + 60_000).toISOString();
    const env = { BETTER_AUTH_SECRET: "secret" } as Env;
    const worker = { workerId: "worker-a", deviceId: "device-a" };

    const channel = await channelActivityCredential(
      env,
      channelJob(leaseExpiresAt),
      worker,
    );
    await expect(verifyChannelActivityPublishToken(
      "secret",
      channel.token,
      replyJobId,
      now + 1,
    )).resolves.toMatchObject({ organizationId, channelId, agentId, attempt: 2 });

    const issue = await issueActivityCredential(
      env,
      organizationId,
      issueJob(leaseExpiresAt),
      worker,
    );
    await expect(verifyIssueActivityPublishToken(
      "secret",
      issue.token,
      replyJobId,
      now + 1,
    )).resolves.toMatchObject({ organizationId, projectId, runId, attempt: 3 });
  });

  it("publishes terminal tombstones through the shared clear scheduler", async () => {
    const requests: Array<{ name: string; body: AgentReplyActivityFrame }> = [];
    const pending: Promise<unknown>[] = [];
    const env = {
      CHANNEL_ACTIVITY_REALTIME: {
        getByName: vi.fn((name: string) => ({
          fetch: vi.fn(async (_url: string, init: RequestInit) => {
            if (!(init.body instanceof Uint8Array)) {
              throw new Error("Expected a protobuf activity frame");
            }
            requests.push({
              name,
              body: Option.getOrThrow(
                decodeAgentReplyActivityFrameBinaryOption(init.body),
              ),
            });
            return new Response(null, { status: 204 });
          }),
        })),
      },
    } as unknown as Env;
    const context = {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    } as unknown as ExecutionContext;

    scheduleChannelActivityClear(env, channelJob(null), context);
    scheduleIssueActivityClear(env, organizationId, issueJob(null), context);
    await Promise.all(pending);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      name: `${organizationId}:${channelId}`,
      body: {
        sequence: BigInt(Number.MAX_SAFE_INTEGER),
        scope: { case: "channel", value: { channelId } },
      },
    });
    expect(requests[1]).toMatchObject({
      name: `${organizationId}:issue:${projectId}:${runId}`,
      body: {
        sequence: BigInt(Number.MAX_SAFE_INTEGER),
        scope: { case: "issue", value: { projectId, runId } },
      },
    });
    expect(requests[0]?.body.activity).toBeUndefined();
    expect(requests[1]?.body.activity).toBeUndefined();
  });

  it("rejects missing leases before issuing either credential", async () => {
    const env = { BETTER_AUTH_SECRET: "secret" } as Env;
    const worker = { workerId: "worker-a", deviceId: "device-a" };
    await expect(channelActivityCredential(env, channelJob(null), worker))
      .rejects.toThrow("Reply claim has no active lease");
    await expect(
      issueActivityCredential(env, organizationId, issueJob(null), worker),
    )
      .rejects.toThrow("Reply claim has no active lease");
  });

  it("does not schedule an Inbox flush without realtime or push providers", () => {
    const waitUntil = vi.fn();
    scheduleInboxRealtimeFlush(
      {} as Env,
      {} as D1Database,
      { waitUntil } as unknown as ExecutionContext,
    );
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("does not let a slow failing push provider delay realtime fan-out", async () => {
    let rejectPush: (error: Error) => void = () => undefined;
    const push = new Promise<void>((_resolve, reject) => {
      rejectPush = reject;
    });
    const publishRealtime = vi.fn(async () => undefined);
    const acknowledgeRealtime = vi.fn(async () => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const flushing = flushOrganizationInboxRealtimeOutbox(
      { CHANNEL_REALTIME: {} } as Env,
      {} as D1Database,
      {
        mobilePushProvidersConfigured: () => true,
        flushMobilePushOutbox: () => push,
        listRealtimeOutbox: async () => [{
          organization_id: organizationId,
          version: 4,
        }],
        publishRealtime,
        acknowledgeRealtime,
      },
    );

    await vi.waitFor(() => expect(publishRealtime).toHaveBeenCalledOnce());
    expect(acknowledgeRealtime).toHaveBeenCalledOnce();
    rejectPush(new Error("provider unavailable"));
    await expect(flushing).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(
      "Mobile push outbox flush failed",
    ));
    consoleError.mockRestore();
  });
});
