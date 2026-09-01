import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  FleetService,
  ManagedComputerSetupSessionStatus,
} from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import {
  DashboardWorker_Readiness,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import {
  ManagedComputerSetupService,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import { sha256Hex } from "./managed-computer-crypto";
import { workerRuntimeFixture } from "./test-helpers/worker-runtime";

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

describe("managed computer setup", () => {
  const db = cloudflareEnv.DB;

  beforeAll(async () => {
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

  const env = () => ({
    DB: db,
    BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    MANAGED_COMPUTER_ENROLLMENT_SECRET: "managed-setup-enrollment-secret",
  }) as never;

  const requestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  const transport = () => createConnectTransport({
    baseUrl: "https://briar.example",
    fetch: async (input, init) =>
      worker.fetch(new Request(input, { ...init, redirect: "manual" }), env()),
  });

  const fleet = () => createClient(FleetService, transport());

  const setup = () => createClient(ManagedComputerSetupService, transport());

  const options = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  const errorCode = async (operation: Promise<unknown>) => {
    const error = await operation.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    return (error as ConnectError).code;
  };

  const runtime = (
    providers: ReadonlyArray<"codex" | "claude"> = ["codex", "claude"],
  ) => workerRuntimeFixture({ providers });

  it("allows the requester to issue a hashed, idempotent setup ticket", async () => {
    const developerRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const developerTicket = await fleet().createManagedComputerSetupSession(
      {
        organizationId,
        managedComputerId,
        projectId,
        requestId: developerRequestId,
      },
      options(memberToken),
    );
    expect(developerTicket.session?.status).toBe(
      ManagedComputerSetupSessionStatus.PENDING,
    );
    await db.prepare(
      `delete from briar_managed_computer_setup_sessions where request_id = ?`,
    ).bind(developerRequestId).run();

    const firstPayload = await fleet().createManagedComputerSetupSession(
      { organizationId, managedComputerId, projectId, requestId },
      options(ownerToken),
    );
    if (!firstPayload.session || !firstPayload.socket) {
      throw new Error("FleetService setup session response is incomplete");
    }
    expect(firstPayload).toMatchObject({
      duplicate: false,
      session: { status: ManagedComputerSetupSessionStatus.PENDING },
    });
    expect(firstPayload.setupToken).toMatch(/^briar_setup_[A-Za-z0-9_-]{43}$/u);
    expect(firstPayload.socket).toMatchObject({
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

    await expect(fleet().createManagedComputerSetupSession(
      { organizationId, managedComputerId, projectId, requestId },
      options(ownerToken),
    )).resolves.toMatchObject({
      duplicate: true,
      setupToken: firstPayload.setupToken,
    });
  });

  it("returns authoritative project context only to the enrolled computer", async () => {
    const contextRequestId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const { setupToken } = await fleet().createManagedComputerSetupSession(
      {
        organizationId,
        managedComputerId,
        projectId,
        requestId: contextRequestId,
      },
      options(ownerToken),
    );
    const client = setup();
    expect(await errorCode(client.getManagedComputerSetupContext(
      { managedComputerId, setupToken },
      options(ownerToken),
    ))).toBe(Code.Unauthenticated);

    let responseHeaders: Headers | undefined;
    const context = await client.getManagedComputerSetupContext(
      { managedComputerId, setupToken },
      {
        ...options(machineToken),
        onHeader: (headers) => {
          responseHeaders = headers;
        },
      },
    );
    expect(responseHeaders?.get("cache-control")).toBe("private, no-store");
    expect(context).toMatchObject({
      session: { projectId },
      project: { id: projectId, name: "Managed project" },
    });
    expect(context.settings?.githubRepository).toBeUndefined();
  });

  it("binds the enrolled device once and starts fail-closed", async () => {
    const { setupToken } = await fleet().createManagedComputerSetupSession(
      { organizationId, managedComputerId, projectId, requestId },
      options(ownerToken),
    );
    const client = setup();
    const body = { managedComputerId, setupToken, runtime: runtime() };
    expect(await errorCode(client.bindManagedComputerSetup(
      body,
      options(ownerToken),
    ))).toBe(Code.Unauthenticated);

    let responseHeaders: Headers | undefined;
    const first = await client.bindManagedComputerSetup(body, {
      ...options(machineToken),
      onHeader: (headers) => {
        responseHeaders = headers;
      },
    });
    expect(responseHeaders?.get("cache-control")).toBe("private, no-store");
    expect(first).toMatchObject({
      managedComputerId,
      organizationId,
      projectId,
      deviceId,
      duplicate: false,
      worker: {
        agentProvider: AgentProvider.CODEX,
        acceptingWork: false,
        readiness: DashboardWorker_Readiness.NEEDS_ATTENTION,
      },
    });

    await expect(client.bindManagedComputerSetup(
      body,
      options(machineToken),
    )).resolves.toMatchObject({ duplicate: true });

    await db.prepare(
      `update briar_execution_workers
       set accepting_work = 1, readiness_state = 'ready', readiness_detail = null
       where device_id = ?`,
    ).bind(deviceId).run();
    const reconfigureRequestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const reconfigureSetupToken = (
      await fleet().createManagedComputerSetupSession(
        {
          organizationId,
          managedComputerId,
          projectId,
          requestId: reconfigureRequestId,
        },
        options(ownerToken),
      )
    ).setupToken;
    await expect(client.bindManagedComputerSetup(
      { ...body, setupToken: reconfigureSetupToken },
      options(machineToken),
    )).resolves.toMatchObject({
      worker: {
        acceptingWork: false,
        readiness: DashboardWorker_Readiness.NEEDS_ATTENTION,
      },
    });

    const counts = await db.prepare(
      `select
         (select count(*) from briar_managed_computer_setup_sessions) sessions,
         (select count(*) from briar_execution_workers where device_id = ?) workers`,
    ).bind(deviceId).first<Record<string, number>>();
    expect(counts).toEqual({ sessions: 3, workers: 1 });

    await expect(fleet().getManagedComputerSetupStatus(
      { organizationId, managedComputerId },
      options(ownerToken),
    )).resolves.toMatchObject({
      session: {
        projectId,
        status: ManagedComputerSetupSessionStatus.CONSUMED,
      },
      worker: {
        acceptingWork: false,
        readiness: DashboardWorker_Readiness.NEEDS_ATTENTION,
      },
    });
  });

  it("adds another project after the managed computer is ready", async () => {
    await db.prepare(
      `update briar_managed_computers
       set state = 'ready', state_updated_at = ?, updated_at = ?
       where id = ?`,
    ).bind(now, now, managedComputerId).run();
    const addProjectRequestId = "77777777-7777-4777-8777-777777777777";
    const { setupToken } = await fleet().createManagedComputerSetupSession(
      {
        organizationId,
        managedComputerId,
        projectId: secondProjectId,
        requestId: addProjectRequestId,
      },
      options(ownerToken),
    );

    await expect(setup().bindManagedComputerSetup(
      {
        managedComputerId,
        setupToken,
        runtime: runtime(["codex"]),
      },
      options(machineToken),
    )).resolves.toMatchObject({
      projectId: secondProjectId,
      deviceId,
      worker: {
        acceptingWork: false,
        readiness: DashboardWorker_Readiness.NEEDS_ATTENTION,
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
