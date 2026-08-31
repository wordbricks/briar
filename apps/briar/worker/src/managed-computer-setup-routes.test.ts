import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import { sha256Hex } from "./managed-computer-crypto";
import {
  createIsolatedTestDatabase,
  type IsolatedTestDatabase,
} from "./test-helpers/d1";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const secondProjectId = "99999999-9999-4999-8999-999999999999";
const managedComputerId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const deviceId = `managed-${managedComputerId}`;
const ownerId = "managed-setup-owner";
const memberId = "managed-setup-member";
const ownerToken = "managed-setup-owner-token";
const memberToken = "managed-setup-member-token";
const machineToken = `briar_worker_${"m".repeat(43)}`;
const now = "2026-08-24T00:00:00.000Z";

describe("managed computer setup routes", () => {
  let database: IsolatedTestDatabase;
  let db: D1Database;

  beforeAll(async () => {
    database = await createIsolatedTestDatabase({
      suite: "managed-computer-setup-routes",
    });
    db = database.db;
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Owner', 'setup-owner@example.com', 1, ?, ?)`,
      ).bind(ownerId, now, now),
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Member', 'setup-member@example.com', 1, ?, ?)`,
      ).bind(memberId, now, now),
      db.prepare(
        `insert into "session" (id, expiresAt, token, createdAt, updatedAt, userId)
         values ('managed-setup-owner-session', '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
      ).bind(ownerToken, now, now, ownerId),
      db.prepare(
        `insert into "session" (id, expiresAt, token, createdAt, updatedAt, userId)
         values ('managed-setup-member-session', '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
      ).bind(memberToken, now, now, memberId),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Managed Setup', 'managed-setup', ?, ?)`,
      ).bind(organizationId, now, now),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'developer', ?, ?)`,
      ).bind(organizationId, memberId, now, now),
      db.prepare(
        `insert into briar_teams (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Managed project', ?, ?, ?)`,
      ).bind(projectId, ownerId, organizationId, "a".repeat(64), now, now),
      db.prepare(
        `insert into briar_teams (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Second managed project', ?, ?, ?)`,
      ).bind(secondProjectId, ownerId, organizationId, "e".repeat(64), now, now),
      db.prepare(
        `insert into briar_managed_computer_entitlements (
           id, organization_id, requester_user_id, source, source_reference,
           request_id, status, approved_at, expires_at, created_at, updated_at
         ) values (
           'managed-setup-entitlement', ?, ?, 'free_promotion', 'test',
           'managed-setup-application', 'approved', ?,
           '2099-01-01T00:00:00.000Z', ?, ?
         )`,
      ).bind(organizationId, ownerId, now, now, now),
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, max_concurrent_sessions, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Managed setup computer', ?, 'online', 1, ?, ?, ?)`,
      ).bind(deviceId, organizationId, ownerId, "b".repeat(64), now, now, now),
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at, last_used_at, expires_at, revoked_at
         ) values (?, ?, ?, null, null, null)`,
      ).bind(deviceId, await sha256Hex(machineToken), now),
      db.prepare(
        `insert into briar_managed_computers (
           id, organization_id, requester_user_id, entitlement_id, state,
           aws_region, aws_instance_type, aws_instance_id,
           aws_launch_template_id, aws_launch_template_version,
           bootstrap_api_origin, briar_device_id, provisioning_job_id,
           enrollment_nonce_hash, enrollment_expires_at,
           enrollment_consumed_at, enrollment_identity_hash, created_at,
           state_updated_at, expires_at, updated_at
         ) values (
           ?, ?, ?, 'managed-setup-entitlement', 'needs_setup', 'us-east-1',
           'm7i.large', 'i-0123456789abcdef0', 'lt-0123456789abcdef0', '3',
           'https://briar.example', ?, 'managed-setup-job', ?,
           '2099-01-01T00:00:00.000Z', ?, ?, ?, ?,
           '2099-01-01T00:00:00.000Z', ?
         )`,
      ).bind(
        managedComputerId,
        organizationId,
        ownerId,
        deviceId,
        "c".repeat(64),
        now,
        "d".repeat(64),
        now,
        now,
        now,
      ),
    ]);
  }, 60_000);

  afterAll(async () => database.dispose());

  const env = () => ({
    DB: db,
    BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    MANAGED_COMPUTER_ENROLLMENT_SECRET: "managed-setup-enrollment-secret",
  }) as never;

  const request = (
    pathname: string,
    method: "GET" | "POST",
    token: string,
    body?: unknown,
    requestId?: string,
  ) => new Request(`https://briar.example${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(requestId ? { "idempotency-key": requestId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const setupPath =
    `/organizations/${organizationId}/managed-computers/${managedComputerId}/setup-sessions`;
  const requestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  it("allows the requester to issue a hashed, idempotent setup ticket", async () => {
    const developerRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const developerTicket = await worker.fetch(request(
      setupPath,
      "POST",
      memberToken,
      { projectId, requestId: developerRequestId },
      developerRequestId,
    ), env());
    expect(developerTicket.status).toBe(201);
    await db.prepare(
      `delete from briar_managed_computer_setup_sessions where request_id = ?`,
    ).bind(developerRequestId).run();

    const first = await worker.fetch(request(
      setupPath,
      "POST",
      ownerToken,
      { projectId, requestId },
      requestId,
    ), env());
    expect(first.status).toBe(201);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    const firstPayload = await first.json() as {
      setupToken: string;
      duplicate: boolean;
      session: { id: string; status: string };
      socket: { url: string; protocol: string };
      agentConnected: boolean;
    };
    expect(firstPayload).toMatchObject({
      duplicate: false,
      session: { status: "pending" },
    });
    expect(firstPayload.setupToken).toMatch(/^briar_setup_[A-Za-z0-9_-]{43}$/u);
    expect(firstPayload.socket).toEqual({
      url: `wss://briar.example/managed-computers/${managedComputerId}/setup-sessions/${firstPayload.session.id}/connect`,
      protocol: `briar-setup-v1.${firstPayload.setupToken}`,
    });
    expect(firstPayload.agentConnected).toBe(false);

    const stored = await db.prepare(
      `select token_hash from briar_managed_computer_setup_sessions
       where managed_computer_id = ? and request_id = ?`,
    ).bind(managedComputerId, requestId).first<{ token_hash: string }>();
    expect(stored?.token_hash).toBe(await sha256Hex(firstPayload.setupToken));
    expect(stored?.token_hash).not.toContain(firstPayload.setupToken);

    const replay = await worker.fetch(request(
      setupPath,
      "POST",
      ownerToken,
      { projectId, requestId },
      requestId,
    ), env());
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      duplicate: true,
      setupToken: firstPayload.setupToken,
    });
  });

  it("returns authoritative project context only to the enrolled computer", async () => {
    const contextRequestId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const ticket = await worker.fetch(request(
      setupPath,
      "POST",
      ownerToken,
      { projectId, requestId: contextRequestId },
      contextRequestId,
    ), env());
    const { setupToken } = await ticket.json() as { setupToken: string };
    const contextPath = `/managed-computers/${managedComputerId}/setup/context`;

    const userRejected = await worker.fetch(request(
      contextPath,
      "POST",
      ownerToken,
      { setupToken },
    ), env());
    expect(userRejected.status).toBe(401);

    const context = await worker.fetch(request(
      contextPath,
      "POST",
      machineToken,
      { setupToken },
    ), env());
    expect(context.status).toBe(200);
    expect(context.headers.get("cache-control")).toBe("private, no-store");
    await expect(context.json()).resolves.toMatchObject({
      session: { projectId },
      project: { id: projectId, name: "Managed project" },
      settings: { githubRepository: null },
    });
  });

  it("binds the enrolled device once and starts fail-closed", async () => {
    const ticket = await worker.fetch(request(
      setupPath,
      "POST",
      ownerToken,
      { projectId, requestId },
      requestId,
    ), env());
    const { setupToken } = await ticket.json() as { setupToken: string };
    const body = {
      setupToken,
      worker: {
        agentProvider: "codex",
        providers: ["codex", "claude"],
        versions: { briar: "1.2.154", codex: "0.149.1" },
      },
    };
    const userCredentialRejected = await worker.fetch(request(
      `/managed-computers/${managedComputerId}/setup/bind`,
      "POST",
      ownerToken,
      body,
    ), env());
    expect(userCredentialRejected.status).toBe(401);

    const first = await worker.fetch(request(
      `/managed-computers/${managedComputerId}/setup/bind`,
      "POST",
      machineToken,
      body,
    ), env());
    const firstPayload = await first.json();
    expect(first.status, JSON.stringify(firstPayload)).toBe(201);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(firstPayload).toMatchObject({
      managedComputerId,
      organizationId,
      projectId,
      deviceId,
      duplicate: false,
      worker: {
        agentProvider: "codex",
        acceptingWork: false,
        readiness: "needs_attention",
      },
    });

    const replay = await worker.fetch(request(
      `/managed-computers/${managedComputerId}/setup/bind`,
      "POST",
      machineToken,
      body,
    ), env());
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ duplicate: true });

    await db.prepare(
      `update briar_execution_workers
       set accepting_work = 1, readiness_state = 'ready', readiness_detail = null
       where device_id = ?`,
    ).bind(deviceId).run();
    const reconfigureRequestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const reconfigureTicket = await worker.fetch(request(
      setupPath,
      "POST",
      ownerToken,
      { projectId, requestId: reconfigureRequestId },
      reconfigureRequestId,
    ), env());
    const reconfigureSetupToken = (await reconfigureTicket.json() as {
      setupToken: string;
    }).setupToken;
    const reconfigured = await worker.fetch(request(
      `/managed-computers/${managedComputerId}/setup/bind`,
      "POST",
      machineToken,
      { ...body, setupToken: reconfigureSetupToken },
    ), env());
    expect(reconfigured.status).toBe(201);
    await expect(reconfigured.json()).resolves.toMatchObject({
      worker: { acceptingWork: false, readiness: "needs_attention" },
    });

    const counts = await db.prepare(
      `select
         (select count(*) from briar_managed_computer_setup_sessions) sessions,
         (select count(*) from briar_execution_workers where device_id = ?) workers`,
    ).bind(deviceId).first<Record<string, number>>();
    expect(counts).toEqual({ sessions: 3, workers: 1 });

    const status = await worker.fetch(request(
      `/organizations/${organizationId}/managed-computers/${managedComputerId}/setup`,
      "GET",
      ownerToken,
    ), env());
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("private, no-store");
    await expect(status.json()).resolves.toMatchObject({
      session: { projectId, status: "consumed" },
      worker: { acceptingWork: false, readiness: "needs_attention" },
    });
  });

  it("adds another project after the managed computer is ready", async () => {
    await db.prepare(
      `update briar_managed_computers
       set state = 'ready', state_updated_at = ?, updated_at = ?
       where id = ?`,
    ).bind(now, now, managedComputerId).run();
    const addProjectRequestId = "77777777-7777-4777-8777-777777777777";
    const ticket = await worker.fetch(request(
      setupPath,
      "POST",
      ownerToken,
      { projectId: secondProjectId, requestId: addProjectRequestId },
      addProjectRequestId,
    ), env());
    expect(ticket.status).toBe(201);
    const { setupToken } = await ticket.json() as { setupToken: string };

    const binding = await worker.fetch(request(
      `/managed-computers/${managedComputerId}/setup/bind`,
      "POST",
      machineToken,
      {
        setupToken,
        worker: {
          agentProvider: "codex",
          providers: ["codex"],
          versions: { briar: "1.2.154", codex: "0.149.1" },
        },
      },
    ), env());
    expect(binding.status).toBe(201);
    await expect(binding.json()).resolves.toMatchObject({
      projectId: secondProjectId,
      deviceId,
      worker: {
        acceptingWork: false,
        readiness: "needs_attention",
      },
    });

    const projectBindings = await db.prepare(
      `select project_id from briar_execution_workers
       where device_id = ? order by project_id`,
    ).bind(deviceId).all<{ project_id: string }>();
    expect(projectBindings.results.map((row) => row.project_id)).toEqual([
      secondProjectId,
      projectId,
    ].sort());
  });
});
