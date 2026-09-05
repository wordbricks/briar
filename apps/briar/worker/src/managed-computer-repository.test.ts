import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "./managed-computer-crypto";
import {
  beginManagedComputerRetirement,
  createManagedComputerRetry,
  createPromotionalManagedComputer,
  createSandboxManagedComputer,
  deleteSandboxManagedComputer,
  listManagedComputersForReconciliation,
  listOrganizationManagedComputers,
  sandboxManagedComputerByDevice,
  enrollManagedComputerDevice,
  failManagedComputerProvisioning,
  managedComputerById,
  managedComputerCapacity,
  startManagedComputerProvisioning,
} from "./managed-computer-repository";
import { recordWorkerHeartbeat } from "./workers";
import { executeD1Sql } from "./test-helpers/d1-sql";
import {
  workerRuntimeMetadataFixture,
  workerRuntimeProtoJsonFixture,
} from "./test-helpers/worker-runtime";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "pilot-owner";
const observedAt = "2026-08-22T00:00:00.000Z";

describe("managed computer repository", () => {
  const db = cloudflareEnv.DB;

  beforeAll(async () => {
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('${userId}', 'Pilot Owner', 'pilot@example.com', 1, '${observedAt}', '${observedAt}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${organizationId}', 'Pilot Org', 'pilot-org', '${observedAt}', '${observedAt}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${organizationId}', '${userId}', 'owner', '${observedAt}', '${observedAt}');
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('pilot-owner-2', 'Second Owner', 'pilot-2@example.com', 1, '${observedAt}', '${observedAt}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('99999999-9999-4999-8999-999999999999', 'Second Pilot Org', 'pilot-org-2', '${observedAt}', '${observedAt}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('99999999-9999-4999-8999-999999999999', 'pilot-owner-2', 'owner', '${observedAt}', '${observedAt}');
    `);
  }, 30_000);

  it("atomically approves an entitlement, one promotion use, one job, and one computer", async () => {
    const computer = await createPromotionalManagedComputer(db, {
      entitlementId: "22222222-2222-4222-8222-222222222222",
      managedComputerId: "33333333-3333-4333-8333-333333333333",
      provisioningJobId: "44444444-4444-4444-8444-444444444444",
      workflowInstanceId: "managed-computer-33333333-3333-4333-8333-333333333333",
      organizationId,
      userId,
      campaignId: "getbriar-pilot",
      requestId: "55555555-5555-4555-8555-555555555555",
      organizationLimit: 1,
      fleetLimit: 10,
      region: "us-east-1",
      instanceType: "m7i.large",
      launchTemplateId: "lt-0123456789abcdef0",
      launchTemplateVersion: "7",
      bootstrapApiOrigin: "https://briar.example",
      enrollmentNonceHash: await sha256Hex("n".repeat(43)),
      enrollmentExpiresAt: "2026-08-22T00:30:00.000Z",
      expiresAt: "2026-09-21T00:00:00.000Z",
      observedAt,
    });
    expect(computer).toMatchObject({
      state: "requested",
      organization_id: organizationId,
      requester_user_id: userId,
      aws_region: "us-east-1",
      retry_count: 0,
    });
    const counts = await db.prepare(`
      select
        (select count(*) from briar_managed_computer_entitlements) as entitlements,
        (select count(*) from briar_managed_computer_promotion_redemptions) as redemptions,
        (select count(*) from briar_managed_computer_provisioning_jobs) as jobs,
        (select count(*) from briar_managed_computers) as computers,
        (select count(*) from briar_managed_computer_audit_events) as audits
    `).first<Record<string, number>>();
    expect(counts).toEqual({
      entitlements: 1,
      redemptions: 1,
      jobs: 1,
      computers: 1,
      audits: 2,
    });
    const capacity = await managedComputerCapacity(db, {
      organizationId,
      userId,
      campaignId: "getbriar-pilot",
      organizationLimit: 1,
      fleetLimit: 10,
    });
    expect(capacity).toMatchObject({
      eligible: false,
      organizationCount: 1,
      userRedeemed: true,
      organizationRedeemed: true,
    });
  });

  it("rejects another organization atomically when the fleet limit is full", async () => {
    const capacity = await managedComputerCapacity(db, {
      organizationId: "99999999-9999-4999-8999-999999999999",
      userId: "pilot-owner-2",
      campaignId: "getbriar-pilot",
      organizationLimit: 1,
      fleetLimit: 1,
    });
    expect(capacity).toMatchObject({ eligible: false, fleetCount: 1 });
    const rejected = await createPromotionalManagedComputer(db, {
      entitlementId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      managedComputerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      provisioningJobId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      workflowInstanceId: "managed-computer-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      organizationId: "99999999-9999-4999-8999-999999999999",
      userId: "pilot-owner-2",
      campaignId: "getbriar-pilot",
      requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      organizationLimit: 1,
      fleetLimit: 1,
      region: "us-east-1",
      instanceType: "m7i.large",
      launchTemplateId: "lt-0123456789abcdef0",
      launchTemplateVersion: "7",
      bootstrapApiOrigin: "https://briar.example",
      enrollmentNonceHash: await sha256Hex("o".repeat(43)),
      enrollmentExpiresAt: "2026-08-22T00:30:00.000Z",
      expiresAt: "2026-09-21T00:00:00.000Z",
      observedAt,
    });
    expect(rejected).toBeNull();
  });

  it("enforces lifecycle transitions and keeps unlimited manual retries idempotent", async () => {
    const oldIdentityHash = "b".repeat(64);
    const newIdentityHash = "c".repeat(64);
    const newCredentialHash = "d".repeat(64);
    await expect(db.prepare(
      `update briar_managed_computers set state = 'ready'
       where id = '33333333-3333-4333-8333-333333333333'`,
    ).run()).rejects.toThrow(/invalid managed computer state transition/u);
    await startManagedComputerProvisioning(
      db,
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "2026-08-22T00:01:00.000Z",
    );
    await failManagedComputerProvisioning(db, {
      managedComputerId: "33333333-3333-4333-8333-333333333333",
      provisioningJobId: "44444444-4444-4444-8444-444444444444",
      code: "AWS_THROTTLED",
      detail: "limited",
      observedAt: "2026-08-22T00:02:00.000Z",
    });
    await db.prepare(
      `update briar_managed_computers
       set aws_account_id = '123456789012', aws_instance_id = 'i-0123456789abcdef0',
           aws_volume_id = 'vol-0123456789abcdef0',
           enrollment_consumed_at = '2026-08-22T00:01:30.000Z',
           enrollment_identity_hash = ?
       where id = '33333333-3333-4333-8333-333333333333'`,
    ).bind(oldIdentityHash).run();
    const retry = await createManagedComputerRetry(db, {
      managedComputerId: "33333333-3333-4333-8333-333333333333",
      organizationId,
      actorUserId: userId,
      requestId: "66666666-6666-4666-8666-666666666666",
      provisioningJobId: "77777777-7777-4777-8777-777777777777",
      workflowInstanceId: "managed-computer-retry-1",
      enrollmentNonceHash: "a".repeat(64),
      enrollmentExpiresAt: "2026-08-22T00:33:00.000Z",
      region: "us-east-1",
      instanceType: "m7i.large",
      launchTemplateId: "lt-0123456789abcdef0",
      launchTemplateVersion: "8",
      bootstrapApiOrigin: "https://briar-new.example",
      observedAt: "2026-08-22T00:03:00.000Z",
    });
    expect(retry).toMatchObject({
      created: true,
      job: { attempt: 2 },
      previousInstanceId: "i-0123456789abcdef0",
      previousInstanceRegion: "us-east-1",
    });
    const duplicate = await createManagedComputerRetry(db, {
      managedComputerId: "33333333-3333-4333-8333-333333333333",
      organizationId,
      actorUserId: userId,
      requestId: "66666666-6666-4666-8666-666666666666",
      provisioningJobId: "88888888-8888-4888-8888-888888888888",
      workflowInstanceId: "managed-computer-retry-duplicate",
      enrollmentNonceHash: "a".repeat(64),
      enrollmentExpiresAt: "2026-08-22T00:34:00.000Z",
      region: "us-east-1",
      instanceType: "m7i.large",
      launchTemplateId: "lt-0123456789abcdef0",
      launchTemplateVersion: "8",
      bootstrapApiOrigin: "https://briar-new.example",
      observedAt: "2026-08-22T00:04:00.000Z",
    });
    expect(duplicate).toMatchObject({ created: false, job: { attempt: 2 } });
    expect(await managedComputerById(
      db,
      "33333333-3333-4333-8333-333333333333",
    )).toMatchObject({
      state: "requested",
      retry_count: 1,
      provisioning_job_id: "77777777-7777-4777-8777-777777777777",
      aws_account_id: "123456789012",
      aws_instance_id: "i-0123456789abcdef0",
      aws_volume_id: "vol-0123456789abcdef0",
      aws_launch_template_version: "8",
      bootstrap_api_origin: "https://briar-new.example",
      enrollment_nonce_hash: "a".repeat(64),
      enrollment_consumed_at: null,
      enrollment_identity_hash: null,
    });

    await db.prepare(
      `insert into briar_execution_worker_devices (
         id, organization_id, owner_user_id, label, device_identity_hash,
         state, max_concurrent_sessions, last_heartbeat_at, created_at, updated_at
       ) values (
         'managed-33333333-3333-4333-8333-333333333333', ?, ?,
         'Managed computer', ?, 'online', 1, ?, ?, ?
       )`,
    ).bind(
      organizationId,
      userId,
      oldIdentityHash,
      "2026-08-22T00:03:30.000Z",
      "2026-08-22T00:03:30.000Z",
      "2026-08-22T00:03:30.000Z",
    ).run();
    await startManagedComputerProvisioning(
      db,
      "33333333-3333-4333-8333-333333333333",
      "77777777-7777-4777-8777-777777777777",
      "2026-08-22T00:04:00.000Z",
    );
    await db.prepare(
      `update briar_managed_computers
       set state = 'bootstrapping', aws_account_id = '123456789012',
           aws_instance_id = 'i-0fedcba9876543210',
           enrollment_consumed_at = '2026-08-22T00:04:10.000Z',
           enrollment_identity_hash = ?
       where id = '33333333-3333-4333-8333-333333333333'`,
    ).bind(oldIdentityHash).run();
    const replacementEnrollment = await enrollManagedComputerDevice(db, {
      managedComputerId: "33333333-3333-4333-8333-333333333333",
      nonceHash: "a".repeat(64),
      identityHash: newIdentityHash,
      credentialHash: newCredentialHash,
      deviceId: "managed-33333333-3333-4333-8333-333333333333",
      accountId: "123456789012",
      region: "us-east-1",
      instanceId: "i-0fedcba9876543210",
      briarVersion: "1.2.155",
      observedAt: "2026-08-22T00:05:00.000Z",
    });
    expect(replacementEnrollment).toMatchObject({
      state: "needs_setup",
      enrollment_consumed_at: "2026-08-22T00:05:00.000Z",
      enrollment_identity_hash: newIdentityHash,
    });
    await expect(db.prepare(
      `select device_identity_hash from briar_execution_worker_devices
       where id = 'managed-33333333-3333-4333-8333-333333333333'`,
    ).first()).resolves.toMatchObject({
      device_identity_hash: newIdentityHash,
    });
    await expect(db.prepare(
      `select token_hash from briar_execution_worker_credentials
       where device_id = 'managed-33333333-3333-4333-8333-333333333333'`,
    ).first()).resolves.toMatchObject({
      token_hash: newCredentialHash,
    });
    await db.prepare(
      `update briar_managed_computers set state = 'failed'
       where id = '33333333-3333-4333-8333-333333333333'`,
    ).run();

    for (const attempt of [3, 4, 5]) {
      await db.prepare(
        `update briar_managed_computers set state = 'failed'
         where id = '33333333-3333-4333-8333-333333333333'`,
      ).run();
      const nextRetry = await createManagedComputerRetry(db, {
        managedComputerId: "33333333-3333-4333-8333-333333333333",
        organizationId,
        actorUserId: userId,
        requestId: `retry-request-${attempt}`,
        provisioningJobId: `retry-job-${attempt}`,
        workflowInstanceId: `managed-computer-retry-${attempt}`,
        enrollmentNonceHash: String(attempt).repeat(64),
        enrollmentExpiresAt: `2026-08-22T00:${35 + attempt}:00.000Z`,
        region: "us-east-1",
        instanceType: "m7i.large",
        launchTemplateId: "lt-0123456789abcdef0",
        launchTemplateVersion: "8",
        bootstrapApiOrigin: "https://briar-new.example",
        observedAt: `2026-08-22T00:0${attempt}:00.000Z`,
      });
      expect(nextRetry).toMatchObject({
        created: true,
        job: { attempt },
      });
    }
    expect(await managedComputerById(
      db,
      "33333333-3333-4333-8333-333333333333",
    )).toMatchObject({
      state: "requested",
      retry_count: 4,
      provisioning_job_id: "retry-job-5",
    });
  });

  it("keeps a retiring managed computer from accepting new work", async () => {
    const secondOrganizationId = "99999999-9999-4999-8999-999999999999";
    const secondUserId = "pilot-owner-2";
    const computerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
    const jobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
    const projectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccd";
    const deviceId = `managed-${computerId}`;
    const workerId = "dddddddd-dddd-4ddd-8ddd-ddddddddddde";
    const retirementAt = "2026-08-22T00:20:00.000Z";
    const computer = await createPromotionalManagedComputer(db, {
      entitlementId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef",
      managedComputerId: computerId,
      provisioningJobId: jobId,
      workflowInstanceId: `managed-computer-${computerId}`,
      organizationId: secondOrganizationId,
      userId: secondUserId,
      campaignId: "getbriar-pilot",
      requestId: "ffffffff-ffff-4fff-8fff-fffffffffff0",
      organizationLimit: 1,
      fleetLimit: 10,
      region: "us-east-1",
      instanceType: "m7i.large",
      launchTemplateId: "lt-0123456789abcdef0",
      launchTemplateVersion: "8",
      bootstrapApiOrigin: "https://briar.example",
      enrollmentNonceHash: "e".repeat(64),
      enrollmentExpiresAt: "2026-08-22T00:30:00.000Z",
      expiresAt: "2026-09-21T00:00:00.000Z",
      observedAt,
    });
    expect(computer).toMatchObject({ state: "requested" });
    await startManagedComputerProvisioning(db, computerId, jobId, observedAt);
    await failManagedComputerProvisioning(db, {
      managedComputerId: computerId,
      provisioningJobId: jobId,
      code: "PREPARATION_FAILED",
      detail: "test retirement",
      observedAt,
    });
    await db.batch([
      db.prepare(
        `insert into briar_teams (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Retirement project', ?, ?, ?)`,
      ).bind(
        projectId,
        secondUserId,
        secondOrganizationId,
        "f".repeat(64),
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, max_concurrent_sessions, last_heartbeat_at, created_at,
           updated_at
         ) values (?, ?, ?, 'Retiring computer', ?, 'online', 1, ?, ?, ?)`,
      ).bind(
        deviceId,
        secondOrganizationId,
        secondUserId,
        "1".repeat(64),
        observedAt,
        observedAt,
        observedAt,
      ),
      db.prepare(
        `update briar_managed_computers set briar_device_id = ?, updated_at = ?
         where id = ? and state = 'failed'`,
      ).bind(deviceId, observedAt, computerId),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint,
           runtime_proto_json, state, accepting_work,
           readiness_state, readiness_detail, last_heartbeat_at, created_at,
           updated_at
         ) values (
           ?, ?, ?, 'Retiring computer', ?, ?, 'online', 1,
           'ready', null, ?, ?, ?
         )`,
      ).bind(
        workerId,
        projectId,
        deviceId,
        "2".repeat(64),
        workerRuntimeProtoJsonFixture(),
        observedAt,
        observedAt,
        observedAt,
      ),
    ]);

    const retired = await beginManagedComputerRetirement(db, {
      managedComputerId: computerId,
      organizationId: secondOrganizationId,
      observedAt: retirementAt,
    });
    expect(retired).toMatchObject({ state: "draining" });
    await expect(db.prepare(
      `select accepting_work, readiness_state, readiness_detail
       from briar_execution_workers where id = ?`,
    ).bind(workerId).first()).resolves.toMatchObject({
      accepting_work: 0,
      readiness_state: "busy",
      readiness_detail: "Managed computer is not accepting new work.",
    });

    await recordWorkerHeartbeat(db, projectId, {
      workerId,
      runtime: workerRuntimeMetadataFixture(),
      acceptingWork: true,
      readinessState: "ready",
      readinessDetail: "Ready again",
      observedAt: "2026-08-22T00:21:00.000Z",
    });
    await expect(db.prepare(
      `select accepting_work, readiness_state, readiness_detail
       from briar_execution_workers where id = ?`,
    ).bind(workerId).first()).resolves.toMatchObject({
      accepting_work: 0,
      readiness_state: "busy",
      readiness_detail: "Managed computer is not accepting new work.",
    });
    expect(await beginManagedComputerRetirement(db, {
      managedComputerId: computerId,
      organizationId: secondOrganizationId,
      observedAt: "2026-08-22T00:22:00.000Z",
    })).toBeUndefined();
  });

  it("registers a sandbox worker device as a ready computer outside the AWS lifecycle", async () => {
    const deviceId = "briar_device_sandbox_1";
    await db.prepare(
      `insert into briar_execution_worker_devices (
         id, organization_id, owner_user_id, label, device_identity_hash,
         state, max_concurrent_sessions, last_heartbeat_at, created_at, updated_at
       ) values (?, ?, ?, 'sandbox-gx10', ?, 'online', 1, ?, ?, ?)`,
    ).bind(
      deviceId,
      organizationId,
      userId,
      await sha256Hex("sandbox-device"),
      observedAt,
      observedAt,
      observedAt,
    ).run();
    const register = async (suffix: string) =>
      createSandboxManagedComputer(db, {
        managedComputerId: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
        entitlementId: `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`,
        organizationId,
        userId,
        deviceId,
        apiOrigin: "https://briar.example",
        enrollmentNonceHash: await sha256Hex(`sandbox:${suffix}`),
        observedAt,
      });
    const first = await register("000000000001");
    expect(first).toMatchObject({
      provider: "sandbox",
      state: "ready",
      briar_device_id: deviceId,
      device_label: "sandbox-gx10",
      aws_region: "sandbox",
    });
    // AWS lifecycle and pilot capacity never see sandbox rows.
    expect(
      (await listManagedComputersForReconciliation(db)).some((row) => row.provider === "sandbox"),
    ).toBe(false);
    expect(
      (await listOrganizationManagedComputers(db, organizationId))
        .find((row) => row.id === first!.id)?.device_label,
    ).toBe("sandbox-gx10");
    // Re-registering the same device keeps the record and its id, so the
    // relay agent connected under that id stays valid.
    const second = await register("000000000002");
    expect(second?.id).toBe(first!.id);
    expect(second?.state).toBe("ready");
    expect(await managedComputerById(db, "aaaaaaaa-aaaa-4aaa-8aaa-000000000002")).toBeNull();
    // A device another user owns cannot be registered, and the existing
    // record survives the attempt.
    expect(await createSandboxManagedComputer(db, {
      managedComputerId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
      entitlementId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000003",
      organizationId,
      userId: "pilot-owner-2",
      deviceId,
      apiOrigin: "https://briar.example",
      enrollmentNonceHash: await sha256Hex("sandbox:3"),
      observedAt,
    })).toBeNull();
    expect(await sandboxManagedComputerByDevice(db, organizationId, deviceId))
      .toMatchObject({ id: second!.id });
    expect(await deleteSandboxManagedComputer(db, organizationId, deviceId)).toMatchObject({
      id: second!.id,
    });
    expect(await sandboxManagedComputerByDevice(db, organizationId, deviceId)).toBeNull();
  });
});
