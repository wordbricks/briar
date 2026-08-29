import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "./index";
import {
  createIsolatedTestDatabase,
  type IsolatedTestDatabase,
} from "./test-helpers/d1";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerId = "managed-route-owner";
const memberId = "managed-route-member";
const ownerToken = "managed-route-owner-token";
const memberToken = "managed-route-member-token";
const now = "2026-08-22T00:00:00.000Z";

describe("managed computer routes", () => {
  let database: IsolatedTestDatabase;
  let db: D1Database;
  const createWorkflow = vi.fn(async (input: { id: string }) => ({
    id: input.id,
  }));
  const getWorkflow = vi.fn(async (id: string) => ({ id }));

  beforeAll(async () => {
    database = await createIsolatedTestDatabase({
      suite: "managed-computer-routes",
    });
    db = database.db;
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Owner', 'managed-owner@example.com', 1, ?, ?)`,
      ).bind(ownerId, now, now),
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Member', 'managed-member@example.com', 1, ?, ?)`,
      ).bind(memberId, now, now),
      db.prepare(
        `insert into "session" (id, expiresAt, token, createdAt, updatedAt, userId)
         values ('managed-owner-session', '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
      ).bind(ownerToken, now, now, ownerId),
      db.prepare(
        `insert into "session" (id, expiresAt, token, createdAt, updatedAt, userId)
         values ('managed-member-session', '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
      ).bind(memberToken, now, now, memberId),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Managed Routes', 'managed-routes', ?, ?)`,
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
    ]);
  }, 60_000);

  afterAll(async () => database.dispose());

  const env = () => ({
    DB: db,
    BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    MANAGED_COMPUTER_APPLICATIONS_ENABLED: "true",
    MANAGED_COMPUTER_PROMOTION_CODE: "GETBRIAR",
    MANAGED_COMPUTER_ORGANIZATION_LIMIT: "1",
    MANAGED_COMPUTER_FLEET_LIMIT: "5",
    MANAGED_COMPUTER_LIFETIME_DAYS: "30",
    MANAGED_COMPUTER_AWS_REGION: "us-east-1",
    MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_ID: "lt-0123456789abcdef0",
    MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_VERSION: "7",
    MANAGED_COMPUTER_API_ORIGIN: "https://briar.example",
    MANAGED_COMPUTER_ENROLLMENT_SECRET: "managed-enrollment-secret",
    MANAGED_COMPUTER_AWS_IDENTITY_PUBLIC_KEY: "test-public-key",
    MANAGED_COMPUTER_AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    MANAGED_COMPUTER_AWS_SECRET_ACCESS_KEY: "secret",
    MANAGED_COMPUTER_PROVISIONING: {
      create: createWorkflow,
      get: getWorkflow,
    },
  }) as never;

  const request = (
    pathname: string,
    method: "DELETE" | "GET" | "POST",
    token: string,
    body?: unknown,
    requestId?: string,
  ) => new Request(`https://briar.example${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(requestId ? { "idempotency-key": requestId } : undefined),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const executionContext = () => {
    const pending: Promise<unknown>[] = [];
    return {
      context: {
        waitUntil(promise: Promise<unknown>) {
          pending.push(promise);
        },
      } as ExecutionContext,
      pending,
    };
  };

  const seedManagedComputer = async (input: {
    computerId: string;
    entitlementId: string;
    nonce: string;
    state: "failed" | "requested";
  }) => {
    await db.batch([
      db.prepare(
        `insert into briar_managed_computer_entitlements (
           id, organization_id, requester_user_id, source, source_reference,
           request_id, status, approved_at, created_at, updated_at
         ) values (?, ?, ?, 'payment', ?, ?, 'approved', ?, ?, ?)`,
      ).bind(
        input.entitlementId,
        organizationId,
        ownerId,
        `retirement-test:${input.computerId}`,
        `retirement-test:${input.computerId}`,
        now,
        now,
        now,
      ),
      db.prepare(
        `insert into briar_managed_computers (
           id, organization_id, requester_user_id, entitlement_id, state,
           aws_region, aws_instance_type, aws_launch_template_id,
           aws_launch_template_version, bootstrap_api_origin,
           provisioning_job_id, enrollment_nonce_hash, enrollment_expires_at,
           created_at, state_updated_at, expires_at, updated_at
         ) values (
           ?, ?, ?, ?, ?, 'us-east-1', 'm7i.large', 'lt-0123456789abcdef0',
           '7', 'https://briar.example', ?, ?, '2026-08-22T00:30:00.000Z',
           ?, ?, '2026-09-21T00:00:00.000Z', ?
         )`,
      ).bind(
        input.computerId,
        organizationId,
        ownerId,
        input.entitlementId,
        input.state,
        `retirement-job:${input.computerId}`,
        input.nonce.repeat(64),
        now,
        now,
        now,
      ),
    ]);
  };

  it("lets a developer inspect product metadata and validate promotions", async () => {
    const product = await worker.fetch(request(
      `/organizations/${organizationId}/managed-computers/product`,
      "GET",
      memberToken,
    ), env());
    expect(product.status).toBe(200);
    const productPayload = await product.json();
    expect(productPayload).toMatchObject({
      canApply: true,
      applicationsEnabled: true,
      product: { monthlyPriceCents: 10_000 },
    });
    expect(JSON.stringify(productPayload)).not.toContain("GETBRIAR");
    const validation = await worker.fetch(request(
      `/organizations/${organizationId}/managed-computers/promotion/validate`,
      "POST",
      memberToken,
      { code: "GETBRIAR" },
    ), env());
    expect(validation.status).toBe(200);
  });

  it("does not discount an invalid code and requires matching idempotency", async () => {
    const validation = await worker.fetch(request(
      `/organizations/${organizationId}/managed-computers/promotion/validate`,
      "POST",
      ownerToken,
      { code: "not-it" },
    ), env());
    expect(await validation.json()).toMatchObject({
      valid: false,
      eligible: false,
      totalCents: 10_000,
    });
    const missingKey = await worker.fetch(request(
      `/organizations/${organizationId}/managed-computers`,
      "POST",
      ownerToken,
      {
        code: "GETBRIAR",
        requestId: "11111111-1111-4111-8111-111111111111",
      },
    ), env());
    expect(missingKey.status).toBe(400);
    expect(await missingKey.json()).toMatchObject({
      code: "MANAGED_COMPUTER_IDEMPOTENCY_REQUIRED",
    });
  });

  it("creates exactly one entitlement, redemption, computer, and job on replay", async () => {
    const requestId = "22222222-2222-4222-8222-222222222222";
    const application = {
      code: "  getbriar ",
      requestId,
    };
    const first = await worker.fetch(request(
      `/organizations/${organizationId}/managed-computers`,
      "POST",
      ownerToken,
      application,
      requestId,
    ), env());
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({
      duplicate: false,
      entitlement: { source: "free_promotion", totalCents: 0 },
      computer: { state: "requested" },
    });
    const replay = await worker.fetch(request(
      `/organizations/${organizationId}/managed-computers`,
      "POST",
      ownerToken,
      application,
      requestId,
    ), env());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    const counts = await db.prepare(`
      select
        (select count(*) from briar_managed_computer_entitlements) entitlements,
        (select count(*) from briar_managed_computer_promotion_redemptions) redemptions,
        (select count(*) from briar_managed_computers) computers,
        (select count(*) from briar_managed_computer_provisioning_jobs) jobs
    `).first<Record<string, number>>();
    expect(counts).toEqual({
      entitlements: 1,
      redemptions: 1,
      computers: 1,
      jobs: 1,
    });
  });

  it("lets a developer retire a stable computer idempotently", async () => {
    const computerId = "33333333-3333-4333-8333-333333333334";
    await seedManagedComputer({
      computerId,
      entitlementId: "44444444-4444-4444-8444-444444444445",
      nonce: "9",
      state: "failed",
    });

    const immediateStop = executionContext();
    const memberAttempt = await worker.fetch(request(
      `/organizations/${organizationId}/managed-computers/${computerId}`,
      "DELETE",
      memberToken,
    ), env(), immediateStop.context);
    expect(memberAttempt.status).toBe(202);
    expect(await memberAttempt.json()).toMatchObject({
      duplicate: false,
      computer: { id: computerId, state: "draining" },
    });
    expect(immediateStop.pending).toHaveLength(1);
    await Promise.all(immediateStop.pending);

    const replay = await worker.fetch(request(
      `/organizations/${organizationId}/managed-computers/${computerId}`,
      "DELETE",
      ownerToken,
    ), env());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      duplicate: true,
      computer: { id: computerId, state: "stopped" },
    });

    const audits = await db.prepare(
      `select actor_user_id, detail_json
       from briar_managed_computer_audit_events
       where managed_computer_id = ? and action = 'draining_started'`,
    ).bind(computerId).all<{
      actor_user_id: string;
      detail_json: string;
    }>();
    expect(audits.results).toHaveLength(1);
    expect(audits.results[0]?.actor_user_id).toBe(memberId);
    expect(JSON.parse(audits.results[0]?.detail_json ?? "{}"))
      .toEqual({ reason: "user_retired" });
    await expect(db.prepare(
      `select count(*) as count from briar_managed_computer_audit_events
       where managed_computer_id = ? and action = 'stopped'`,
    ).bind(computerId).first()).resolves.toMatchObject({ count: 1 });
  });

  it("does not retire a computer while preparation is still running", async () => {
    const computerId = "33333333-3333-4333-8333-333333333335";
    await seedManagedComputer({
      computerId,
      entitlementId: "44444444-4444-4444-8444-444444444446",
      nonce: "8",
      state: "requested",
    });

    const response = await worker.fetch(request(
      `/organizations/${organizationId}/managed-computers/${computerId}`,
      "DELETE",
      ownerToken,
    ), env());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "MANAGED_COMPUTER_RETIRE_UNAVAILABLE",
    });
    await expect(db.prepare(
      `select state from briar_managed_computers where id = ?`,
    ).bind(computerId).first()).resolves.toMatchObject({ state: "requested" });
  });
});
