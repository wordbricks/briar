import { describe, expect, it, vi } from "vitest";
import {
  CHANNEL_AGENT_ACTIVITY_STALE_MS,
  CHANNEL_AGENT_ACTIVITY_VERSION,
} from "../../src/lib/channel-agent-activity";
import {
  channelActivityCredential,
  channelActivityFrame,
  issueActivityCredential,
  issueActivityFrame,
  scheduleChannelActivityClear,
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
  it("builds channel and issue frames with one expiry policy", () => {
    const now = Date.UTC(2026, 7, 26, 0, 0, 0);
    const input = {
      sequence: 4,
      activity: { id: "tool-1", kind: "tool" as const, headline: "Testing" },
    };

    expect(channelActivityFrame(channelJob(null), input, now)).toEqual({
      version: CHANNEL_AGENT_ACTIVITY_VERSION,
      replyJobId,
      attempt: 2,
      sequence: 4,
      agentId,
      channelId,
      triggerMessageId,
      parentMessageId,
      activity: input.activity,
      sentAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CHANNEL_AGENT_ACTIVITY_STALE_MS).toISOString(),
    });
    expect(issueActivityFrame(issueJob(null), input, now)).toEqual({
      version: CHANNEL_AGENT_ACTIVITY_VERSION,
      replyJobId,
      attempt: 3,
      sequence: 4,
      projectId,
      runId,
      triggerMessageId,
      parentMessageId,
      activity: input.activity,
      sentAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CHANNEL_AGENT_ACTIVITY_STALE_MS).toISOString(),
    });
  });

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
    const requests: Array<{ name: string; body: unknown }> = [];
    const pending: Promise<unknown>[] = [];
    const env = {
      CHANNEL_ACTIVITY_REALTIME: {
        getByName: vi.fn((name: string) => ({
          fetch: vi.fn(async (_url: string, init: RequestInit) => {
            requests.push({
              name,
              body: JSON.parse(String(init.body)),
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
      body: { channelId, sequence: Number.MAX_SAFE_INTEGER, activity: null },
    });
    expect(requests[1]).toMatchObject({
      name: `${organizationId}:issue:${projectId}:${runId}`,
      body: { projectId, runId, sequence: Number.MAX_SAFE_INTEGER, activity: null },
    });
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
});
