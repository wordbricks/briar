import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";

describe("managed computer unlimited retry migration", () => {
  it("preserves managed-computer history and permits attempt five", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "managed-computer-unlimited-retry-migration" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await applyD1Migrations(db, {
        through: "0128_agent_skill_documents.sql",
      });
      const now = "2026-08-24T00:00:00.000Z";
      await db.batch([
        db.prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values ('retry-owner', 'Retry Owner', 'retry@example.com', 1, ?, ?)`,
        ).bind(now, now),
        db.prepare(
          `insert into briar_organizations (id, name, handle, created_at, updated_at)
           values ('retry-org', 'Retry Org', 'retry-org', ?, ?)`,
        ).bind(now, now),
      ]);
      await db.prepare(
        `insert into briar_managed_computer_entitlements (
           id, organization_id, requester_user_id, source, source_reference,
           request_id, status, approved_at, expires_at, created_at, updated_at
         ) values (
           'retry-entitlement', 'retry-org', 'retry-owner', 'free_promotion',
           'getbriar-pilot', 'retry-application', 'approved', ?, null, ?, ?
         )`,
      ).bind(now, now, now).run();
      await db.prepare(
        `insert into briar_managed_computers (
           id, organization_id, requester_user_id, entitlement_id, state,
           aws_region, aws_instance_type, aws_launch_template_id,
           aws_launch_template_version, bootstrap_api_origin,
           provisioning_job_id, enrollment_nonce_hash, enrollment_expires_at,
           error_code, error_detail, retry_count, created_at, state_updated_at,
           expires_at, last_retry_at, updated_at
         ) values (
           'retry-computer', 'retry-org', 'retry-owner', 'retry-entitlement',
           'failed', 'us-east-1', 'm7i.large', 'lt-0123456789abcdef0', '3',
           'https://briar.example', 'retry-job-4', ?, ?, 'BOOTSTRAP_TIMEOUT',
           'Enrollment timed out', 3, ?, ?, ?, ?, ?
         )`,
      ).bind(
        "a".repeat(64),
        "2026-08-24T00:30:00.000Z",
        now,
        now,
        "2026-09-24T00:00:00.000Z",
        now,
        now,
      ).run();
      for (const attempt of [1, 2, 3, 4]) {
        await db.prepare(
          `insert into briar_managed_computer_provisioning_jobs (
             id, managed_computer_id, workflow_instance_id, idempotency_key,
             status, attempt, created_at, updated_at
           ) values (?, 'retry-computer', ?, ?, 'failed', ?, ?, ?)`,
        ).bind(
          `retry-job-${attempt}`,
          `retry-workflow-${attempt}`,
          `retry-key-${attempt}`,
          attempt,
          now,
          now,
        ).run();
      }
      await db.batch([
        db.prepare(
          `insert into briar_managed_computer_promotion_redemptions (
             id, organization_id, user_id, managed_computer_id, campaign_id,
             request_id, redeemed_at
           ) values (
             'retry-redemption', 'retry-org', 'retry-owner', 'retry-computer',
             'getbriar-pilot', 'retry-application', ?
           )`,
        ).bind(now),
        db.prepare(
          `insert into briar_managed_computer_audit_events (
             id, organization_id, managed_computer_id, actor_user_id, action,
             request_id, detail_json, occurred_at
           ) values (
             'retry-audit', 'retry-org', 'retry-computer', 'retry-owner',
             'retry_requested', 'retry-request-4', '{}', ?
           )`,
        ).bind(now),
        db.prepare(
          `insert into briar_managed_computer_remote_sessions (
             id, organization_id, managed_computer_id, controller_user_id,
             request_id, state, client_token_hash, token_expires_at,
             max_expires_at, ended_at, end_reason, created_at, updated_at
           ) values (
             'retry-session', 'retry-org', 'retry-computer', 'retry-owner',
             'retry-session-request', 'ended', ?, ?, ?, ?, 'completed', ?, ?
           )`,
        ).bind(
          "b".repeat(64),
          "2026-08-24T00:01:00.000Z",
          "2026-08-24T01:00:00.000Z",
          now,
          now,
          now,
        ),
        db.prepare(
          `insert into briar_managed_computer_remote_audit_events (
             id, organization_id, managed_computer_id, remote_session_id,
             actor_user_id, action, reason_code, occurred_at
           ) values (
             'retry-remote-audit', 'retry-org', 'retry-computer',
             'retry-session', 'retry-owner', 'session_ended', 'completed', ?
           )`,
        ).bind(now),
      ]);

      await applyD1Migrations(db, {
        files: ["0129_managed_computer_unlimited_retries.sql"],
      });

      await db.prepare(
        `update briar_managed_computers set retry_count = 4
         where id = 'retry-computer'`,
      ).run();
      await db.prepare(
        `insert into briar_managed_computer_provisioning_jobs (
           id, managed_computer_id, workflow_instance_id, idempotency_key,
           status, attempt, created_at, updated_at
         ) values (
           'retry-job-5', 'retry-computer', 'retry-workflow-5', 'retry-key-5',
           'requested', 5, ?, ?
         )`,
      ).bind(now, now).run();

      expect(await db.prepare(
        `select retry_count from briar_managed_computers
         where id = 'retry-computer'`,
      ).first()).toEqual({ retry_count: 4 });
      expect(await db.prepare(
        `select count(*) as jobs
         from briar_managed_computer_provisioning_jobs
         where managed_computer_id = 'retry-computer'`,
      ).first()).toEqual({ jobs: 5 });
      expect(await db.prepare(
        `select
           (select count(*) from briar_managed_computer_promotion_redemptions
            where managed_computer_id = 'retry-computer') as redemptions,
           (select count(*) from briar_managed_computer_audit_events
            where managed_computer_id = 'retry-computer') as audits,
           (select count(*) from briar_managed_computer_remote_sessions
            where managed_computer_id = 'retry-computer') as sessions,
           (select count(*) from briar_managed_computer_remote_audit_events
            where managed_computer_id = 'retry-computer') as remote_audits`,
      ).first()).toEqual({
        redemptions: 1,
        audits: 1,
        sessions: 1,
        remote_audits: 1,
      });
      const foreignKeyErrors = await db.prepare("pragma foreign_key_check").all();
      expect(foreignKeyErrors.results).toEqual([]);
    } finally {
      await miniflare.dispose();
    }
  }, 60_000);
});
