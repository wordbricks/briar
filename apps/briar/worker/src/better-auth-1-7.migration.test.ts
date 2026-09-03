import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

describe("Better Auth 1.7 migration", () => {
  it("preserves legacy account mappings and enforces unique identities", async () => {
    const db = env.DB;
    const now = "2026-09-03T00:00:00.000Z";
    await applyD1Migrations(db, {
      through: "0177_managed_computer_jay_promotion_campaigns.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values
        ('google-user', 'Google User', 'google@example.com', 1, '${now}', '${now}'),
        ('email-user', 'Email User', 'email@example.com', 1, '${now}', '${now}');
      insert into "account" (
        id, accountId, providerId, userId, password, createdAt, updatedAt
      ) values
        ('google-account', 'google-subject', 'google', 'google-user', null, '${now}', '${now}'),
        ('email-account', 'legacy-email-key', 'credential', 'email-user', 'hash', '${now}', '${now}');
      insert into "deviceCode" (
        id, deviceCode, userCode, expiresAt, status
      ) values
        ('device-a', 'duplicate-device', 'code-a', '${now}', 'pending'),
        ('device-b', 'duplicate-device', 'duplicate-user', '${now}', 'pending'),
        ('device-c', 'device-c', 'duplicate-user', '${now}', 'pending');
    `);

    await applyD1Migrations(db, {
      files: ["0178_better_auth_1_7.sql"],
    });

    await expect(db.prepare(
      `select id, issuer, accountId from "account" order by id`,
    ).all()).resolves.toMatchObject({
      results: [
        {
          id: "email-account",
          issuer: "local:credential",
          accountId: "email-user",
        },
        {
          id: "google-account",
          issuer: "https://accounts.google.com",
          accountId: "google-subject",
        },
      ],
    });
    await expect(db.prepare(
      `insert into "account" (
         id, issuer, accountId, providerId, userId, createdAt, updatedAt
       ) values (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "duplicate-google-account",
      "https://accounts.google.com",
      "google-subject",
      "google",
      "google-user",
      now,
      now,
    ).run()).rejects.toThrow();
    await expect(db.prepare(
      `insert into "deviceCode" (
         id, deviceCode, userCode, expiresAt, status
       ) values (?, ?, ?, ?, ?)`,
    ).bind(
      "duplicate-device-code",
      "duplicate-device",
      "new-user-code",
      now,
      "pending",
    ).run()).rejects.toThrow();
    await expect(db.prepare(
      `insert into "deviceCode" (
         id, deviceCode, userCode, expiresAt, status
       ) values (?, ?, ?, ?, ?)`,
    ).bind(
      "duplicate-user-code",
      "new-device-code",
      "duplicate-user",
      now,
      "pending",
    ).run()).rejects.toThrow();
    expect((await db.prepare("pragma foreign_key_check").all()).results)
      .toEqual([]);
  });
});
