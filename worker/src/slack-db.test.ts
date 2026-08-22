import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  claimSlackEvent,
  completeSlackEvent,
  consumeSlackOAuthState,
  createSlackOAuthState,
  deleteSlackInstallation,
  getSlackInstallation,
  listSlackInstallations,
  releaseSlackEvent,
  updateSlackInstallationProject,
  upsertSlackInstallation,
} from "./db";
import { processSlackRevocationQueue } from "./slack-revocations";
import { encryptSlackToken } from "./slack";
import {
  createIsolatedTestDatabase,
  executeD1Sql,
} from "./test-helpers/d1";

describe("Slack D1 integration", () => {
  let miniflare: Miniflare;
  let db: D1Database;
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const firstProjectId = "22222222-2222-4222-8222-222222222222";
  const secondProjectId = "33333333-3333-4333-8333-333333333333";

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "slack-db",
    });
    miniflare = database.miniflare;
    db = database.db;
    const now = "2026-07-29T00:00:00.000Z";
    await executeD1Sql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Owner', 'owner@example.com', 1, '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${organizationId}', 'Briar', 'briar', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${organizationId}', 'owner', 'owner', '${now}', '${now}');
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('member', 'Member', 'member@example.com', 1, '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${organizationId}', 'member', 'member', '${now}', '${now}');
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        '${firstProjectId}', 'owner', '${organizationId}', 'First',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '${now}', '${now}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        '${secondProjectId}', 'owner', '${organizationId}', 'Second',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '${now}', '${now}'
      );
      `,
    );
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("consumes OAuth state exactly once", async () => {
    await createSlackOAuthState(db, {
      stateHash:
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      organizationId,
      defaultProjectId: firstProjectId,
      userId: "owner",
      createdAt: "2026-07-29T00:00:00.000Z",
      expiresAt: "2026-07-29T00:10:00.000Z",
    });

    expect(
      await consumeSlackOAuthState(
        db,
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "2026-07-29T00:05:00.000Z",
      ),
    ).toMatchObject({
      organization_id: organizationId,
      default_project_id: firstProjectId,
      user_id: "owner",
    });
    expect(
      await consumeSlackOAuthState(
        db,
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "2026-07-29T00:05:00.000Z",
      ),
    ).toBeNull();
  });

  it("stores installations and changes only to a project in the organization", async () => {
    await upsertSlackInstallation(db, {
      teamId: "T123",
      teamName: "Briar Slack",
      organizationId,
      defaultProjectId: firstProjectId,
      botUserId: "U123",
      encryptedBotToken: "encrypted",
      tokenIv: "nonce",
      installedByUserId: "owner",
      observedAt: "2026-07-29T00:00:00.000Z",
    });

    expect(await getSlackInstallation(db, "T123")).toMatchObject({
      team_name: "Briar Slack",
      default_project_name: "First",
    });
    expect(
      await updateSlackInstallationProject(
        db,
        organizationId,
        "T123",
        secondProjectId,
      ),
    ).toBe(true);
    expect(await listSlackInstallations(db, organizationId)).toEqual([
      expect.objectContaining({
        team_id: "T123",
        default_project_id: secondProjectId,
        default_project_name: "Second",
      }),
    ]);
    expect(
      await updateSlackInstallationProject(
        db,
        organizationId,
        "T123",
        "44444444-4444-4444-8444-444444444444",
      ),
    ).toBe(false);
  });

  it("atomically preserves the credential before an authorized uninstall", async () => {
    const observedAt = "2026-07-29T00:30:00.000Z";
    await upsertSlackInstallation(db, {
      teamId: "T-ATOMIC-DELETE",
      teamName: "Atomic Slack",
      organizationId,
      defaultProjectId: firstProjectId,
      botUserId: "U-ATOMIC-DELETE",
      encryptedBotToken: "encrypted-atomic",
      tokenIv: "nonce-atomic",
      installedByUserId: "owner",
      observedAt,
    });

    await expect(
      deleteSlackInstallation(db, {
        organizationId,
        teamId: "T-ATOMIC-DELETE",
        actorUserId: "member",
        observedAt,
      }),
    ).resolves.toBe("forbidden");
    await expect(
      getSlackInstallation(db, "T-ATOMIC-DELETE"),
    ).resolves.not.toBeNull();
    await expect(
      db
        .prepare(
          `select count(*) as count from briar_slack_revocation_queue
       where team_id = ?`,
        )
        .bind("T-ATOMIC-DELETE")
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });

    await db
      .prepare(
        `create trigger fail_atomic_slack_revocation_queue
       before insert on briar_slack_revocation_queue
       when new.team_id = 'T-ATOMIC-DELETE'
       begin
         select raise(abort, 'forced Slack revocation outbox failure');
       end`,
      )
      .run();
    try {
      await expect(
        deleteSlackInstallation(db, {
          organizationId,
          teamId: "T-ATOMIC-DELETE",
          actorUserId: "owner",
          observedAt,
        }),
      ).rejects.toThrow("forced Slack revocation outbox failure");
    } finally {
      await db.prepare(`drop trigger fail_atomic_slack_revocation_queue`).run();
    }
    await expect(
      getSlackInstallation(db, "T-ATOMIC-DELETE"),
    ).resolves.not.toBeNull();

    await expect(
      deleteSlackInstallation(db, {
        organizationId,
        teamId: "T-ATOMIC-DELETE",
        actorUserId: "owner",
        observedAt,
      }),
    ).resolves.toBe("deleted");
    await expect(
      getSlackInstallation(db, "T-ATOMIC-DELETE"),
    ).resolves.toBeNull();
    await expect(
      db
        .prepare(
          `select encrypted_bot_token, token_iv, queued_at, next_attempt_at,
              attempts, dead_lettered_at
       from briar_slack_revocation_queue where team_id = ?`,
        )
        .bind("T-ATOMIC-DELETE")
        .first(),
    ).resolves.toEqual({
      encrypted_bot_token: "encrypted-atomic",
      token_iv: "nonce-atomic",
      queued_at: observedAt,
      next_attempt_at: observedAt,
      attempts: 0,
      dead_lettered_at: null,
    });
    await db
      .prepare(`delete from briar_slack_revocation_queue where team_id = ?`)
      .bind("T-ATOMIC-DELETE")
      .run();
  });

  it("advances due retries without letting them monopolize bounded batches", async () => {
    const encryptionKey = "slack-revocation-fairness-key";
    const oldToken = await encryptSlackToken("xoxb-old-retry", encryptionKey);
    const freshToken = await encryptSlackToken("xoxb-fresh", encryptionKey);
    const observedAt = "2026-07-29T02:00:00.000Z";
    await db.batch([
      db
        .prepare(
          `insert into briar_slack_revocation_queue (
           id, team_id, encrypted_bot_token, token_iv, queued_at,
           next_attempt_at, attempts, last_attempt_at, last_error
         ) values (?, ?, ?, ?, ?, ?, 3, ?, 'permanent failure')`,
        )
        .bind(
          "1".repeat(64),
          "T-OLD-RETRY",
          oldToken.encryptedToken,
          oldToken.iv,
          "2026-07-29T00:00:00.000Z",
          "2026-07-29T01:00:00.000Z",
          "2026-07-29T00:55:00.000Z",
        ),
      db
        .prepare(
          `insert into briar_slack_revocation_queue (
           id, team_id, encrypted_bot_token, token_iv, queued_at,
           next_attempt_at
         ) values (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "2".repeat(64),
          "T-FRESH",
          freshToken.encryptedToken,
          freshToken.iv,
          "2026-07-29T01:30:00.000Z",
          "2026-07-29T01:30:00.000Z",
        ),
    ]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        processSlackRevocationQueue(
          db,
          { SLACK_TOKEN_ENCRYPTION_KEY: encryptionKey } as Env,
          observedAt,
          1,
        ),
      ).resolves.toEqual({
        revoked: 0,
        failed: 1,
        deadLettered: 0,
        deferred: 0,
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://slack.com/api/auth.revoke",
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: "Bearer xoxb-old-retry",
          }),
        }),
      );
      await expect(
        db
          .prepare(
            `select attempts, next_attempt_at
             from briar_slack_revocation_queue where id = ?`,
          )
          .bind("1".repeat(64))
          .first(),
      ).resolves.toEqual({
        attempts: 4,
        next_attempt_at: "2026-07-29T02:40:00.000Z",
      });

      await expect(
        processSlackRevocationQueue(
          db,
          { SLACK_TOKEN_ENCRYPTION_KEY: encryptionKey } as Env,
          observedAt,
          1,
        ),
      ).resolves.toEqual({
        revoked: 1,
        failed: 0,
        deadLettered: 0,
        deferred: 0,
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://slack.com/api/auth.revoke",
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: "Bearer xoxb-fresh",
          }),
        }),
      );
      await expect(
        db
          .prepare(`select id from briar_slack_revocation_queue where id = ?`)
          .bind("2".repeat(64))
          .first(),
      ).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
      await db
        .prepare(`delete from briar_slack_revocation_queue where id = ?`)
        .bind("1".repeat(64))
        .run();
    }
  });

  it("dead-letters an eighth failed revoke and alerts only on transition", async () => {
    const encryptionKey = "slack-revocation-dead-letter-key";
    const encrypted = await encryptSlackToken(
      "xoxb-dead-letter",
      encryptionKey,
    );
    const queueId = "3".repeat(64);
    const observedAt = "2026-07-29T03:00:00.000Z";
    await db
      .prepare(
        `insert into briar_slack_revocation_queue (
         id, team_id, encrypted_bot_token, token_iv, queued_at,
         next_attempt_at, attempts, last_attempt_at, last_error
       ) values (?, ?, ?, ?, ?, ?, 7, ?, 'failure seven')`,
      )
      .bind(
        queueId,
        "T-DEAD-LETTER",
        encrypted.encryptedToken,
        encrypted.iv,
        "2026-07-28T00:00:00.000Z",
        observedAt,
        "2026-07-29T02:00:00.000Z",
      )
      .run();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const alertMock = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        processSlackRevocationQueue(
          db,
          { SLACK_TOKEN_ENCRYPTION_KEY: encryptionKey } as Env,
          observedAt,
          1,
        ),
      ).resolves.toEqual({
        revoked: 0,
        failed: 0,
        deadLettered: 1,
        deferred: 0,
      });
      await expect(
        db
          .prepare(
            `select attempts, dead_lettered_at, dead_letter_reason
         from briar_slack_revocation_queue where id = ?`,
          )
          .bind(queueId)
          .first(),
      ).resolves.toEqual({
        attempts: 8,
        dead_lettered_at: observedAt,
        dead_letter_reason: "Slack auth.revoke failed: ratelimited",
      });
      expect(alertMock).toHaveBeenCalledOnce();
      expect(alertMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '"message":"Slack token revocation dead-lettered"',
        ),
      );

      await expect(
        processSlackRevocationQueue(
          db,
          { SLACK_TOKEN_ENCRYPTION_KEY: encryptionKey } as Env,
          "2026-07-30T03:00:00.000Z",
          1,
        ),
      ).resolves.toEqual({
        revoked: 0,
        failed: 0,
        deadLettered: 0,
        deferred: 0,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(alertMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      alertMock.mockRestore();
      await db
        .prepare(`delete from briar_slack_revocation_queue where id = ?`)
        .bind(queueId)
        .run();
    }
  });

  it("deduplicates completed events and allows failed claims to retry", async () => {
    expect(
      await claimSlackEvent(
        db,
        "T123",
        "Ev1",
        "2026-07-29T00:00:00.000Z",
        "2026-07-28T23:55:00.000Z",
      ),
    ).toBe(true);
    expect(
      await claimSlackEvent(
        db,
        "T123",
        "Ev1",
        "2026-07-29T00:01:00.000Z",
        "2026-07-28T23:56:00.000Z",
      ),
    ).toBe(false);
    await releaseSlackEvent(db, "T123", "Ev1");
    expect(
      await claimSlackEvent(
        db,
        "T123",
        "Ev1",
        "2026-07-29T00:02:00.000Z",
        "2026-07-28T23:57:00.000Z",
      ),
    ).toBe(true);
    await completeSlackEvent(
      db,
      "T123",
      "Ev1",
      "2026-07-29T00:02:01.000Z",
    );
    expect(
      await claimSlackEvent(
        db,
        "T123",
        "Ev1",
        "2026-07-29T01:00:00.000Z",
        "2026-07-29T00:55:00.000Z",
      ),
    ).toBe(false);
  });
});
