import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

describe("Better Auth 1.7 account issuer migration", () => {
  it("rejects an unmapped legacy provider instead of inventing an issuer", async () => {
    const db = env.DB;
    const now = "2026-09-03T00:00:00.000Z";
    await applyD1Migrations(db, {
      through: "0177_managed_computer_jay_promotion_campaigns.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values ('custom-user', 'Custom User', 'custom@example.com', 1, '${now}', '${now}');
      insert into "account" (
        id, accountId, providerId, userId, createdAt, updatedAt
      ) values (
        'custom-account', 'custom-subject', 'custom-provider', 'custom-user', '${now}', '${now}'
      );
    `);

    await expect(applyD1Migrations(db, {
      files: ["0178_better_auth_1_7.sql"],
    })).rejects.toThrow();
    await expect(db.prepare(
      `select accountId, providerId from "account" where id = 'custom-account'`,
    ).first()).resolves.toEqual({
      accountId: "custom-subject",
      providerId: "custom-provider",
    });
  });
});
