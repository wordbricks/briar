import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyForPromotionalManagedComputer,
  validateManagedComputerPromotion,
} from "./managed-computer-service";
import { executeD1Sql } from "./test-helpers/d1";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "promotion-owner";
const observedAt = "2026-08-25T00:00:00.000Z";

describe("managed computer promotion campaigns", () => {
  const db = cloudflareEnv.DB;
  const createWorkflow = vi.fn(async (input: { id: string }) => ({
    id: input.id,
  }));

  const env = () => ({
    MANAGED_COMPUTER_APPLICATIONS_ENABLED: "true",
    MANAGED_COMPUTER_PROMOTION_CODE: JSON.stringify({
      "getbriar-jay-1": "TEST-PROMO-ONE",
      "getbriar-jay-2": "TEST-PROMO-TWO",
    }),
    MANAGED_COMPUTER_ORGANIZATION_LIMIT: "1",
    MANAGED_COMPUTER_FLEET_LIMIT: "1",
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
      get: vi.fn(async (id: string) => ({ id })),
    },
  }) as never;

  beforeAll(async () => {
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('${userId}', 'Promotion Owner', 'promotion@example.com', 1, '${observedAt}', '${observedAt}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${organizationId}', 'Promotion Org', 'promotion-org', '${observedAt}', '${observedAt}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${organizationId}', '${userId}', 'owner', '${observedAt}', '${observedAt}');
    `);
  }, 30_000);

  it("registers Jay promotion campaign slots six through ten", async () => {
    const campaigns = await db.prepare(
      `select id, name, active
       from briar_managed_computer_campaigns
       where id in ('getbriar-jay-6', 'getbriar-jay-7', 'getbriar-jay-8',
                    'getbriar-jay-9', 'getbriar-jay-10')
       order by cast(substr(id, 14) as integer)`,
    ).all<{ id: string; name: string; active: number }>();
    expect(campaigns.results).toEqual([
      {
        id: "getbriar-jay-6",
        name: "Managed computer pilot Jay slot 6",
        active: 1,
      },
      {
        id: "getbriar-jay-7",
        name: "Managed computer pilot Jay slot 7",
        active: 1,
      },
      {
        id: "getbriar-jay-8",
        name: "Managed computer pilot Jay slot 8",
        active: 1,
      },
      {
        id: "getbriar-jay-9",
        name: "Managed computer pilot Jay slot 9",
        active: 1,
      },
      {
        id: "getbriar-jay-10",
        name: "Managed computer pilot Jay slot 10",
        active: 1,
      },
    ]);
  });

  it("allows the next campaign after the previous computer is stopped", async () => {
    const first = await applyForPromotionalManagedComputer(db, env(), {
      organizationId,
      userId,
      code: " test-promo-one ",
      requestId: "22222222-2222-4222-8222-222222222222",
      observedAt,
    });
    expect(first).toMatchObject({
      duplicate: false,
      computer: { state: "requested" },
    });

    await db.prepare(
      `update briar_managed_computers set state = 'draining' where id = ?`,
    ).bind(first.computer.id).run();
    await db.prepare(
      `update briar_managed_computers set state = 'stopped' where id = ?`,
    ).bind(first.computer.id).run();

    await expect(validateManagedComputerPromotion(db, env(), {
      organizationId,
      userId,
      code: "TEST-PROMO-ONE",
      observedAt: "2026-08-25T00:01:00.000Z",
    })).resolves.toMatchObject({
      valid: true,
      eligible: false,
      limitReason: "user",
    });
    await expect(validateManagedComputerPromotion(db, env(), {
      organizationId,
      userId,
      code: "TEST-PROMO-TWO",
      observedAt: "2026-08-25T00:02:00.000Z",
    })).resolves.toMatchObject({
      valid: true,
      eligible: true,
      limitReason: null,
    });

    const second = await applyForPromotionalManagedComputer(db, env(), {
      organizationId,
      userId,
      code: "TEST-PROMO-TWO",
      requestId: "33333333-3333-4333-8333-333333333333",
      observedAt: "2026-08-25T00:03:00.000Z",
    });
    expect(second).toMatchObject({
      duplicate: false,
      computer: { state: "requested" },
    });

    const redemptions = await db.prepare(
      `select campaign_id from briar_managed_computer_promotion_redemptions
       where organization_id = ? order by campaign_id`,
    ).bind(organizationId).all<{ campaign_id: string }>();
    expect(redemptions.results).toEqual([
      { campaign_id: "getbriar-jay-1" },
      { campaign_id: "getbriar-jay-2" },
    ]);
    const audits = await db.prepare(
      `select detail_json from briar_managed_computer_audit_events
       where organization_id = ?`,
    ).bind(organizationId).all<{ detail_json: string }>();
    expect(JSON.stringify(audits.results)).not.toContain("TEST-PROMO");
  });
});
