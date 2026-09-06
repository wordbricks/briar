import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  workerWakeProtocolHeader,
  workerWakeSubprotocol,
} from "../../src/lib/worker-wake-protocol";
import { sha256 } from "./crypto-digest";
import { handleWorkerWakeRoute } from "./worker-wake-routes";

const organizationId = "77777777-7777-4777-8777-777777777777";
const otherOrganizationId = "88888888-8888-4888-8888-888888888888";
const ownerId = "worker-wake-owner";
const deviceId = "99999999-9999-4999-8999-999999999999";
const credential = "briar_worker_wake_route_credential";
const disabledDeviceId = "aaaaaaaa-9999-4999-8999-999999999999";
const disabledCredential = "briar_worker_wake_route_disabled";
const now = "2026-09-06T00:00:00.000Z";

describe("worker wake route", () => {
  const db = cloudflareEnv.DB;
  const subscribeFetch = vi.fn(async () => new Response(null, { status: 204 }));
  const env = () => ({
    DB: db,
    WORKER_WAKE: { getByName: () => ({ fetch: subscribeFetch }) },
  }) as unknown as Env;

  const request = (
    path: string,
    headers: Record<string, string>,
  ) => new Request(`https://briar.example${path}`, { headers });

  const wakeRequest = (token: string, organization = organizationId) =>
    request(`/organizations/${organization}/worker-wake`, {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": workerWakeSubprotocol(token),
    });

  beforeAll(async () => {
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, 'Wake Owner', 'worker-wake@example.com', 1, ?, ?)`,
      ).bind(ownerId, now, now),
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Worker Wake', 'worker-wake', ?, ?)`,
      ).bind(organizationId, now, now),
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Other Wake', 'other-wake', ?, ?)`,
      ).bind(otherOrganizationId, now, now),
    ]);
    await db.prepare(
      `insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values (?, ?, 'owner', ?, ?)`,
    ).bind(organizationId, ownerId, now, now).run();
    await db.batch([
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, max_concurrent_sessions, last_heartbeat_at,
           created_at, updated_at
         ) values (?, ?, ?, 'Wake device', ?, 'online', 1, ?, ?, ?)`,
      ).bind(deviceId, organizationId, ownerId, "b".repeat(64), now, now, now),
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, max_concurrent_sessions, last_heartbeat_at,
           created_at, updated_at
         ) values (?, ?, ?, 'Disabled device', ?, 'disabled', 1, ?, ?, ?)`,
      ).bind(
        disabledDeviceId,
        organizationId,
        ownerId,
        "c".repeat(64),
        now,
        now,
        now,
      ),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at, last_used_at, expires_at,
           revoked_at
         ) values (?, ?, ?, null, null, null)`,
      ).bind(deviceId, await sha256(credential), now),
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at, last_used_at, expires_at,
           revoked_at
         ) values (?, ?, ?, null, null, null)`,
      ).bind(disabledDeviceId, await sha256(disabledCredential), now),
    ]);
  }, 60_000);

  it("upgrades a Worker credential offered in the subprotocol", async () => {
    subscribeFetch.mockClear();
    const response = await handleWorkerWakeRoute({
      request: wakeRequest(credential),
      db,
      env: env(),
    });

    expect(response?.status).toBe(204);
    expect(subscribeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = subscribeFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://worker-wake.internal/subscribe");
    expect(
      (init.headers as Record<string, string>)[workerWakeProtocolHeader],
    ).toBe(workerWakeSubprotocol(credential));
  });

  it("refuses a credential from another organization", async () => {
    await expect(handleWorkerWakeRoute({
      request: wakeRequest(credential, otherOrganizationId),
      db,
      env: env(),
    })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a missing, unknown, or disabled Worker credential", async () => {
    const rejected: Record<string, string>[] = [
      { Upgrade: "websocket" },
      {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": "briar-worker-wake-v1.briar_agent_nope",
      },
    ];
    for (const headers of rejected) {
      await expect(handleWorkerWakeRoute({
        request: request(
          `/organizations/${organizationId}/worker-wake`,
          headers,
        ),
        db,
        env: env(),
      })).rejects.toMatchObject({ status: 401 });
    }
    // A well-formed but unknown credential is authentication, not authorization.
    await expect(handleWorkerWakeRoute({
      request: wakeRequest("briar_worker_not_registered"),
      db,
      env: env(),
    })).rejects.toMatchObject({ status: 401 });
    await expect(handleWorkerWakeRoute({
      request: wakeRequest(disabledCredential),
      db,
      env: env(),
    })).rejects.toMatchObject({ status: 401 });
  });

  it("requires a WebSocket upgrade and ignores other paths", async () => {
    await expect(handleWorkerWakeRoute({
      request: request(`/organizations/${organizationId}/worker-wake`, {
        "Sec-WebSocket-Protocol": workerWakeSubprotocol(credential),
      }),
      db,
      env: env(),
    })).rejects.toMatchObject({ status: 426 });
    await expect(handleWorkerWakeRoute({
      request: request(`/organizations/${organizationId}/channel-events`, {
        Upgrade: "websocket",
      }),
      db,
      env: env(),
    })).resolves.toBeUndefined();
  });
});
