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
         ) values (?, ?, 'member', ?, ?)`,
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
    method: "GET" | "POST",
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

  it("shows product metadata to a member but forbids promotion approval", async () => {
    const product = await worker.fetch(request(
      `/organizations/${organizationId}/managed-computers/product`,
      "GET",
      memberToken,
    ), env());
    expect(product.status).toBe(200);
    const productPayload = await product.json();
    expect(productPayload).toMatchObject({
      canApply: false,
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
    expect(validation.status).toBe(403);
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
});
