import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "./managed-computer-crypto";
import {
  createManagedComputerRetry,
  createPromotionalManagedComputer,
  failManagedComputerProvisioning,
  managedComputerById,
  managedComputerCapacity,
  startManagedComputerProvisioning,
} from "./managed-computer-repository";
import {
  createIsolatedTestDatabase,
  executeD1Sql,
  type IsolatedTestDatabase,
} from "./test-helpers/d1";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "pilot-owner";
const observedAt = "2026-08-22T00:00:00.000Z";

describe("managed computer repository", () => {
  let database: IsolatedTestDatabase;
  let db: D1Database;

  beforeAll(async () => {
    database = await createIsolatedTestDatabase({
      suite: "managed-computer-repository",
    });
    db = database.db;
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

  afterAll(async () => database.dispose());

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
           aws_volume_id = 'vol-0123456789abcdef0'
       where id = '33333333-3333-4333-8333-333333333333'`,
    ).run();
    const retry = await createManagedComputerRetry(db, {
      managedComputerId: "33333333-3333-4333-8333-333333333333",
      organizationId,
      actorUserId: userId,
      requestId: "66666666-6666-4666-8666-666666666666",
      provisioningJobId: "77777777-7777-4777-8777-777777777777",
      workflowInstanceId: "managed-computer-retry-1",
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
    });

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
});
