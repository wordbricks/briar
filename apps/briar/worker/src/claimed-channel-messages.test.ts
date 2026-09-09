import { createHash } from "node:crypto";
import {
  WorkerExecutionService} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { Code, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import {
  addChannelAgent,
  claimNextChannelAgentReply,
  createChannel,
  createChannelMessage,
  enqueueChannelAgentReplies,
} from "./channels";
import { createOrganizationAgent } from "./organization-agents";
import {
  listClaimedChannelReplyMessagesApplication,
  TeamAgentChannelApplicationError,
} from "./team-agent-channel-application";
import {
  workerClaimRuntimeFixture,
  workerRuntimeProtoJsonFixture,
} from "./test-helpers/worker-runtime";

/**
 * The claim-scoped read a Worker execution session uses instead of a member's
 * Project Agent token. Every negative case here is a way the claim stops
 * covering the session: another device, a dead lease, a finished job, or an
 * Agent that left the channel roster.
 */
describe("claim-scoped channel message history", () => {
  const db = cloudflareEnv.DB;
  const organizationId = "1a000000-0000-4000-8000-000000000001";
  const otherOrganizationId = "1a000000-0000-4000-8000-000000000002";
  const projectId = "1b000000-0000-4000-8000-000000000001";
  const deviceId = "1c000000-0000-4000-8000-000000000001";
  const workerId = "1d000000-0000-4000-8000-000000000001";
  const agentId = "1e000000-0000-4000-8000-000000000001";
  const channelId = "1f000000-0000-4000-8000-000000000001";
  const olderMessageId = "20000000-0000-4000-8000-000000000001";
  const triggerMessageId = "20000000-0000-4000-8000-000000000002";
  const ownerId = "claimed-history-owner";
  const claimTokenHash = "7".repeat(64);
  const leaseExpiresAt = "2099-01-01T00:00:00.000Z";
  const workerToken = "briar_worker_claimed-history";
  const agentToken = "briar_agent_claimed_history";
  const at = (minute: number) =>
    new Date(Date.UTC(2026, 1, 2, 0, minute)).toISOString();
  const sha256Hex = (value: string) =>
    createHash("sha256").update(value).digest("hex");

  let jobId: string;

  beforeAll(async () => {
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Claimed History Owner', 'claimed-history@example.com', 1, ?, ?)`,
      ).bind(ownerId, at(0), at(0)),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Claimed History Org', 'claimed-history-org', ?, ?)`,
      ).bind(organizationId, at(0), at(0)),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Other Claimed Org', 'other-claimed-org', ?, ?)`,
      ).bind(otherOrganizationId, at(0), at(0)),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, at(0), at(0)),
      db.prepare(
        `insert into briar_teams (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Claimed History Project', ?, ?, ?)`,
      ).bind(
        projectId,
        ownerId,
        organizationId,
        sha256Hex(agentToken),
        at(0),
        at(0),
      ),
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Claimed Device', ?, 'online', ?, ?, ?)`,
      ).bind(
        deviceId,
        organizationId,
        ownerId,
        sha256Hex("claimed-history-device"),
        at(0),
        at(0),
        at(0),
      ),
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at
         ) values (?, ?, ?)`,
      ).bind(deviceId, sha256Hex(workerToken), at(0)),
    ]);
    await db.prepare(
      `insert into briar_execution_workers (
         id, project_id, label, host_fingerprint, runtime_proto_json, state,
         last_heartbeat_at, created_at, updated_at, device_id
       ) values (?, ?, 'Claimed Worker', ?, ?, 'online', ?, ?, ?, ?)`,
    ).bind(
      workerId,
      projectId,
      sha256Hex("claimed-history-host"),
      workerRuntimeProtoJsonFixture({
        agentProvider: "claude",
        providers: ["claude"],
      }),
      at(0),
      at(0),
      at(0),
      deviceId,
    ).run();
    await createChannel(db, {
      id: channelId,
      organizationId,
      kind: "channel",
      dmKey: null,
      slug: "claimed-history",
      name: "Claimed history",
      topic: null,
      visibility: "private",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(0),
    });
    await createOrganizationAgent(db, {
      id: agentId,
      organizationId,
      name: "Historian",
      provider: "claude",
      model: null,
      responsibility: "Read the channel it is replying in",
      effort: null,
      createdAt: at(0),
    });
    await addChannelAgent(db, {
      channelId,
      agentId,
      addedByUserId: ownerId,
      createdAt: at(0),
    });
    for (const [index, id] of [olderMessageId, triggerMessageId].entries()) {
      await createChannelMessage(db, {
        id,
        channelId,
        parentMessageId: null,
        authorUserId: ownerId,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentProvider: null,
        body: index === 0 ? "Earlier context" : "@historian what happened?",
        mentionedUserIds: [],
        mentionedAgentIds: index === 0 ? [] : [agentId],
        createdAt: at(index + 1),
      });
    }
    await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId,
      parentMessageId: triggerMessageId,
      agents: [{ id: agentId, projectId: null, provider: "claude" }],
      createdAt: at(2),
    });
    await db.prepare(
      `update briar_execution_workers
       set runtime_proto_json = ?, last_heartbeat_at = ? where id = ?`,
    ).bind(
      workerClaimRuntimeFixture({
        agentProvider: "claude",
        providers: ["claude"],
      }).runtimeProtoJson,
      new Date().toISOString(),
      workerId,
    ).run();
    const claimed = await claimNextChannelAgentReply(db, organizationId, {
      deviceId,
      workerId,
      ...workerClaimRuntimeFixture({
        agentProvider: "claude",
        providers: ["claude"],
      }),
      claimTokenHash,
      claimedAt: at(3),
      // Far future so the RPC test, which stamps the real clock, still sees a
      // live lease. Lease expiry is exercised through an explicit observedAt.
      leaseExpiresAt: leaseExpiresAt,
    });
    expect(claimed).not.toBeNull();
    jobId = claimed!.id;
  }, 60_000);

  const list = (
    overrides: Partial<
      Parameters<typeof listClaimedChannelReplyMessagesApplication>[0]
    > = {},
  ) => listClaimedChannelReplyMessagesApplication({
    db,
    organizationId,
    deviceId,
    jobId,
    parentMessageId: null,
    cursor: null,
    limit: 50,
    observedAt: at(10),
    ...overrides,
  });

  const rejects = async (
    overrides: Parameters<typeof list>[0],
    reason: string,
  ) => {
    const error = await list(overrides).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(TeamAgentChannelApplicationError);
    expect((error as TeamAgentChannelApplicationError).reason).toBe(reason);
    // A Worker credential never expires; the wording must not send the reader
    // looking for an expired token.
    expect((error as Error).message).not.toMatch(/만료|expired/iu);
  };

  it("reads the channel the running claim is replying in", async () => {
    const result = await list();

    expect(result.channel).toMatchObject({
      id: channelId,
      name: "Claimed history",
    });
    expect(result.messages.map((message) => message.id)).toEqual([
      olderMessageId,
      triggerMessageId,
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it("refuses another device, a dead lease, and another organization", async () => {
    await rejects(
      { deviceId: "1c000000-0000-4000-8000-000000000009" },
      "claim_not_active",
    );
    await rejects({ observedAt: "2099-06-01T00:00:00.000Z" }, "claim_not_active");
    await rejects({ organizationId: otherOrganizationId }, "claim_not_active");
    await rejects(
      { jobId: "1f000000-0000-4000-8000-000000000099" },
      "claim_not_active",
    );
  });

  it("refuses once the Agent leaves the channel roster", async () => {
    await db.prepare(
      `delete from briar_channel_agents where channel_id = ? and agent_id = ?`,
    ).bind(channelId, agentId).run();
    try {
      await rejects({}, "claim_not_active");
    } finally {
      await addChannelAgent(db, {
        channelId,
        agentId,
        addedByUserId: ownerId,
        createdAt: at(4),
      });
    }
    await expect(list()).resolves.toMatchObject({
      channel: { id: channelId },
    });
  });

  it("refuses a job that is no longer running", async () => {
    await db.prepare(
      `update briar_channel_agent_reply_jobs set status = 'completed' where id = ?`,
    ).bind(jobId).run();
    try {
      await rejects({}, "claim_not_active");
    } finally {
      await db.prepare(
        `update briar_channel_agent_reply_jobs set status = 'running' where id = ?`,
      ).bind(jobId).run();
    }
  });

  it("rejects a cursor and a thread parent outside the claimed channel", async () => {
    await rejects(
      { cursor: "20000000-0000-4000-8000-000000000099" },
      "cursor_invalid",
    );
    await rejects(
      { parentMessageId: "20000000-0000-4000-8000-000000000099" },
      "thread_parent_not_found",
    );
  });

  const client = () => createClient(
    WorkerExecutionService,
    createConnectTransport({
      baseUrl: "https://briar.example",
      useBinaryFormat: true,
      fetch: async (input, init) =>
        worker.fetch(
          new Request(input, { ...init, redirect: "manual" }),
          {
            DB: db,
            BETTER_AUTH_SECRET:
              "briar-test-secret-that-is-at-least-32-characters",
            GOOGLE_CLIENT_ID: "google-client",
            GOOGLE_CLIENT_SECRET: "google-secret",
          } as never,
        ),
    }),
  );

  it("serves the RPC on the Worker credential and refuses an Agent token", async () => {
    let responseHeaders: Headers | undefined;
    const response = await client().listClaimedChannelMessages(
      { workId: jobId, limit: 10 },
      {
        headers: { authorization: `Bearer ${workerToken}` },
        onHeader: (headers) => {
          responseHeaders = headers;
        },
      },
    );
    expect(responseHeaders?.get("cache-control")).toBe("private, no-store");
    expect(response.channel).toMatchObject({ id: channelId });
    expect(response.messages.map((message) => message.id)).toEqual([
      olderMessageId,
      triggerMessageId,
    ]);

    // The claim-scoped route is a Worker-credential route only: a Project
    // Agent token has no device identity to match the claim against.
    await expect(
      client().listClaimedChannelMessages(
        { workId: jobId },
        { headers: { authorization: `Bearer ${agentToken}` } },
      ),
    ).rejects.toMatchObject({ code: Code.Unauthenticated });
  });
});
