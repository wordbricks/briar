import { createHmac } from "node:crypto";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { sha256 } from "./crypto-digest";
import { executeD1Sql } from "./test-helpers/d1-sql";
import { workerRuntimeProtoJsonFixture } from "./test-helpers/worker-runtime";
import { encryptWhatsAppToken } from "./whatsapp";
import { flushWhatsAppOutbox } from "./whatsapp-outbox";
import {
  claimWhatsAppEvent,
  completeWhatsAppEvent,
  enqueueWhatsAppReplyStatements,
  enqueueWhatsAppSystemMessage,
  getWhatsAppConnectionForWorkspace,
  releaseWhatsAppEvent,
  upsertWhatsAppConnection,
  upsertWhatsAppUserLink,
} from "./whatsapp-repository";

describe("WhatsApp DM bridge D1 integration", () => {
  const db = env.DB;
  const whatsappTestEnv = env as typeof env & {
    WHATSAPP_APP_SECRET: string;
    WHATSAPP_TOKEN_ENCRYPTION_KEY: string;
  };
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const organizationAgentId = "22222222-2222-4222-8222-222222222222";
  const projectId = "33333333-3333-4333-8333-333333333333";
  const projectAgentId = "44444444-4444-4444-8444-444444444444";
  const linkedUserId = "whatsapp-linked-user";
  const ownerId = "whatsapp-owner";
  const phoneNumberId = "101010101010";
  const linkedPhone = "821012345678";
  const accessToken = "whatsapp-access-token-secret";
  const verifyToken = "whatsapp-webhook-verify-token";
  const now = "2026-09-06T00:00:00.000Z";

  beforeAll(async () => {
    await executeD1Sql(db, `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('${ownerId}', 'Owner', 'wa-owner@example.com', 1, '${now}', '${now}');
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('${linkedUserId}', 'Linked', 'wa-linked@example.com', 1, '${now}', '${now}');
      insert into "session" (
        id, expiresAt, token, createdAt, updatedAt, userId
      ) values (
        'whatsapp-owner-session', '2099-01-01T00:00:00.000Z',
        'whatsapp-owner-session-token', '${now}', '${now}', '${ownerId}'
      );
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${workspaceId}', 'WhatsApp Org', 'whatsapp-org', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${workspaceId}', '${ownerId}', 'owner', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${workspaceId}', '${linkedUserId}', 'developer', '${now}', '${now}');
      insert into briar_teams (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        '${projectId}', '${ownerId}', '${workspaceId}', 'WhatsApp Project',
        '${"a".repeat(64)}', '${now}', '${now}'
      );
      insert into briar_project_agents (
        id, organization_id, project_id, handle, name, provider,
        responsibility, created_at, updated_at
      ) values (
        '${organizationAgentId}', '${workspaceId}', null, 'representative',
        'Representative', 'codex', 'Represent the workspace', '${now}', '${now}'
      );
      insert into briar_project_agents (
        id, organization_id, project_id, handle, name, provider,
        responsibility, created_at, updated_at
      ) values (
        '${projectAgentId}', '${workspaceId}', '${projectId}', 'project-agent',
        'Project Agent', 'codex', 'Work on the project', '${now}', '${now}'
      );
    `);
    const encrypted = await encryptWhatsAppToken(
      accessToken,
      whatsappTestEnv.WHATSAPP_TOKEN_ENCRYPTION_KEY,
    );
    await upsertWhatsAppConnection(db, {
      workspaceId,
      agentId: organizationAgentId,
      phoneNumberId,
      wabaId: "202020202020",
      encryptedAccessToken: encrypted.encryptedToken,
      tokenIv: encrypted.iv,
      verifyTokenHash: await sha256(verifyToken),
      connectedByUserId: ownerId,
      observedAt: now,
    });
    await upsertWhatsAppUserLink(db, {
      workspaceId,
      userId: linkedUserId,
      phoneNumber: linkedPhone,
      createdByUserId: ownerId,
      observedAt: now,
    });
  });

  const signedRequest = (input: {
    wamid: string;
    from: string;
    body?: string;
    type?: string;
    validSignature?: boolean;
  }) => {
    const type = input.type ?? "text";
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: phoneNumberId },
            messages: [{
              from: input.from,
              id: input.wamid,
              timestamp: "1788652800",
              type,
              ...(type === "text" ? { text: { body: input.body ?? "질문" } } : {}),
            }],
          },
        }],
      }],
    });
    const signature = input.validSignature === false
      ? `sha256=${"0".repeat(64)}`
      : `sha256=${createHmac("sha256", whatsappTestEnv.WHATSAPP_APP_SECRET)
        .update(body).digest("hex")}`;
    return new Request("https://briar-api.example/whatsapp/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
      },
      body,
    });
  };

  it("stores encrypted credentials and rejects a project Agent representative", async () => {
    const connection = await getWhatsAppConnectionForWorkspace(db, workspaceId);
    expect(connection?.encrypted_access_token).not.toBe(accessToken);
    expect(connection?.verify_token_hash).toBe(await sha256(verifyToken));
    const encrypted = await encryptWhatsAppToken(
      "replacement-token",
      whatsappTestEnv.WHATSAPP_TOKEN_ENCRYPTION_KEY,
    );
    await expect(upsertWhatsAppConnection(db, {
      workspaceId,
      agentId: projectAgentId,
      phoneNumberId,
      wabaId: "202020202020",
      encryptedAccessToken: encrypted.encryptedToken,
      tokenIv: encrypted.iv,
      verifyTokenHash: await sha256("replacement-verify-token"),
      connectedByUserId: ownerId,
      observedAt: "2026-09-06T00:01:00.000Z",
    // The D1 trigger message is a SQL string, so it keeps the pre-rename wording.
    })).rejects.toThrow("Organization Agent");
    await expect(getWhatsAppConnectionForWorkspace(db, workspaceId))
      .resolves.toMatchObject({ agent_id: organizationAgentId });
  });

  it("claims each wamid once while allowing released work to retry", async () => {
    const connection = await getWhatsAppConnectionForWorkspace(db, workspaceId);
    expect(connection).not.toBeNull();
    const input = {
      connectionId: connection!.id,
      wamid: "wamid.dedup",
      senderPhone: linkedPhone,
      messageId: "55555555-5555-4555-8555-555555555555",
      observedAt: now,
      staleBefore: "2026-09-05T23:55:00.000Z",
    };
    await expect(claimWhatsAppEvent(db, input)).resolves.toEqual({
      message_id: input.messageId,
    });
    await expect(claimWhatsAppEvent(db, {
      ...input,
      messageId: "66666666-6666-4666-8666-666666666666",
      observedAt: "2026-09-06T00:01:00.000Z",
      staleBefore: "2026-09-05T23:56:00.000Z",
    })).resolves.toBeNull();
    await releaseWhatsAppEvent(db, input.connectionId, input.wamid);
    await expect(claimWhatsAppEvent(db, input)).resolves.toEqual({
      message_id: input.messageId,
    });
    await completeWhatsAppEvent(db, input.connectionId, input.wamid, now);
    await expect(claimWhatsAppEvent(db, input)).resolves.toBeNull();
  });

  it("verifies the challenge and rejects an invalid webhook signature", async () => {
    const challenge = await worker.fetch(new Request(
      `https://briar-api.example/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=challenge-123`,
    ), env);
    expect(challenge.status).toBe(200);
    await expect(challenge.text()).resolves.toBe("challenge-123");

    const rejected = await worker.fetch(signedRequest({
      wamid: "wamid.invalid-signature",
      from: linkedPhone,
      body: "위조 메시지",
      validSignature: false,
    }), env);
    expect(rejected.status).toBe(401);
    await expect(db.prepare(
      `select count(*) as count from briar_whatsapp_events where wamid = ?`,
    ).bind("wamid.invalid-signature").first()).resolves.toEqual({ count: 0 });
  });

  it("creates one user-authored DM message and implicit reply job for a linked number", async () => {
    const request = () => signedRequest({
      wamid: "wamid.linked-roundtrip",
      from: linkedPhone,
      body: "대표 에이전트에게 질문합니다.",
    });
    expect((await worker.fetch(request(), env)).status).toBe(200);
    await db.prepare(
      `delete from briar_whatsapp_events where wamid = ?`,
    ).bind("wamid.linked-roundtrip").run();
    expect((await worker.fetch(request(), env)).status).toBe(200);
    const channel = await db.prepare(
      `select id, dm_key from briar_channels
       where organization_id = ? and kind = 'dm'`,
    ).bind(workspaceId).first<{ id: string; dm_key: string }>();
    expect(channel?.dm_key).toBe(
      `agent:${JSON.stringify([linkedUserId, organizationAgentId])}`,
    );
    await expect(db.prepare(
      `select count(*) as count from briar_channel_messages
       where channel_id = ? and author_user_id = ? and body = ?`,
    ).bind(
      channel!.id,
      linkedUserId,
      "대표 에이전트에게 질문합니다.",
    ).first()).resolves.toEqual({ count: 1 });
    await expect(db.prepare(
      `select count(*) as count from briar_channel_agent_reply_jobs
       where channel_id = ? and agent_id = ?`,
    ).bind(channel!.id, organizationAgentId).first()).resolves.toEqual({ count: 1 });
  });

  /*
    The webhook answers Meta before the message is stored, so the wake the
    inbound DM enqueues has to be registered on the request's ExecutionContext.
    Left off it, the poke would run as a dangling promise the runtime is free to
    cancel once the response is sent.
  */
  it("wakes the workspace's Workers under waitUntil for an inbound DM", async () => {
    // A reply is only claimable — and so only worth a wake — while some live
    // Worker can run the representative Agent.
    const wakeDeviceId = "99999999-9999-4999-8999-999999999999";
    const wakeWorkerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const live = new Date().toISOString();
    await db.batch([
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Wake Device', ?, 'online', ?, ?, ?)`,
      ).bind(wakeDeviceId, workspaceId, ownerId, "e".repeat(64), live, live, live),
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at
         ) values (?, ?, ?)`,
      ).bind(wakeDeviceId, "f".repeat(64), live),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint,
           runtime_proto_json, state, accepting_work, readiness_state,
           last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Wake Worker', ?, ?, 'online', 1, 'ready', ?, ?, ?)`,
      ).bind(
        wakeWorkerId,
        projectId,
        wakeDeviceId,
        "0".repeat(64),
        workerRuntimeProtoJsonFixture({
          agentProvider: "codex",
          providers: ["codex"],
        }),
        live,
        live,
        live,
      ),
    ]);

    const wakes: string[] = [];
    const pending: Promise<unknown>[] = [];
    const wakeEnv = {
      ...env,
      // The DM is owed an acknowledgement emoji too, and the real binding for
      // it only answers remotely. Nothing here reads the model's answer.
      DM_MEMORY_AI: { run: async () => ({ response: "" }) },
      WORKER_WAKE: {
        getByName: (name: string) => {
          wakes.push(name);
          return { fetch: async () => new Response(null, { status: 204 }) };
        },
      },
    } as unknown as typeof env;
    const context = {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    } as unknown as ExecutionContext;

    const response = await worker.fetch(signedRequest({
      wamid: "wamid.wake",
      from: linkedPhone,
      body: "웨이크 확인",
    }), wakeEnv, context);
    // The webhook answers before it stores anything: all of it is deferred.
    expect(response.status).toBe(200);
    expect(pending.length).toBe(1);
    expect(wakes).toEqual([]);

    await Promise.all(pending.splice(0));
    expect(wakes).toEqual([workspaceId]);
    // The message path defers exactly two things and nothing dangling: the
    // wake itself, and the acknowledgement emoji this DM is owed at receipt.
    expect(pending.length).toBe(2);
    await Promise.all(pending.splice(0));
  });

  it("does not create a DM for an unlinked number and sends connection guidance", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.guidance-out" }],
    }));
    vi.stubGlobal("fetch", fetcher);
    try {
      const response = await worker.fetch(signedRequest({
        wamid: "wamid.unlinked",
        from: "821099998888",
        body: "접근 시도",
      }), env);
      expect(response.status).toBe(200);
      expect(fetcher).toHaveBeenCalledOnce();
      const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
      expect(sent.to).toBe("821099998888");
      expect(sent.text.body).toContain("조직 관리자에게 WhatsApp 번호 연결을 요청");
      await expect(db.prepare(
        `select count(*) as count from briar_channel_messages
         where body = '접근 시도'`,
      ).first()).resolves.toEqual({ count: 0 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("queues ordered 4096-character parts and sends them with the decrypted token", async () => {
    const channel = await db.prepare(
      `select id from briar_channels where organization_id = ? and kind = 'dm'`,
    ).bind(workspaceId).first<{ id: string }>();
    const job = await db.prepare(
      `select id, reply_message_id from briar_channel_agent_reply_jobs
       where channel_id = ? and agent_id = ? limit 1`,
    ).bind(channel!.id, organizationAgentId).first<{
      id: string;
      reply_message_id: string;
    }>();
    const deviceId = "77777777-7777-4777-8777-777777777777";
    const workerId = "88888888-8888-4888-8888-888888888888";
    const claimHash = "b".repeat(64);
    await db.batch([
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'WhatsApp Device', ?, 'online', ?, ?, ?)`,
      ).bind(deviceId, workspaceId, ownerId, "c".repeat(64), now, now, now),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, label, host_fingerprint, runtime_proto_json, state,
           last_heartbeat_at, created_at, updated_at, device_id
         ) values (?, ?, 'WhatsApp Worker', ?, ?, 'online', ?, ?, ?, ?)`,
      ).bind(
        workerId,
        projectId,
        "d".repeat(64),
        workerRuntimeProtoJsonFixture({
          agentProvider: "codex",
          providers: ["codex"],
        }),
        now,
        now,
        now,
        deviceId,
      ),
    ]);
    await db.prepare(
      `update briar_channel_agent_reply_jobs
       set status = 'completed', claimed_device_id = ?, claimed_worker_id = ?,
           claim_token_hash = ?, completed_at = ?, updated_at = ?
       where id = ?`,
    ).bind(deviceId, workerId, claimHash, now, now, job!.id).run();
    await db.prepare(
      `insert into briar_channel_messages (
         id, channel_id, parent_message_id, author_user_id, author_agent_id,
         author_agent_name, author_agent_provider, body, created_at, updated_at
       ) values (?, ?, null, null, ?, 'Representative', 'codex', 'reply', ?, ?)`,
    ).bind(job!.reply_message_id, channel!.id, organizationAgentId, now, now).run();
    await db.batch(enqueueWhatsAppReplyStatements(db, {
      jobId: job!.id,
      deviceId,
      workerId,
      claimTokenHash: claimHash,
      completedAt: now,
      workspaceId,
      channelId: channel!.id,
      channelMessageId: job!.reply_message_id,
      body: `# 답변\n${"가".repeat(8_300)}`,
      approvalSummary: "이슈 실행 제안이 도착했습니다.",
      appOrigin: "https://briar-api.example",
    }));
    const parts = await db.prepare(
      `select part_index, part_count, body from briar_whatsapp_outbox
       where channel_message_id = ? order by part_index`,
    ).bind(job!.reply_message_id).all<{
      part_index: number;
      part_count: number;
      body: string;
    }>();
    expect(parts.results.length).toBeGreaterThan(2);
    expect(parts.results.every((part) => Array.from(part.body).length <= 4_096))
      .toBe(true);
    expect(parts.results.at(-1)?.body).toContain("Briar 앱에서만");

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.out" }],
    }));
    for (let index = 0; index < parts.results.length; index += 1) {
      await flushWhatsAppOutbox(env, db, "2026-09-06T00:10:00.000Z", 25, fetcher);
    }
    expect(fetcher).toHaveBeenCalledTimes(parts.results.length);
    expect(fetcher.mock.calls.every((call) =>
      (call[1]?.headers as Record<string, string>).authorization ===
        `Bearer ${accessToken}`
    )).toBe(true);
    await expect(db.prepare(
      `select count(*) as count from briar_whatsapp_outbox
       where channel_message_id = ?`,
    ).bind(job!.reply_message_id).first()).resolves.toEqual({ count: 0 });
  });

  it("retries transient failures and dead-letters expired customer windows", async () => {
    const connection = await getWhatsAppConnectionForWorkspace(db, workspaceId);
    await enqueueWhatsAppSystemMessage(db, {
      connectionId: connection!.id,
      wamid: "wamid.retry",
      recipientPhone: linkedPhone,
      body: "재시도 메시지",
      observedAt: now,
    });
    const failedFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { code: 1, message: "Temporary failure" },
    }, { status: 500 }));
    await expect(flushWhatsAppOutbox(
      env,
      db,
      "2026-09-06T00:01:00.000Z",
      25,
      failedFetch,
    )).resolves.toMatchObject({ retried: 1 });
    await expect(db.prepare(
      `select status, attempts from briar_whatsapp_outbox
       where source_wamid = 'wamid.retry'`,
    ).first()).resolves.toEqual({ status: "pending", attempts: 1 });

    await enqueueWhatsAppSystemMessage(db, {
      connectionId: connection!.id,
      wamid: "wamid.expired",
      recipientPhone: linkedPhone,
      body: "시간 초과 메시지",
      observedAt: "2026-09-04T00:00:00.000Z",
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(flushWhatsAppOutbox(
        env,
        db,
        "2026-09-06T00:00:00.000Z",
        25,
        failedFetch,
      )).resolves.toMatchObject({ deadLettered: 1 });
      await expect(db.prepare(
        `select status, dead_letter_reason from briar_whatsapp_outbox
         where source_wamid = 'wamid.expired'`,
      ).first()).resolves.toMatchObject({
        status: "dead_letter",
        dead_letter_reason: expect.stringContaining("24-hour"),
      });
    } finally {
      errorLog.mockRestore();
    }
  });

  it("exposes a manual owner-only connection and number-link registration path", async () => {
    const headers = {
      authorization: "Bearer whatsapp-owner-session-token",
      "content-type": "application/json",
    };
    const fetched = await worker.fetch(new Request(
      `https://briar-api.example/workspaces/${workspaceId}/integrations/whatsapp`,
      { headers },
    ), env);
    expect(fetched.status).toBe(200);
    const fetchedBody = await fetched.json();
    expect(fetchedBody).toMatchObject({
      connection: {
        agentId: organizationAgentId,
        phoneNumberId,
        wabaId: "202020202020",
      },
      links: [expect.objectContaining({
        userId: linkedUserId,
        phoneNumber: linkedPhone,
      })],
    });
    expect(JSON.stringify(fetchedBody)).not.toContain(accessToken);
    expect(JSON.stringify(fetchedBody)).not.toContain("verify_token_hash");

    const updated = await worker.fetch(new Request(
      `https://briar-api.example/workspaces/${workspaceId}/integrations/whatsapp`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          agentId: organizationAgentId,
          phoneNumberId,
          wabaId: "202020202020",
          accessToken: "rotated-whatsapp-access-token",
          verifyToken,
        }),
      },
    ), env);
    expect(updated.status).toBe(200);
    expect(JSON.stringify(await updated.json())).not.toContain(
      "rotated-whatsapp-access-token",
    );

    const linked = await worker.fetch(new Request(
      `https://briar-api.example/workspaces/${workspaceId}/integrations/whatsapp/links`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          userId: linkedUserId,
          phoneNumber: "+82 10-1234-5678",
        }),
      },
    ), env);
    expect(linked.status).toBe(200);
    const linkedBody = await linked.json();
    expect(linkedBody).toMatchObject({
      link: { userId: linkedUserId, phoneNumber: linkedPhone },
    });
    const linkId = (linkedBody as { link: { id: string } }).link.id;
    const deleted = await worker.fetch(new Request(
      `https://briar-api.example/workspaces/${workspaceId}/integrations/whatsapp/links/${linkId}`,
      { method: "DELETE", headers },
    ), env);
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ deleted: true });
  });
});
