import * as Predicate from "effect/Predicate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { sha256Hex } from "./managed-computer-crypto";
import { createPromotionalManagedComputer } from "./managed-computer-repository";
import {
  createIsolatedTestDatabase,
  executeD1Sql,
  type IsolatedTestDatabase,
} from "./test-helpers/d1";

const organizationId = "11111111-1111-4111-8111-111111111111";
const computerId = "22222222-2222-4222-8222-222222222222";
const ownerId = "remote-route-owner";
const memberId = "remote-route-member";
const ownerToken = "remote-route-owner-token";
const memberToken = "remote-route-member-token";
const workerCredential = "briar_worker_remote_route_credential";
const deviceId = `managed-${computerId}`;
const now = "2026-08-22T00:00:00.000Z";

describe("managed computer remote desktop routes", () => {
  let database: IsolatedTestDatabase;
  let db: D1Database;
  const relayFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(Predicate.isString(input) ? input : input.toString());
    if (url.pathname === "/status") {
      return Response.json({ agentConnected: true, controllerConnected: false });
    }
    return new Response(null, { status: 204 });
  });

  beforeAll(async () => {
    database = await createIsolatedTestDatabase({
      suite: "managed-computer-remote-routes",
    });
    db = database.db;
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('${ownerId}', 'Remote Owner', 'remote-owner@example.com', 1, '${now}', '${now}');
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('${memberId}', 'Remote Member', 'remote-member@example.com', 1, '${now}', '${now}');
      insert into "session" (id, expiresAt, token, createdAt, updatedAt, userId)
      values ('remote-owner-session', '2099-01-01T00:00:00.000Z', '${ownerToken}', '${now}', '${now}', '${ownerId}');
      insert into "session" (id, expiresAt, token, createdAt, updatedAt, userId)
      values ('remote-member-session', '2099-01-01T00:00:00.000Z', '${memberToken}', '${now}', '${now}', '${memberId}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${organizationId}', 'Remote Routes', 'remote-routes', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${organizationId}', '${ownerId}', 'owner', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${organizationId}', '${memberId}', 'developer', '${now}', '${now}');
    `);
    await createPromotionalManagedComputer(db, {
      entitlementId: "33333333-3333-4333-8333-333333333333",
      managedComputerId: computerId,
      provisioningJobId: "44444444-4444-4444-8444-444444444444",
      workflowInstanceId: `managed-computer-${computerId}`,
      organizationId,
      userId: ownerId,
      campaignId: "getbriar-pilot",
      requestId: "55555555-5555-4555-8555-555555555555",
      organizationLimit: 1,
      fleetLimit: 10,
      region: "us-east-1",
      instanceType: "m7i.large",
      launchTemplateId: "lt-0123456789abcdef0",
      launchTemplateVersion: "7",
      bootstrapApiOrigin: "https://briar.example",
      enrollmentNonceHash: await sha256Hex("remote-route-enrollment"),
      enrollmentExpiresAt: "2026-08-22T00:30:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      observedAt: now,
    });
    await db.prepare(
      `update briar_managed_computers
       set state = 'provisioning', state_updated_at = ?, updated_at = ?
       where id = ?`,
    ).bind(now, now, computerId).run();
    await db.prepare(
      `update briar_managed_computers
       set state = 'bootstrapping', state_updated_at = ?, updated_at = ?
       where id = ?`,
    ).bind(now, now, computerId).run();
    await db.prepare(
      `insert into briar_execution_worker_devices (
         id, organization_id, owner_user_id, label, device_identity_hash,
         state, max_concurrent_sessions, last_heartbeat_at, created_at, updated_at
       ) values (?, ?, ?, 'Remote computer', ?, 'online', 1, ?, ?, ?)`,
    ).bind(deviceId, organizationId, ownerId, "f".repeat(64), now, now, now).run();
    await db.batch([
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at, last_used_at, expires_at, revoked_at
         ) values (?, ?, ?, null, null, null)`,
      ).bind(deviceId, await sha256Hex(workerCredential), now),
      db.prepare(
        `update briar_managed_computers
         set state = 'needs_setup', briar_device_id = ?, state_updated_at = ?,
             updated_at = ? where id = ?`,
      ).bind(deviceId, now, now, computerId),
    ]);
  }, 60_000);

  afterAll(async () => database.dispose());

  const env = () => ({
    DB: db,
    BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED: "true",
    MANAGED_COMPUTER_REMOTE_DESKTOP_ALLOWED_ORIGINS: "https://briar.example",
    MANAGED_COMPUTER_API_ORIGIN: "https://briar.example",
    MANAGED_COMPUTER_REMOTE: {
      getByName: () => ({ fetch: relayFetch }),
    },
  }) as never;

  const createRequest = (
    token: string,
    requestId: string,
    origin = "https://briar.example",
    reconnectSessionId?: string,
  ) => new Request(
    `https://briar.example/organizations/${organizationId}/managed-computers/${computerId}/remote-sessions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": requestId,
        origin,
      },
      body: JSON.stringify({
        requestId,
        ...(reconnectSessionId ? { reconnectSessionId } : {}),
      }),
    },
  );

  it("allows a developer but denies a cross-site origin", async () => {
    const developerResponse = await worker.fetch(
      createRequest(memberToken, "66666666-6666-4666-8666-666666666666"),
      env(),
    );
    expect(developerResponse.status).toBe(201);
    const developerSession = await developerResponse.json<{
      session: { id: string };
    }>();
    await db.prepare(
      `update briar_managed_computer_remote_sessions
       set state = 'ended', ended_at = ?, updated_at = ? where id = ?`,
    ).bind(now, now, developerSession.session.id).run();
    const deniedOrigin = await worker.fetch(
      createRequest(
        ownerToken,
        "77777777-7777-4777-8777-777777777777",
        "https://attacker.example",
      ),
      env(),
    );
    expect(deniedOrigin.status).toBe(403);
    expect(await deniedOrigin.json()).toMatchObject({
      code: "MANAGED_COMPUTER_REMOTE_ORIGIN_REJECTED",
    });
    const missingOrigin = createRequest(
      ownerToken,
      "12121212-1212-4212-8212-121212121212",
    );
    missingOrigin.headers.delete("origin");
    const deniedMissingOrigin = await worker.fetch(missingOrigin, env());
    expect(deniedMissingOrigin.status).toBe(403);
    expect(await deniedMissingOrigin.json()).toMatchObject({
      code: "MANAGED_COMPUTER_REMOTE_ORIGIN_REJECTED",
    });
    const audits = await db.prepare(
      `select reason_code from briar_managed_computer_remote_audit_events
       where action = 'connection_rejected' order by occurred_at, id`,
    ).all<{ reason_code: string }>();
    expect(audits.results?.map((event) => event.reason_code)).toEqual(
      expect.arrayContaining([
        "origin_rejected",
      ]),
    );
  });

  it("issues a short-lived protocol token without putting it in the URL", async () => {
    const requestId = "88888888-8888-4888-8888-888888888888";
    const response = await worker.fetch(createRequest(ownerToken, requestId), env());
    expect(response.status).toBe(201);
    const payload = await response.json<{
      session: { id: string; connectionGeneration: number };
      socket: { url: string; protocol: string };
      reconnected: boolean;
    }>();
    expect(payload).toMatchObject({
      session: { connectionGeneration: 1 },
      reconnected: false,
    });
    expect(payload.socket.protocol).toMatch(
      /^briar-remote-v1\.briar_remote_[A-Za-z0-9_-]{43}$/u,
    );
    expect(payload.socket.url).not.toContain("briar_remote_");
    const stored = await db.prepare(
      `select client_token_hash, token_consumed_at
       from briar_managed_computer_remote_sessions where id = ?`,
    ).bind(payload.session.id).first<{
      client_token_hash: string;
      token_consumed_at: string | null;
    }>();
    expect(stored?.client_token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain("briar_remote_");

    const connect = new Request(payload.socket.url, {
      headers: {
        Upgrade: "websocket",
        Origin: "https://briar.example",
        "Sec-WebSocket-Protocol": payload.socket.protocol,
      },
    });
    expect((await worker.fetch(connect, env())).status).toBe(204);
    expect((await worker.fetch(connect, env())).status).toBe(401);
    expect(await db.prepare(
      `select reason_code from briar_managed_computer_remote_audit_events
       where remote_session_id = ? and action = 'connection_rejected'
       order by occurred_at desc limit 1`,
    ).bind(payload.session.id).first<{ reason_code: string }>()).toMatchObject({
      reason_code: "token_expired_or_reused",
    });

    await db.prepare(
      `update briar_managed_computer_remote_sessions
       set state = 'disconnected', disconnected_at = ?, updated_at = ?
       where id = ?`,
    ).bind(now, now, payload.session.id).run();
    const recoveredResponse = await worker.fetch(
      createRequest(
        ownerToken,
        "99999999-9999-4999-8999-999999999999",
        "https://briar.example",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
      env(),
    );
    expect(recoveredResponse.status).toBe(201);
    await expect(recoveredResponse.json<{
      session: { id: string; connectionGeneration: number };
      reconnected: boolean;
    }>()).resolves.toMatchObject({
      session: {
        id: payload.session.id,
        connectionGeneration: 2,
      },
      reconnected: true,
    });
  });

  it("authenticates the outbound agent with the computer-scoped worker credential", async () => {
    const response = await worker.fetch(new Request(
      `https://briar.example/managed-computers/${computerId}/remote-agent`,
      {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol":
            `briar-remote-agent-v1.${workerCredential}`,
        },
      },
    ), env());
    expect(response.status).toBe(204);
  });

  it("ends control when the managed computer Worker credential is removed", async () => {
    const remove = () => worker.fetch(new Request(
      `https://briar.example/organizations/${organizationId}/workers/${deviceId}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${ownerToken}`,
          "Idempotency-Key": `worker-deprovision:${deviceId}`,
        },
      },
    ), env());
    const response = await remove();
    expect(response.status).toBe(204);
    expect(relayFetch).toHaveBeenCalledWith(
      "https://managed-computer-remote.internal/disconnect",
      { method: "POST" },
    );
    expect(await db.prepare(
      `select state, end_reason
       from briar_managed_computer_remote_sessions
       order by created_at desc limit 1`,
    ).first<{ state: string; end_reason: string }>()).toMatchObject({
      state: "ended",
      end_reason: "worker_credential_revoked",
    });
    expect((await remove()).status).toBe(204);
    await db.prepare(
      `update briar_execution_worker_lifecycle_events
       set outcome = 'started', completed_at = null where request_id = ?`,
    ).bind(`worker-deprovision:${deviceId}`).run();
    expect((await remove()).status).toBe(204);
    const lifecycle = await db.prepare(
      `select reason, outcome, attempt_count, hard_delete_rows_written,
              detail_json
       from briar_execution_worker_lifecycle_events where request_id = ?`,
    ).bind(`worker-deprovision:${deviceId}`).first<{
      reason: string;
      outcome: string;
      attempt_count: number;
      hard_delete_rows_written: number;
      detail_json: string;
    }>();
    expect(lifecycle).toMatchObject({
      reason: "managed_deprovision",
      outcome: "deleted",
      attempt_count: 3,
      hard_delete_rows_written: expect.any(Number),
      detail_json: expect.not.stringContaining(workerCredential),
    });
    expect(lifecycle?.hard_delete_rows_written).toBeGreaterThan(0);
    expect(lifecycle?.detail_json).toContain(
      '"recoveredAfterMissingTarget":true',
    );
  });
});
