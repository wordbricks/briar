import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { describe, expect, it } from "vitest";
import {
  createChannel,
  reserveChannelActionProposalApproval,
} from "./channels";
import {
  channelApprovalTablesAvailable,
  createIssueAttachments,
  createIssueMessage,
  getIssueAttachment,
  getRunEvidenceImage,
  recordHuntEvent,
  transferIssue,
} from "./db";
import { createOrganizationAgent } from "./organization-agents";
import { applyD1Migrations, executeD1Sql } from "./test-helpers/d1";

async function withPreWorkflowMigrationDatabase(
  name: string,
  test: (db: D1Database) => Promise<void>,
) {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: name },
  });
  try {
    const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    await applyD1Migrations(db, {
      through: "0058_workflow_pause_after_stage.sql",
    });
    await test(db);
  } finally {
    await miniflare.dispose();
  }
}

const migrationFixture = {
  userId: "migration-owner",
  organizationId: "migration-organization",
  projectId: "migration-project",
  runId: "migration-run",
  now: "2026-08-10T00:00:00.000Z",
  pausedAt: "2026-08-10T00:05:00.000Z",
  workflow: JSON.stringify({
    version: 1,
    stages: [{ id: "implementing", label: "Implement", required: true }],
    completion: { requiredStages: ["implementing"] },
    release: { enabled: false },
  }),
} as const;

async function seedPreWorkflowProjectRun(db: D1Database) {
  const fixture = migrationFixture;
  await db.prepare(
    `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
     values (?, 'Migration Owner', 'migration@example.com', 1, ?, ?)`,
  ).bind(fixture.userId, fixture.now, fixture.now).run();
  await db.prepare(
    `insert into briar_organizations (id, name, handle, created_at, updated_at)
     values (?, 'Migration Organization', 'migration-organization', ?, ?)`,
  ).bind(fixture.organizationId, fixture.now, fixture.now).run();
  await db.prepare(
    `insert into briar_projects (
       id, owner_user_id, organization_id, name, agent_token_hash,
       created_at, updated_at
     ) values (?, ?, ?, 'Migration Project', ?, ?, ?)`,
  ).bind(
    fixture.projectId,
    fixture.userId,
    fixture.organizationId,
    "a".repeat(64),
    fixture.now,
    fixture.now,
  ).run();
  await db.prepare(
    `insert into briar_project_settings (
       project_id, workflow_json, created_at, updated_at
     ) values (?, ?, ?, ?)`,
  ).bind(fixture.projectId, fixture.workflow, fixture.now, fixture.now).run();
  await db.prepare(
    `insert into briar_hunt_runs (
       id, project_id, source, source_key, title, stage, repository,
       started_at, last_event_at, created_at, updated_at,
       workflow_snapshot_json, status, paused_at
     ) values (?, ?, 'issue', 'migration-issue', 'Migration run',
               'implementing', 'example/repository', ?, ?, ?, ?, ?, 'running', ?)`,
  ).bind(
    fixture.runId,
    fixture.projectId,
    fixture.now,
    fixture.now,
    fixture.now,
    fixture.now,
    fixture.workflow,
    fixture.pausedAt,
  ).run();
}

async function createPreWebhookChannelMessage(
  db: D1Database,
  input: {
    id: string;
    channelId: string;
    parentMessageId: string | null;
    authorUserId: string | null;
    authorAgentId: string | null;
    authorAgentName: string | null;
    authorAgentProvider: "codex" | "claude" | "grok" | "agy" | "opencode" | null;
    body: string;
    mentionedUserIds: string[];
    mentionedAgentIds: string[];
    createdAt: string;
  },
) {
  await db.batch([
    db.prepare(
      `insert into briar_channel_messages (
         id, channel_id, parent_message_id, author_user_id, author_agent_id,
         author_agent_name, author_agent_provider, body, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.id,
      input.channelId,
      input.parentMessageId,
      input.authorUserId,
      input.authorAgentId,
      input.authorAgentName,
      input.authorAgentProvider,
      input.body,
      input.createdAt,
      input.createdAt,
    ),
    ...input.mentionedUserIds.map((userId) => db.prepare(
      `insert into briar_channel_message_mentions (
         message_id, user_id, created_at
       ) values (?, ?, ?)`,
    ).bind(input.id, userId, input.createdAt)),
    ...input.mentionedAgentIds.map((agentId) => db.prepare(
      `insert into briar_channel_message_agent_mentions (
         message_id, agent_id, created_at
       ) values (?, ?, ?)`,
    ).bind(input.id, agentId, input.createdAt)),
  ]);
}

describe("D1 migrations", () => {
  it("adds a nullable preferred Worker device to channel reply jobs", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-channel-preferred-device-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await applyD1Migrations(db);
      const columns = await db.prepare(
        `pragma table_info('briar_channel_agent_reply_jobs')`,
      ).all<{ name: string; notnull: number }>();
      expect(columns.results).toContainEqual(expect.objectContaining({
        name: "preferred_device_id",
        notnull: 0,
      }));
      const indexes = await db.prepare(
        `pragma index_list('briar_channel_agent_reply_jobs')`,
      ).all<{ name: string }>();
      expect(indexes.results.map((index) => index.name)).toContain(
        "briar_channel_agent_reply_jobs_preferred_device_idx",
      );
      const foreignKeys = await db.prepare(
        `pragma foreign_key_list('briar_channel_agent_reply_jobs')`,
      ).all<{ from: string; table: string; on_delete: string }>();
      expect(foreignKeys.results).toContainEqual(expect.objectContaining({
        from: "preferred_device_id",
        table: "briar_execution_worker_devices",
        on_delete: "SET NULL",
      }));
    } finally {
      await miniflare.dispose();
    }
  }, 60_000);

  it("cuts over legacy transcripts without importing their history", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-agent-worklog-cutover-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await applyD1Migrations(db, {
        through: "0102_channel_read_states.sql",
      });
      await db.batch([
        db.prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, 'Migration Owner', 'cutover@example.com', 1, ?, ?)`,
        ).bind(
          migrationFixture.userId,
          migrationFixture.now,
          migrationFixture.now,
        ),
        db.prepare(
          `insert into briar_organizations (
             id, name, handle, created_at, updated_at
           ) values (?, 'Migration Organization', 'cutover', ?, ?)`,
        ).bind(
          migrationFixture.organizationId,
          migrationFixture.now,
          migrationFixture.now,
        ),
        db.prepare(
          `insert into briar_projects (
             id, owner_user_id, organization_id, name, agent_token_hash,
             created_at, updated_at
           ) values (?, ?, ?, 'Migration Project', ?, ?, ?)`,
        ).bind(
          migrationFixture.projectId,
          migrationFixture.userId,
          migrationFixture.organizationId,
          "a".repeat(64),
          migrationFixture.now,
          migrationFixture.now,
        ),
      ]);
      const sessionId = "legacy-cutover-session";
      const archiveId = "abababababababababababababababababababababababababababababababab";
      const objectKey = "archives/legacy-cutover.jsonl.gz";
      await db.batch([
        db.prepare(
          `insert into briar_agent_transcript_sessions (
             session_id, project_id, run_id, worker_id, agent_provider,
             started_at, last_event_at, event_count, byte_count
           ) values (?, ?, null, null, 'codex', ?, ?, 1, 16)`,
        ).bind(
          sessionId,
          migrationFixture.projectId,
          migrationFixture.now,
          migrationFixture.now,
        ),
        db.prepare(
          `insert into briar_agent_transcripts (
             session_id, sequence, direction, payload_json, recorded_at
           ) values (?, 1, 'server', '{"legacy":true}', ?)`,
        ).bind(sessionId, migrationFixture.now),
        db.prepare(
          `insert into briar_log_archives (
             id, project_id, run_id, scope_id, archive_kind, object_key,
             format_version, status, row_count, byte_size, sha256,
             content_sha256, period_start, period_end, created_at, verified_at,
             completed_at, expires_at, failure_count, last_error,
             related_object_keys_json
           ) values (?, ?, null, ?, 'agent_transcript', ?, 1, 'complete', 2, 1,
                     ?, ?, ?, ?, ?, ?, ?, ?, 0, null, '[]')`,
        ).bind(
          archiveId,
          migrationFixture.projectId,
          sessionId,
          objectKey,
          "a".repeat(64),
          "b".repeat(64),
          migrationFixture.now,
          migrationFixture.now,
          migrationFixture.now,
          migrationFixture.now,
          migrationFixture.now,
          "2029-08-10T00:00:00.000Z",
        ),
      ]);

      await applyD1Migrations(db, {
        files: ["0103_agent_worklog_projection.sql"],
      });

      await expect(db.prepare(
        `select count(*) as count from briar_agent_transcript_sessions`,
      ).first<number>("count")).resolves.toBe(0);
      await expect(db.prepare(
        `select count(*) as count from briar_agent_transcripts`,
      ).first<number>("count")).resolves.toBe(0);
      await expect(db.prepare(
        `select count(*) as count from briar_log_archives
         where archive_kind = 'agent_transcript'`,
      ).first<number>("count")).resolves.toBe(0);
      await expect(db.prepare(
        `select bucket, object_key from briar_archive_cleanup_queue
         where object_key = ?`,
      ).bind(objectKey).first()).resolves.toEqual({
        bucket: "archives",
        object_key: objectKey,
      });
    } finally {
      await miniflare.dispose();
    }
  }, 60_000);

  it("preserves channel message relations while adding webhook authors", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-channel-webhook-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await applyD1Migrations(db, {
        through: "0096_suppress_lease_sync_changes.sql",
      });
      await applyD1Migrations(db, {
        files: ["0102_channel_read_states.sql"],
      });
      const now = "2026-08-12T00:00:00.000Z";
      const userId = "webhook-migration-owner";
      const organizationId = "71000000-0000-4000-8000-000000000001";
      const channelId = "72000000-0000-4000-8000-000000000001";
      const agentId = "73000000-0000-4000-8000-000000000001";
      const rootId = "74000000-0000-4000-8000-000000000001";
      const replyId = "75000000-0000-4000-8000-000000000001";
      await db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Migration owner', 'webhook-migration@example.com', 1, ?, ?)`,
      ).bind(userId, now, now).run();
      await db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Webhook migration', 'webhook-migration', ?, ?)`,
      ).bind(organizationId, now, now).run();
      await db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, userId, now, now).run();
      await createChannel(db, {
        id: channelId,
        organizationId,
        slug: "migration",
        name: "Migration",
        topic: null,
        visibility: "public",
        defaultProjectId: null,
        createdByUserId: userId,
        createdAt: now,
      });
      await createOrganizationAgent(db, {
        id: agentId,
        organizationId,
        name: "Migration Agent",
        provider: "codex",
        model: null,
        responsibility: "Verify the migration.",
        effort: null,
        createdAt: now,
      });
      await createPreWebhookChannelMessage(db, {
        id: rootId,
        channelId,
        parentMessageId: null,
        authorUserId: userId,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentProvider: null,
        body: "Preserve this root",
        mentionedUserIds: [userId],
        mentionedAgentIds: [agentId],
        createdAt: now,
      });
      await createPreWebhookChannelMessage(db, {
        id: replyId,
        channelId,
        parentMessageId: rootId,
        authorUserId: null,
        authorAgentId: agentId,
        authorAgentName: "Migration Agent",
        authorAgentProvider: "codex",
        body: "Preserve this reply",
        mentionedUserIds: [],
        mentionedAgentIds: [],
        createdAt: now,
      });
      await db.batch([
        db.prepare(
          `insert into briar_channel_agent_reply_jobs (
             id, organization_id, channel_id, project_id, agent_id,
             trigger_message_id, parent_message_id, reply_message_id,
             status, agent_provider, created_at, updated_at, completed_at
           ) values (?, ?, ?, null, ?, ?, ?, ?, 'completed', 'codex', ?, ?, ?)`,
        ).bind(
          "76000000-0000-4000-8000-000000000001",
          organizationId,
          channelId,
          agentId,
          rootId,
          rootId,
          replyId,
          now,
          now,
          now,
        ),
        db.prepare(
          `insert into briar_channel_message_documents (
             message_id, channel_id, project_id, title, markdown,
             created_at, updated_at
           ) values (?, ?, null, 'Migration plan', '# Preserve me', ?, ?)`,
        ).bind(replyId, channelId, now, now),
        db.prepare(
          `insert into briar_channel_message_attachments (
             id, organization_id, channel_id, message_id, object_key,
             filename, content_type, byte_size, created_at
           ) values (?, ?, ?, ?, ?, 'proof.png', 'image/png', 1, ?)`,
        ).bind(
          "77000000-0000-4000-8000-000000000001",
          organizationId,
          channelId,
          rootId,
          "channels/migration/proof.png",
          now,
        ),
        db.prepare(
          `insert into briar_channel_message_reactions (
             message_id, user_id, emoji, created_at
           ) values (?, ?, '✅', ?)`,
        ).bind(rootId, userId, now),
      ]);

      await applyD1Migrations(db, {
        files: ["0099_channel_incoming_webhooks.sql"],
      });

      await expect(db.prepare(
        `select count(*) as count from briar_channel_messages`,
      ).first()).resolves.toEqual({ count: 2 });
      for (const table of [
        "briar_channel_message_mentions",
        "briar_channel_message_agent_mentions",
        "briar_channel_agent_reply_jobs",
        "briar_channel_message_documents",
        "briar_channel_message_attachments",
        "briar_channel_message_reactions",
      ]) {
        await expect(db.prepare(`select count(*) as count from ${table}`).first())
          .resolves.toEqual({ count: 1 });
      }
      await expect(db.prepare(
        `select parent_message_id, author_webhook_id, author_webhook_name
         from briar_channel_messages where id = ?`,
      ).bind(replyId).first()).resolves.toEqual({
        parent_message_id: rootId,
        author_webhook_id: null,
        author_webhook_name: null,
      });
      await expect(db.prepare("pragma foreign_key_check").all())
        .resolves.toMatchObject({ results: [] });
    } finally {
      await miniflare.dispose();
    }
  }, 60_000);

  it("creates an exact immutable provider-cost ledger", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-run-cost-ledger-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await db.prepare(
        `create table briar_run_execution_attempts (
           id text primary key not null
         )`,
      ).run();
      await executeD1Sql(
        db,
        await readFile(resolve("migrations/0085_run_cost_ledger.sql"), "utf8"),
      );
      await db.prepare(
        `insert into briar_run_execution_attempts (id) values ('execution-1')`,
      ).run();

      const insertCost = (costKey: string, amountUsdTicks: number) =>
        db.prepare(
          `insert into briar_run_cost_records (
             execution_id, cost_key, usage_key, session_id, turn_id, scope_id,
             agent_provider, model_provider, model, canonical_model,
             model_source, source, amount_usd_ticks, observed_at, recorded_at
           ) values (
             'execution-1', ?, null, 'session-1', null, 'scope-1',
             'grok', 'xai', 'grok-4.5', null, 'providerReported',
             'grok.prompt.cost', ?, '2026-08-10T00:00:00.000Z',
             '2026-08-10T00:00:01.000Z'
           )`,
        ).bind(costKey, amountUsdTicks).run();

      await expect(insertCost("cost-1", 12_345_678)).resolves.toBeDefined();
      await expect(insertCost("cost-1", 99)).rejects.toThrow();
      await expect(insertCost("negative", -1)).rejects.toThrow();
      await expect(insertCost("fractional", 1.5)).rejects.toThrow();
      await expect(
        insertCost("unsafe", Number.MAX_SAFE_INTEGER + 1),
      ).rejects.toThrow();

      const indices = await db.prepare(
        `select name from sqlite_master
         where type = 'index' and name like 'briar_run_cost_records_%'
         order by name`,
      ).all<{ name: string }>();
      expect(indices.results.map((index) => index.name)).toEqual([
        "briar_run_cost_records_observed_idx",
        "briar_run_cost_records_usage_idx",
      ]);

      await db.prepare(
        `delete from briar_run_execution_attempts where id = 'execution-1'`,
      ).run();
      const remaining = await db.prepare(
        `select count(*) as count from briar_run_cost_records`,
      ).first<{ count: number }>();
      expect(remaining?.count).toBe(0);
    } finally {
      await miniflare.dispose();
    }
  });

  it.each([
    "0049_dashboard_delta_sync.sql",
    "0050_hunt_run_event_count.sql",
    "0053_issue_result_reviews.sql",
    "0055_agent_provider_opencode.sql",
    "0074_channel_delta_sync.sql",
    "0081_optimize_dashboard_worker_device_sync.sql",
    "0083_suppress_heartbeat_dashboard_changes.sql",
    "0089_channel_agent_delegation.sql",
    "0090_channel_issue_approval.sql",
    "0091_issue_execution_approvals.sql",
    "0092_agent_skill_execution_approvals.sql",
    "0093_project_agent_session_sync.sql",
    "0095_organization_inbox_sync.sql",
    "0096_suppress_lease_sync_changes.sql",
    "0098_issue_subscriptions.sql",
    "0099_channel_incoming_webhooks.sql",
    "0100_channel_issue_regular_lifecycle.sql",
    "0101_issue_conversation_realtime.sql",
    "0102_auto_issue_subscriptions.sql",
    "0106_agent_provider_agy.sql",
    "0105_organization_inbox_realtime.sql",
  ])("keeps each trigger in a separate Wrangler statement: %s", async (name) => {
    const sql = await readFile(resolve("migrations", name), "utf8");
    const statements = unstable_splitSqlQuery(sql);
    const triggerCounts = statements.map(
      (statement) => statement.match(/\bcreate\s+trigger\b/giu)?.length ?? 0,
    );

    expect(Math.max(...triggerCounts)).toBeLessThanOrEqual(1);
    expect(triggerCounts.filter((count) => count === 1)).not.toHaveLength(0);
  });

  it("suppresses lease-only run and channel deltas", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-lease-sync-suppression-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await executeD1Sql(
        db,
        `create table briar_hunt_runs (
           id text primary key, project_id text not null, status text not null,
           lease_expires_at text, updated_at text not null
         );
         create table briar_dashboard_changes (
           version integer primary key autoincrement, project_id text not null,
           entity_type text not null, entity_id text, operation text not null,
           created_at text not null
         );
         create table briar_dashboard_sync_state (
           project_id text primary key, current_version integer not null
         );
         create table briar_channel_agent_reply_jobs (
           id text primary key, organization_id text not null,
           channel_id text not null, status text not null,
           lease_expires_at text, updated_at text not null
         );
         create table briar_channel_changes (
           version integer primary key autoincrement,
           organization_id text not null, channel_id text,
           entity_type text not null, entity_id text, operation text not null,
           created_at text not null
         );
         create table briar_channel_sync_state (
           organization_id text primary key, current_version integer not null
         );
         create trigger briar_dashboard_runs_update_sync
         after update on briar_hunt_runs begin select new.id; end;
         create trigger briar_channel_changes_reply_jobs_update_sync
         after update on briar_channel_agent_reply_jobs begin select new.id; end;`,
      );
      await executeD1Sql(
        db,
        await readFile(
          resolve("migrations", "0096_suppress_lease_sync_changes.sql"),
          "utf8",
        ),
      );
      const initialAt = "2026-08-12T00:00:00.000Z";
      await db.prepare(
        `insert into briar_hunt_runs (
           id, project_id, status, lease_expires_at, updated_at
         ) values ('run-1', 'project-1', 'running', ?, ?)`,
      ).bind(initialAt, initialAt).run();
      await db.prepare(
        `insert into briar_channel_agent_reply_jobs (
           id, organization_id, channel_id, status, lease_expires_at, updated_at
         ) values (
           'reply-1', 'organization-1', 'channel-1', 'running', ?, ?
         )`,
      ).bind(initialAt, initialAt).run();

      await db.prepare(
        `update briar_hunt_runs set lease_expires_at = ? where id = 'run-1'`,
      ).bind("2026-08-12T00:05:00.000Z").run();
      await db.prepare(
        `update briar_channel_agent_reply_jobs
         set lease_expires_at = ? where id = 'reply-1'`,
      ).bind("2026-08-12T00:05:00.000Z").run();
      await expect(db.prepare(
        `select count(*) as count from briar_dashboard_changes`,
      ).first()).resolves.toEqual({ count: 0 });
      await expect(db.prepare(
        `select count(*) as count from briar_channel_changes`,
      ).first()).resolves.toEqual({ count: 0 });

      const claimedAt = "2026-08-12T00:06:00.000Z";
      await db.prepare(
        `update briar_hunt_runs
         set lease_expires_at = ?, updated_at = ? where id = 'run-1'`,
      ).bind("2026-08-12T00:21:00.000Z", claimedAt).run();
      await db.prepare(
        `update briar_channel_agent_reply_jobs
         set lease_expires_at = ?, updated_at = ? where id = 'reply-1'`,
      ).bind("2026-08-12T00:21:00.000Z", claimedAt).run();
      await expect(db.prepare(
        `select project_id, entity_type, entity_id
         from briar_dashboard_changes`,
      ).first()).resolves.toEqual({
        project_id: "project-1",
        entity_type: "run",
        entity_id: "run-1",
      });
      await expect(db.prepare(
        `select organization_id, channel_id, entity_type, entity_id
         from briar_channel_changes`,
      ).first()).resolves.toEqual({
        organization_id: "organization-1",
        channel_id: "channel-1",
        entity_type: "reply_job",
        entity_id: "reply-1",
      });
    } finally {
      await miniflare.dispose();
    }
  });

  it("advances one organization Inbox revision for every feed source", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-organization-inbox-sync-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await applyD1Migrations(db);
      const userId = "inbox-sync-user";
      const organizationId = "91000000-0000-4000-8000-000000000001";
      const projectId = "92000000-0000-4000-8000-000000000001";
      const channelId = "93000000-0000-4000-8000-000000000001";
      const now = "2026-08-12T00:00:00.000Z";

      await db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Inbox User', 'inbox-sync@example.com', 1, ?, ?)`,
      ).bind(userId, now, now).run();
      await db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Inbox Org', 'inbox-org', ?, ?)`,
      ).bind(organizationId, now, now).run();
      await db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, userId, now, now).run();
      await db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Inbox Project', ?, ?, ?)`,
      ).bind(
        projectId,
        userId,
        organizationId,
        "9".repeat(64),
        now,
        now,
      ).run();

      const version = async () =>
        (await db.prepare(
          `select current_version
           from briar_organization_inbox_sync_state
           where organization_id = ?`,
        ).bind(organizationId).first<{ current_version: number }>())
          ?.current_version ?? 0;

      expect(await version()).toBe(1);
      await db.prepare(
        `insert into briar_dashboard_sync_state (project_id, current_version)
         values (?, 1)`,
      ).bind(projectId).run();
      expect(await version()).toBe(2);

      await db.prepare(
        `insert into briar_project_agent_session_sync_state (
           project_id, current_version
         ) values (?, 1)`,
      ).bind(projectId).run();
      expect(await version()).toBe(3);

      await db.prepare(
        `insert into briar_channels (
           id, organization_id, slug, name, visibility,
           created_by_user_id, created_at, updated_at
         ) values (?, ?, 'inbox', 'Inbox', 'private', ?, ?, ?)`,
      ).bind(channelId, organizationId, userId, now, now).run();
      expect(await version()).toBe(4);

      await db.prepare(
        `insert into briar_channel_members (
           channel_id, user_id, role, created_at
         ) values (?, ?, 'owner', ?)`,
      ).bind(channelId, userId, now).run();
      expect(await version()).toBe(5);

      await db.prepare(
        `update "user" set name = 'Renamed Inbox User', updatedAt = ?
         where id = ?`,
      ).bind("2026-08-12T00:01:00.000Z", userId).run();
      expect(await version()).toBe(6);
      await expect(db.prepare(
        `select organization_id, version
         from briar_organization_inbox_realtime_outbox`,
      ).first()).resolves.toEqual({
        organization_id: organizationId,
        version: 6,
      });
    } finally {
      await miniflare.dispose();
    }
  }, 60_000);

  it("only finalizes a canonical reserved channel issue run", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-channel-canonical-approval-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await applyD1Migrations(db, {
        through: "0090_channel_issue_approval.sql",
      });
      await applyD1Migrations(db, {
        files: [
          "0099_project_usage_analytics.sql",
          "0102_channel_read_states.sql",
        ],
      });
      const ownerId = "channel-canonical-owner";
      const approverId = "channel-canonical-approver";
      const organizationId = "81000000-0000-4000-8000-000000000001";
      const projectId = "82000000-0000-4000-8000-000000000001";
      const channelId = "83000000-0000-4000-8000-000000000001";
      const agentId = "84000000-0000-4000-8000-000000000001";
      const triggerMessageId = "85000000-0000-4000-8000-000000000001";
      const replyMessageId = "86000000-0000-4000-8000-000000000001";
      const proposalId = "87000000-0000-4000-8000-000000000001";
      const sourceKey = `briar-channel-approved:${"7".repeat(64)}`;
      const now = "2026-08-10T00:00:00.000Z";
      const approvedAt = "2026-08-10T00:01:00.000Z";
      const canonicalPayload = JSON.stringify({
        issue: {
          title: "Canonical issue",
          description: "The member approved this exact content.",
          priority: 3,
          status: "backlog",
        },
      });

      for (const [id, email] of [
        [ownerId, "canonical-owner@example.com"],
        [approverId, "canonical-approver@example.com"],
      ]) {
        await db.prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
        ).bind(id, id, email, now, now).run();
      }
      await db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Canonical Org', 'canonical-org', ?, ?)`,
      ).bind(organizationId, now, now).run();
      for (const [id, role] of [[ownerId, "owner"], [approverId, "member"]]) {
        await db.prepare(
          `insert into briar_organization_members (
             organization_id, user_id, role, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
        ).bind(organizationId, id, role, now, now).run();
      }
      await db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Canonical Project', ?, ?, ?)`,
      ).bind(
        projectId,
        ownerId,
        organizationId,
        "d".repeat(64),
        now,
        now,
      ).run();
      await db.prepare(
        `insert into briar_project_settings (
           project_id, github_repository, workflow_json,
           mandatory_checkpoints_json, created_at, updated_at
         ) values (?, 'wordbricks/canonical-project', ?, '[]', ?, ?)`,
      ).bind(
        projectId,
        JSON.stringify({
          version: 2,
          requirements: [],
          stages: [{ id: "implementing", label: "Implement", required: true }],
          execution: { checkpoints: [] },
          completion: { requiredStages: ["implementing"] },
        }),
        now,
        now,
      ).run();
      await createChannel(db, {
        id: channelId,
        organizationId,
        slug: "canonical",
        name: "Canonical",
        topic: null,
        visibility: "public",
        defaultProjectId: projectId,
        createdByUserId: ownerId,
        createdAt: now,
      });
      await createOrganizationAgent(db, {
        id: agentId,
        organizationId,
        name: "Canonical Agent",
        provider: "codex",
        model: null,
        responsibility: "Propose canonical issues.",
        effort: null,
        createdAt: now,
      });
      await createPreWebhookChannelMessage(db, {
        id: triggerMessageId,
        channelId,
        parentMessageId: null,
        authorUserId: ownerId,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentProvider: null,
        body: "Create the canonical issue",
        mentionedUserIds: [],
        mentionedAgentIds: [agentId],
        createdAt: now,
      });
      await createPreWebhookChannelMessage(db, {
        id: replyMessageId,
        channelId,
        parentMessageId: triggerMessageId,
        authorUserId: null,
        authorAgentId: agentId,
        authorAgentName: "Canonical Agent",
        authorAgentProvider: "codex",
        body: "Canonical issue proposal",
        mentionedUserIds: [],
        mentionedAgentIds: [],
        createdAt: now,
      });
      const insertProposal = (payloadJson: string) => db.prepare(
        `insert into briar_channel_action_proposals (
           id, channel_id, project_id, trigger_message_id, reply_message_id,
           action_type, payload_json, created_at, updated_at
         ) values (?, ?, ?, ?, ?, 'request_issue_create', ?, ?, ?)`,
      ).bind(
        proposalId,
        channelId,
        projectId,
        triggerMessageId,
        replyMessageId,
        payloadJson,
        now,
        now,
      ).run();
      await insertProposal(canonicalPayload);
      await expect(reserveChannelActionProposalApproval(db, {
        organizationId,
        channelId,
        proposalId,
        projectId,
        userId: approverId,
        approvedAt,
        issueSourceKey: sourceKey,
      })).resolves.toMatchObject({ issue_source_key: sourceKey });

      type HuntInput = Parameters<typeof recordHuntEvent>[2];
      const context = {
        origin: "briar-channel",
        proposalId,
        channelId,
        issueId: proposalId,
        attachmentCount: 0,
        fullAuto: false,
      };
      const canonicalInput: HuntInput = {
        source: "issue",
        sourceKey,
        title: "Canonical issue",
        stage: "queued",
        status: "backlog",
        workflowStage: null,
        eventKey: `${sourceKey}:backlog:intake`,
        occurredAt: now,
        actor: "briar-channel",
        repository: "wordbricks/canonical-project",
        detail: "채널 대화에서 사용자가 승인한 제안으로 생성된 이슈입니다.",
        priority: 3,
        assigneeUserId: null,
        issueCheckpoints: [],
        fullAuto: false,
        branch: null,
        commitSha: null,
        tracker: null,
        issueDescription: "The member approved this exact content.",
        resultSummary: null,
        structuredResult: null,
        pullRequestUrls: [],
        targetSha: null,
        sourceCreatedAt: now,
        qaStatus: null,
        stagingQaDetail: null,
        productionQaDetail: null,
        context,
        createdByUserId: approverId,
        preferredAgentProvider: null,
        preferredAgentModel: null,
        preferredAgentEffort: null,
      };
      const assertStillReserved = async () => {
        await expect(db.prepare(
          `select status, result_run_id from briar_channel_action_proposals
           where id = ?`,
        ).bind(proposalId).first()).resolves.toEqual({
          status: "pending",
          result_run_id: null,
        });
        await expect(db.prepare(
          `select count(*) as count from briar_hunt_runs
           where source = 'issue'
             and source_key like 'briar-channel-approved:%'`,
        ).first()).resolves.toEqual({ count: 0 });
        await expect(db.prepare(
          `select count(*) as count from briar_channel_issue_approval_audit
           where proposal_id = ?`,
        ).bind(proposalId).first()).resolves.toEqual({ count: 0 });
      };
      const attempt = (overrides: Partial<HuntInput>) =>
        recordHuntEvent(db, projectId, { ...canonicalInput, ...overrides });

      await expect(attempt({ title: "Injected title" })).rejects.toThrow(
        "channel proposal approval reservation not found",
      );
      await assertStillReserved();
      await expect(attempt({
        repository: "attacker/poisoned-repository",
        context: { ...context, fullAuto: true },
      })).rejects.toThrow("channel proposal approval reservation not found");
      await assertStillReserved();
      await expect(attempt({
        status: "queued",
        preferredAgentProvider: "codex",
      })).rejects.toThrow("channel proposal approval reservation not found");
      await assertStillReserved();

      const malformedSourceKey = `briar-channel-approved:${"A".repeat(64)}`;
      await db.prepare(
        `update briar_channel_action_proposals set issue_source_key = ?
         where id = ?`,
      ).bind(malformedSourceKey, proposalId).run();
      await expect(attempt({
        sourceKey: malformedSourceKey,
        eventKey: `${malformedSourceKey}:backlog:intake`,
      })).rejects.toThrow("channel proposal approval reservation not found");
      await assertStillReserved();
      await db.prepare(
        `update briar_channel_action_proposals set issue_source_key = ?
         where id = ?`,
      ).bind(sourceKey, proposalId).run();

      await db.prepare(
        `delete from briar_channel_action_proposals where id = ?`,
      ).bind(proposalId).run();
      await insertProposal(JSON.stringify({
        issue: { title: "Canonical issue", priority: 3, status: "backlog" },
      }));
      await expect(reserveChannelActionProposalApproval(db, {
        organizationId,
        channelId,
        proposalId,
        projectId,
        userId: approverId,
        approvedAt,
        issueSourceKey: sourceKey,
      })).resolves.toMatchObject({ issue_source_key: sourceKey });
      await expect(attempt({ issueDescription: null })).rejects.toThrow(
        "channel proposal approval reservation not found",
      );
      await assertStillReserved();
      await db.prepare(
        `delete from briar_channel_action_proposals where id = ?`,
      ).bind(proposalId).run();
      await insertProposal(canonicalPayload);
      await expect(reserveChannelActionProposalApproval(db, {
        organizationId,
        channelId,
        proposalId,
        projectId,
        userId: approverId,
        approvedAt,
        issueSourceKey: sourceKey,
      })).resolves.toMatchObject({ issue_source_key: sourceKey });

      const runId = await recordHuntEvent(db, projectId, canonicalInput);
      await expect(db.prepare(
        `select status, stage, repository from briar_hunt_runs where id = ?`,
      ).bind(runId).first()).resolves.toEqual({
        status: "backlog",
        stage: "queued",
        repository: "wordbricks/canonical-project",
      });
      await expect(db.prepare(
        `select status, result_run_id from briar_channel_action_proposals
         where id = ?`,
      ).bind(proposalId).first()).resolves.toEqual({
        status: "accepted",
        result_run_id: runId,
      });
      await expect(db.prepare(
        `select run_id, result_verification
         from briar_channel_issue_approval_audit where proposal_id = ?`,
      ).bind(proposalId).first()).resolves.toEqual({
        run_id: runId,
        result_verification: "atomic",
      });
    } finally {
      await miniflare.dispose();
    }
  }, 60_000);

  it("upgrades channel approvals with audit backfill and legacy quarantine", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-channel-approval-upgrade-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await applyD1Migrations(db, { through: "0089_channel_agent_delegation.sql" });
      await applyD1Migrations(db, {
        files: [
          "0099_project_usage_analytics.sql",
          "0102_channel_read_states.sql",
        ],
      });
      const userId = "channel-upgrade-owner";
      const approverId = "channel-upgrade-approver";
      const organizationId = "91000000-0000-4000-8000-000000000001";
      const projectId = "92000000-0000-4000-8000-000000000001";
      const targetProjectId = "92000000-0000-4000-8000-000000000002";
      const unconfiguredTargetProjectId =
        "92000000-0000-4000-8000-000000000003";
      const channelId = "93000000-0000-4000-8000-000000000001";
      const agentId = "94000000-0000-4000-8000-000000000001";
      const now = "2026-08-10T00:00:00.000Z";

      for (const [id, email] of [
        [userId, "upgrade-owner@example.com"],
        [approverId, "upgrade-approver@example.com"],
      ]) {
        await db.prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
        ).bind(id, id, email, now, now).run();
      }
      await db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Upgrade Org', 'upgrade-org', ?, ?)`,
      ).bind(organizationId, now, now).run();
      for (const [id, role] of [[userId, "owner"], [approverId, "member"]]) {
        await db.prepare(
          `insert into briar_organization_members (
             organization_id, user_id, role, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
        ).bind(organizationId, id, role, now, now).run();
      }
      await db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Upgrade Project', ?, ?, ?)`,
      ).bind(projectId, userId, organizationId, "a".repeat(64), now, now).run();
      await db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Transfer Target', ?, ?, ?)`,
      ).bind(
        targetProjectId,
        userId,
        organizationId,
        "b".repeat(64),
        now,
        now,
      ).run();
      await db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Unconfigured Transfer Target', ?, ?, ?)`,
      ).bind(
        unconfiguredTargetProjectId,
        userId,
        organizationId,
        "c".repeat(64),
        now,
        now,
      ).run();
      await db.prepare(
        `insert into briar_project_settings (
           project_id, workflow_json, mandatory_checkpoints_json,
           created_at, updated_at
         ) values (?, ?, '[]', ?, ?)`,
      ).bind(
        projectId,
        JSON.stringify({
          version: 2,
          requirements: [],
          stages: [{ id: "implementing", label: "Implement", required: true }],
          execution: { checkpoints: [] },
          completion: { requiredStages: ["implementing"] },
        }),
        now,
        now,
      ).run();
      await db.prepare(
        `insert into briar_project_settings (
           project_id, github_repository, workflow_json,
           mandatory_checkpoints_json,
           created_at, updated_at
         ) values (?, 'wordbricks/transfer-target', ?, '[]', ?, ?)`,
      ).bind(
        targetProjectId,
        JSON.stringify({
          version: 2,
          requirements: [],
          stages: [
            { id: "planning", label: "Plan", required: true },
            { id: "implementing", label: "Implement", required: true },
          ],
          execution: { checkpoints: [] },
          completion: { requiredStages: ["planning", "implementing"] },
        }),
        now,
        now,
      ).run();
      await createChannel(db, {
        id: channelId,
        organizationId,
        slug: "upgrade",
        name: "Upgrade",
        topic: null,
        visibility: "public",
        defaultProjectId: projectId,
        createdByUserId: userId,
        createdAt: now,
      });
      await createOrganizationAgent(db, {
        id: agentId,
        organizationId,
        name: "Upgrade Agent",
        provider: "codex",
        model: null,
        responsibility: "Propose issues.",
        effort: null,
        createdAt: now,
      });

      const seedProposal = async (
        suffix: string,
        status: "pending" | "accepted" = "pending",
      ) => {
        const triggerId = `95000000-0000-4000-8000-${suffix}`;
        const replyId = `96000000-0000-4000-8000-${suffix}`;
        const proposalId = `97000000-0000-4000-8000-${suffix}`;
        await createPreWebhookChannelMessage(db, {
          id: triggerId,
          channelId,
          parentMessageId: null,
          authorUserId: userId,
          authorAgentId: null,
          authorAgentName: null,
          authorAgentProvider: null,
          body: `Create ${suffix}`,
          mentionedUserIds: [],
          mentionedAgentIds: [agentId],
          createdAt: now,
        });
        await createPreWebhookChannelMessage(db, {
          id: replyId,
          channelId,
          parentMessageId: triggerId,
          authorUserId: null,
          authorAgentId: agentId,
          authorAgentName: "Upgrade Agent",
          authorAgentProvider: "codex",
          body: `Proposal ${suffix}`,
          mentionedUserIds: [],
          mentionedAgentIds: [],
          createdAt: now,
        });
        await db.prepare(
          `insert into briar_channel_action_proposals (
             id, channel_id, project_id, trigger_message_id, reply_message_id,
             action_type, payload_json, status, accepted_by_user_id,
             accepted_at, created_at, updated_at
           ) values (?, ?, ?, ?, ?, 'request_issue_create', ?, ?, ?, ?, ?, ?)`,
        ).bind(
          proposalId,
          channelId,
          projectId,
          triggerId,
          replyId,
          JSON.stringify({
            issue: {
              title: `Upgrade ${suffix}`,
              description: null,
              priority: 2,
              status: "backlog",
            },
          }),
          status,
          status === "accepted" ? approverId : null,
          status === "accepted" ? now : null,
          now,
          now,
        ).run();
        return proposalId;
      };
      const legacyRun = (
        proposalId: string,
        title: string,
        canonical = true,
      ) => {
        const sourceKey = `briar-channel-proposal:${proposalId}`;
        return recordHuntEvent(db, projectId, {
          source: "issue",
          sourceKey,
          title,
          stage: "queued",
          status: "backlog",
          workflowStage: null,
          eventKey: `${sourceKey}:backlog:intake`,
          occurredAt: now,
          actor: canonical ? "briar-channel" : "legacy-worker",
          repository: "Upgrade Project",
          detail: null,
          priority: 2,
          branch: null,
          commitSha: null,
          tracker: null,
          issueDescription: null,
          resultSummary: null,
          structuredResult: null,
          pullRequestUrls: [],
          targetSha: null,
          sourceCreatedAt: now,
          qaStatus: null,
          stagingQaDetail: null,
          productionQaDetail: null,
          context: {
            origin: "briar-channel",
            proposalId,
            channelId,
            issueId: proposalId,
            attachmentCount: 0,
            fullAuto: false,
          },
        });
      };

      const acceptedId = await seedProposal("000000000001");
      const acceptedRunId = await legacyRun(acceptedId, "Upgrade 000000000001");
      await db.prepare(
        `update briar_channel_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = ?, updated_at = ? where id = ?`,
      ).bind(approverId, now, acceptedRunId, now, acceptedId).run();
      // A canonical-looking legacy backlog row still has a predictable source
      // identity. Without durable dispatch evidence, execution metadata could
      // have been supplied by a caller that preempted the old create-before-CAS
      // flow and must not survive as an authorized result.
      await db.prepare(
        `update briar_hunt_runs
         set repository = 'attacker/poisoned-channel-repository',
             branch = 'agent-controlled-channel-branch'
         where id = ?`,
      ).bind(acceptedRunId).run();

      const dispatchedId = await seedProposal("000000000005");
      const dispatchedRunId = await legacyRun(
        dispatchedId,
        "Upgrade 000000000005",
      );
      await db.prepare(
        `update briar_channel_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = ?, updated_at = ? where id = ?`,
      ).bind(approverId, now, dispatchedRunId, now, dispatchedId).run();
      const dispatchedAt = "2026-08-10T00:00:30.000Z";
      await db.prepare(
        `update briar_hunt_runs
         set status = 'queued', stage = 'queued', workflow_stage = null,
             requested_agent_provider = 'codex', requested_by_user_id = ?,
             dispatch_mode = 'any', dispatch_request_id = ?,
             dispatched_at = ?, last_event_at = ?, updated_at = ?
         where id = ?`,
      ).bind(
        approverId,
        `dispatch:${dispatchedId}`,
        dispatchedAt,
        dispatchedAt,
        dispatchedAt,
        dispatchedRunId,
      ).run();
      await db.prepare(
        `insert into briar_execution_audit_events (
           id, organization_id, project_id, run_id, worker_id, agent_id,
           actor_user_id, actor_device_id, action, request_id, detail_json,
           occurred_at
         ) values (?, ?, ?, ?, null, null, ?, null, 'dispatched', ?, '{}', ?)`,
      ).bind(
        `audit:${dispatchedId}`,
        organizationId,
        projectId,
        dispatchedRunId,
        approverId,
        `dispatch:${dispatchedId}`,
        dispatchedAt,
      ).run();
      await db.prepare(
        `update briar_hunt_runs
         set title = 'User-edited dispatched issue', context_json = '{}',
             preferred_agent_provider = 'claude',
             preferred_agent_model = 'claude-opus-4-1',
             preferred_agent_effort = 'high'
         where id = ?`,
      ).bind(dispatchedRunId).run();

      const poisonedId = await seedProposal("000000000006");
      const poisonedRunId = await legacyRun(
        poisonedId,
        "Upgrade 000000000006",
        false,
      );
      await db.prepare(
        `update briar_channel_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = ?, updated_at = ? where id = ?`,
      ).bind(approverId, now, poisonedRunId, now, poisonedId).run();
      await db.prepare(
        `update briar_hunt_runs
         set status = 'running', stage = 'implementing',
             workflow_stage = 'implementing', updated_at = ?
         where id = ?`,
      ).bind("2026-08-10T00:00:20.000Z", poisonedRunId).run();

      const transferId = await seedProposal("000000000009");
      const transferRunId = await legacyRun(
        transferId,
        "Upgrade 000000000009",
      );
      await db.prepare(
        `update briar_channel_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = ?, updated_at = ? where id = ?`,
      ).bind(approverId, now, transferRunId, now, transferId).run();
      const transferDispatchedAt = "2026-08-10T00:00:40.000Z";
      await db.prepare(
        `update briar_hunt_runs
         set status = 'queued', stage = 'queued', workflow_stage = null,
             requested_agent_provider = 'codex', requested_by_user_id = ?,
             dispatch_mode = 'any', dispatch_request_id = ?,
             dispatched_at = ?, last_event_at = ?, updated_at = ?
         where id = ?`,
      ).bind(
        approverId,
        `dispatch:${transferId}`,
        transferDispatchedAt,
        transferDispatchedAt,
        transferDispatchedAt,
        transferRunId,
      ).run();
      await db.prepare(
        `insert into briar_execution_audit_events (
           id, organization_id, project_id, run_id, worker_id, agent_id,
           actor_user_id, actor_device_id, action, request_id, detail_json,
           occurred_at
         ) values (?, ?, ?, ?, null, null, ?, null, 'dispatched', ?, '{}', ?)`,
      ).bind(
        `audit:${transferId}`,
        organizationId,
        projectId,
        transferRunId,
        approverId,
        `dispatch:${transferId}`,
        transferDispatchedAt,
      ).run();

      const prematurelyMovedId = await seedProposal("000000000010");
      const prematurelyMovedRunId = await legacyRun(
        prematurelyMovedId,
        "Upgrade 000000000010",
      );
      await db.prepare(
        `update briar_channel_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = ?, updated_at = ? where id = ?`,
      ).bind(
        approverId,
        now,
        prematurelyMovedRunId,
        now,
        prematurelyMovedId,
      ).run();
      const prematurelyMovedAt = "2026-08-10T00:00:50.000Z";
      await db.prepare(
        `update briar_hunt_runs
         set status = 'queued', stage = 'queued', workflow_stage = null,
             requested_agent_provider = 'codex', requested_by_user_id = ?,
             dispatch_mode = 'any', dispatch_request_id = ?,
             dispatched_at = ?, last_event_at = ?, updated_at = ?
         where id = ?`,
      ).bind(
        approverId,
        `dispatch:${prematurelyMovedId}`,
        prematurelyMovedAt,
        prematurelyMovedAt,
        prematurelyMovedAt,
        prematurelyMovedRunId,
      ).run();
      await db.prepare(
        `insert into briar_execution_audit_events (
           id, organization_id, project_id, run_id, worker_id, agent_id,
           actor_user_id, actor_device_id, action, request_id, detail_json,
           occurred_at
         ) values (?, ?, ?, ?, null, null, ?, null, 'dispatched', ?, '{}', ?)`,
      ).bind(
        `audit:${prematurelyMovedId}`,
        organizationId,
        projectId,
        prematurelyMovedRunId,
        approverId,
        `dispatch:${prematurelyMovedId}`,
        prematurelyMovedAt,
      ).run();
      const strandedAttachmentId = "98000000-0000-4000-8000-000000000010";
      const strandedMessageId = "99000000-0000-4000-8000-000000000010";
      const strandedEvidenceId = "9a000000-0000-4000-8000-000000000010";
      const strandedEvidenceImageId =
        "9b000000-0000-4000-8000-000000000010";
      const strandedTranscriptSessionId =
        "legacy-transfer-transcript-000000000010";
      await createIssueAttachments(db, projectId, prematurelyMovedRunId, [{
        id: strandedAttachmentId,
        object_key: "issue-attachments/premature-transfer/stranded.png",
        filename: "stranded.png",
        content_type: "image/png",
        byte_size: 8,
      }]);
      await createIssueMessage(db, {
        id: strandedMessageId,
        projectId,
        runId: prematurelyMovedRunId,
        parentMessageId: null,
        authorUserId: approverId,
        authorAgentProvider: null,
        body: "Repair this stranded relation",
        createdAt: prematurelyMovedAt,
      });
      await db.prepare(
        `insert into briar_run_evidence (
           id, project_id, run_id, attempt, revision, evidence_key,
           workflow_stage, evidence_type, status, detail, command, url,
           metadata_json, actor, observed_at, recorded_at
         ) values (?, ?, ?, 1, 1, 'legacy-transfer:evidence',
                   'implementing', 'diff', 'passed', 'Verified transfer',
                   null, null, '{}', 'legacy-worker', ?, ?)`,
      ).bind(
        strandedEvidenceId,
        projectId,
        prematurelyMovedRunId,
        prematurelyMovedAt,
        prematurelyMovedAt,
      ).run();
      await db.prepare(
        `insert into briar_run_evidence_images (
           id, project_id, run_id, evidence_id, object_key, filename,
           content_type, byte_size, sha256, position, created_at
         ) values (?, ?, ?, ?, ?, 'legacy-transfer.png', 'image/png', 8, ?, 0, ?)`,
      ).bind(
        strandedEvidenceImageId,
        projectId,
        prematurelyMovedRunId,
        strandedEvidenceId,
        `run-evidence/${projectId}/${prematurelyMovedRunId}/${strandedEvidenceImageId}`,
        "d".repeat(64),
        prematurelyMovedAt,
      ).run();
      await db.prepare(
        `insert into briar_agent_transcript_sessions (
           session_id, project_id, run_id, worker_id, agent_provider,
           started_at, last_event_at, event_count, byte_count
         ) values (?, ?, ?, null, 'codex', ?, ?, 1, 16)`,
      ).bind(
        strandedTranscriptSessionId,
        projectId,
        prematurelyMovedRunId,
        prematurelyMovedAt,
        prematurelyMovedAt,
      ).run();
      await db.prepare(
        `insert into briar_agent_transcripts (
           session_id, sequence, direction, payload_json, recorded_at
         ) values (?, 1, 'server', '{"legacy":true}', ?)`,
      ).bind(strandedTranscriptSessionId, prematurelyMovedAt).run();
      // Reproduce the pre-0090 transfer shape: execution identity was cleared,
      // but the issue remained queued in a project that never approved it.
      await db.prepare(
        `update briar_hunt_runs
         set project_id = ?, agent_id = null, worker_id = null,
             requested_worker_id = null, claim_token_hash = null,
             claimed_by = null, claimed_at = null, lease_expires_at = null,
             last_execution_id = null, dispatch_mode = null,
             dispatch_request_id = null, dispatched_at = null,
             requested_by_user_id = null, requested_agent_provider = null,
             requested_agent_model = null, requested_agent_effort = null
         where id = ?`,
      ).bind(targetProjectId, prematurelyMovedRunId).run();
      // A multi-hop run may have an older audit in the current project. It is
      // not valid unless it matches the run's current dispatch identity.
      await db.prepare(
        `insert into briar_execution_audit_events (
           id, organization_id, project_id, run_id, worker_id, agent_id,
           actor_user_id, actor_device_id, action, request_id, detail_json,
           occurred_at
         ) values (?, ?, ?, ?, null, null, ?, null, 'dispatched', ?, '{}', ?)`,
      ).bind(
        `historical-target-audit:${prematurelyMovedId}`,
        organizationId,
        targetProjectId,
        prematurelyMovedRunId,
        approverId,
        `historical-target-dispatch:${prematurelyMovedId}`,
        "2026-08-10T00:00:45.000Z",
      ).run();
      const prematurelyMovedExecutableRuns: Array<{ runId: string }> = [];
      let prematurelyMovedCompletedRunId = "";
      for (const [suffix, status, paused] of [
        ["000000000013", "blocked", false],
        ["000000000014", "failed", false],
        ["000000000015", "running", false],
        ["000000000016", "running", true],
        ["000000000017", "completed", false],
      ] as const) {
        const proposalId = await seedProposal(suffix);
        const runId = await legacyRun(
          proposalId,
          `Prematurely moved ${status} issue`,
        );
        await db.prepare(
          `update briar_channel_action_proposals
           set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
               result_run_id = ?, updated_at = ? where id = ?`,
        ).bind(approverId, now, runId, now, proposalId).run();
        const dispatchRequestId = `dispatch:${proposalId}`;
        await db.prepare(
          `update briar_hunt_runs
           set status = ?, stage = ?, workflow_stage = ?, paused_at = ?,
               completed_at = ?,
               requested_agent_provider = 'codex', requested_by_user_id = ?,
               dispatch_mode = 'any', dispatch_request_id = ?,
               dispatched_at = ?, last_event_at = ?, updated_at = ?
           where id = ?`,
        ).bind(
          status,
          status === "running" ? "implementing" : status,
          status === "running" ? "implementing" : null,
          paused ? prematurelyMovedAt : null,
          status === "completed" ? prematurelyMovedAt : null,
          approverId,
          dispatchRequestId,
          prematurelyMovedAt,
          prematurelyMovedAt,
          prematurelyMovedAt,
          runId,
        ).run();
        await db.prepare(
          `insert into briar_execution_audit_events (
             id, organization_id, project_id, run_id, worker_id, agent_id,
             actor_user_id, actor_device_id, action, request_id, detail_json,
             occurred_at
           ) values (?, ?, ?, ?, null, null, ?, null, 'dispatched', ?, '{}', ?)`,
        ).bind(
          `audit:${proposalId}`,
          organizationId,
          projectId,
          runId,
          approverId,
          dispatchRequestId,
          prematurelyMovedAt,
        ).run();
        await db.prepare(
          `update briar_hunt_runs
           set project_id = ?, agent_id = null, worker_id = null,
               requested_worker_id = null, claim_token_hash = null,
               claimed_by = null, claimed_at = null, lease_expires_at = null,
               last_execution_id = null, dispatch_mode = null,
               dispatch_request_id = null, dispatched_at = null,
               requested_by_user_id = null, requested_agent_provider = null,
               requested_agent_model = null, requested_agent_effort = null
           where id = ?`,
        ).bind(targetProjectId, runId).run();
        if (status === "completed") {
          prematurelyMovedCompletedRunId = runId;
        } else {
          prematurelyMovedExecutableRuns.push({ runId });
        }
      }
      const unconfiguredProposalId = await seedProposal("000000000018");
      const unconfiguredTransferRunId = await legacyRun(
        unconfiguredProposalId,
        "Prematurely moved into an unconfigured project",
      );
      await db.prepare(
        `update briar_channel_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = ?, updated_at = ? where id = ?`,
      ).bind(
        approverId,
        now,
        unconfiguredTransferRunId,
        now,
        unconfiguredProposalId,
      ).run();
      const unconfiguredDispatchId = `dispatch:${unconfiguredProposalId}`;
      await db.prepare(
        `update briar_hunt_runs
         set status = 'queued', stage = 'queued', workflow_stage = null,
             requested_agent_provider = 'codex', requested_by_user_id = ?,
             dispatch_mode = 'any', dispatch_request_id = ?,
             dispatched_at = ?, last_event_at = ?, updated_at = ?
         where id = ?`,
      ).bind(
        approverId,
        unconfiguredDispatchId,
        prematurelyMovedAt,
        prematurelyMovedAt,
        prematurelyMovedAt,
        unconfiguredTransferRunId,
      ).run();
      await db.prepare(
        `insert into briar_execution_audit_events (
           id, organization_id, project_id, run_id, worker_id, agent_id,
           actor_user_id, actor_device_id, action, request_id, detail_json,
           occurred_at
         ) values (?, ?, ?, ?, null, null, ?, null, 'dispatched', ?, '{}', ?)`,
      ).bind(
        `audit:${unconfiguredProposalId}`,
        organizationId,
        projectId,
        unconfiguredTransferRunId,
        approverId,
        unconfiguredDispatchId,
        prematurelyMovedAt,
      ).run();
      await db.prepare(
        `update briar_hunt_runs
         set project_id = ?, agent_id = null, worker_id = null,
             requested_worker_id = null, claim_token_hash = null,
             claimed_by = null, claimed_at = null, lease_expires_at = null,
             last_execution_id = null, dispatch_mode = null,
             dispatch_request_id = null, dispatched_at = null,
             requested_by_user_id = null, requested_agent_provider = null,
             requested_agent_model = null, requested_agent_effort = null
         where id = ?`,
      ).bind(unconfiguredTargetProjectId, unconfiguredTransferRunId).run();
      const orphanProposalId = "97000000-0000-4000-8000-000000000011";
      const orphanRunId = await legacyRun(
        orphanProposalId,
        "Orphaned deleted channel proposal",
      );
      const fallbackTransferId = await seedProposal("000000000012");
      const fallbackTransferRunId = await legacyRun(
        fallbackTransferId,
        "Pre-migration fallback transfer",
      );
      await db.prepare(
        `update briar_channel_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = ?, updated_at = ? where id = ?`,
      ).bind(
        approverId,
        now,
        fallbackTransferRunId,
        now,
        fallbackTransferId,
      ).run();
      const fallbackDispatchedAt = "2026-08-10T00:00:55.000Z";
      await db.prepare(
        `update briar_hunt_runs
         set status = 'queued', stage = 'queued', workflow_stage = null,
             requested_agent_provider = 'codex', requested_by_user_id = ?,
             dispatch_mode = 'any', dispatch_request_id = ?,
             dispatched_at = ?, last_event_at = ?, updated_at = ?
         where id = ?`,
      ).bind(
        approverId,
        `dispatch:${fallbackTransferId}`,
        fallbackDispatchedAt,
        fallbackDispatchedAt,
        fallbackDispatchedAt,
        fallbackTransferRunId,
      ).run();
      await db.prepare(
        `insert into briar_execution_audit_events (
           id, organization_id, project_id, run_id, worker_id, agent_id,
           actor_user_id, actor_device_id, action, request_id, detail_json,
           occurred_at
         ) values (?, ?, ?, ?, null, null, ?, null, 'dispatched', ?, '{}', ?)`,
      ).bind(
        `audit:${fallbackTransferId}`,
        organizationId,
        projectId,
        fallbackTransferRunId,
        approverId,
        `dispatch:${fallbackTransferId}`,
        fallbackDispatchedAt,
      ).run();
      await expect(transferIssue(db, {
        sourceProjectId: projectId,
        targetProjectId,
        targetProjectName: "Transfer Target",
        runId: fallbackTransferRunId,
        observedAt: "2026-08-10T00:00:56.000Z",
      })).resolves.toBe("transferred");
      await expect(db.prepare(
        `select project_id, status, dispatch_request_id
         from briar_hunt_runs where id = ?`,
      ).bind(fallbackTransferRunId).first()).resolves.toEqual({
        project_id: targetProjectId,
        status: "backlog",
        dispatch_request_id: null,
      });
      const preemptedId = await seedProposal("000000000008");
      const preemptedRunId = await legacyRun(
        preemptedId,
        "Upgrade 000000000008",
        false,
      );
      await db.prepare(
        `update briar_channel_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = ?, updated_at = ? where id = ?`,
      ).bind(approverId, now, preemptedRunId, now, preemptedId).run();
      const pendingId = await seedProposal("000000000002");
      const pendingRunId = await legacyRun(pendingId, "Upgrade 000000000002");
      const missingResultId = await seedProposal("000000000003", "accepted");
      const planProposalId = await seedProposal("000000000007");
      await db.prepare(
        `update briar_channel_action_proposals
         set action_type = 'request_plan_document' where id = ?`,
      ).bind(planProposalId).run();

      const conversationSourceKey = "legacy-conversation-thread";
      const conversationRunId = await recordHuntEvent(db, projectId, {
        source: "issue",
        sourceKey: conversationSourceKey,
        title: "Legacy conversation",
        stage: "queued",
        status: "backlog",
        workflowStage: null,
        eventKey: `${conversationSourceKey}:backlog`,
        occurredAt: now,
        actor: "user",
        repository: "Upgrade Project",
        detail: null,
        priority: null,
        branch: null,
        commitSha: null,
        tracker: null,
        issueDescription: null,
        resultSummary: null,
        structuredResult: null,
        pullRequestUrls: [],
        targetSha: null,
        sourceCreatedAt: now,
        qaStatus: null,
        stagingQaDetail: null,
        productionQaDetail: null,
        context: null,
      });
      const conversationProposalId =
        "9c000000-0000-4000-8000-000000000001";
      await db.prepare(
        `insert into briar_issue_action_proposals (
           id, project_id, conversation_run_id, trigger_message_id,
           reply_message_id, action_type, payload_json, status,
           created_at, updated_at
         ) values (?, ?, ?, ?, ?, 'request_issue_create', ?, 'pending', ?, ?)`,
      ).bind(
        conversationProposalId,
        projectId,
        conversationRunId,
        "9d000000-0000-4000-8000-000000000001",
        "9e000000-0000-4000-8000-000000000001",
        JSON.stringify({
          issue: {
            title: "Approved conversation follow-up",
            description: "Expected body",
            priority: 2,
            status: "backlog",
          },
        }),
        now,
        now,
      ).run();
      const poisonedConversationSourceKey =
        `briar-conversation-proposal:${conversationProposalId}`;
      const poisonedConversationRunId = await recordHuntEvent(
        db,
        projectId,
        {
          source: "issue",
          sourceKey: poisonedConversationSourceKey,
          title: "Agent-substituted title",
          stage: "queued",
          status: "backlog",
          workflowStage: null,
          eventKey: `${poisonedConversationSourceKey}:backlog`,
          occurredAt: now,
          actor: "project-agent",
          repository: "Upgrade Project",
          detail: null,
          priority: 1,
          issueCheckpoints: [],
          fullAuto: true,
          branch: null,
          commitSha: null,
          tracker: null,
          issueDescription: "Agent-substituted body",
          resultSummary: null,
          structuredResult: null,
          pullRequestUrls: [],
          targetSha: null,
          sourceCreatedAt: now,
          qaStatus: null,
          stagingQaDetail: null,
          productionQaDetail: null,
          context: {
            origin: "project-agent",
            proposalId: conversationProposalId,
            fullAuto: true,
          },
        },
      );

      const neverDispatchedConversationProposalId =
        "9c000000-0000-4000-8000-000000000002";
      await db.prepare(
        `insert into briar_issue_action_proposals (
           id, project_id, conversation_run_id, trigger_message_id,
           reply_message_id, action_type, payload_json, status,
           created_at, updated_at
         ) values (?, ?, ?, ?, ?, 'request_issue_create', ?, 'pending', ?, ?)`,
      ).bind(
        neverDispatchedConversationProposalId,
        projectId,
        conversationRunId,
        "9d000000-0000-4000-8000-000000000002",
        "9e000000-0000-4000-8000-000000000002",
        JSON.stringify({
          issue: {
            title: "Legacy accepted conversation issue",
            description: "Approved text with poisoned execution metadata",
            priority: 2,
            status: "backlog",
          },
        }),
        now,
        now,
      ).run();
      const neverDispatchedConversationSourceKey =
        `briar-conversation-proposal:${neverDispatchedConversationProposalId}`;
      const neverDispatchedConversationRunId = await recordHuntEvent(
        db,
        projectId,
        {
          source: "issue",
          sourceKey: neverDispatchedConversationSourceKey,
          title: "Legacy accepted conversation issue",
          stage: "queued",
          status: "backlog",
          workflowStage: null,
          eventKey: `${neverDispatchedConversationSourceKey}:backlog`,
          occurredAt: now,
          actor: "project-agent",
          repository: "attacker/poisoned-repository",
          detail: null,
          priority: 2,
          issueCheckpoints: [],
          fullAuto: false,
          branch: "agent-controlled-branch",
          commitSha: null,
          tracker: null,
          issueDescription: "Approved text with poisoned execution metadata",
          resultSummary: null,
          structuredResult: null,
          pullRequestUrls: [],
          targetSha: null,
          sourceCreatedAt: now,
          qaStatus: null,
          stagingQaDetail: null,
          productionQaDetail: null,
          context: {
            origin: "briar-conversation",
            proposalId: neverDispatchedConversationProposalId,
            conversationRunId,
            issueId: neverDispatchedConversationProposalId,
            attachmentCount: 0,
            fullAuto: false,
          },
        },
      );
      await db.prepare(
        `update briar_issue_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = ?, updated_at = ? where id = ?`,
      ).bind(
        approverId,
        now,
        neverDispatchedConversationRunId,
        now,
        neverDispatchedConversationProposalId,
      ).run();

      const dispatchedConversationProposalId =
        "9c000000-0000-4000-8000-000000000003";
      await db.prepare(
        `insert into briar_issue_action_proposals (
           id, project_id, conversation_run_id, trigger_message_id,
           reply_message_id, action_type, payload_json, status,
           created_at, updated_at
         ) values (?, ?, ?, ?, ?, 'request_issue_create', ?, 'pending', ?, ?)`,
      ).bind(
        dispatchedConversationProposalId,
        projectId,
        conversationRunId,
        "9d000000-0000-4000-8000-000000000003",
        "9e000000-0000-4000-8000-000000000003",
        JSON.stringify({
          issue: {
            title: "Dispatched legacy conversation issue",
            description: "A member separately approved execution.",
            priority: 2,
            status: "backlog",
          },
        }),
        now,
        now,
      ).run();
      const dispatchedConversationSourceKey =
        `briar-conversation-proposal:${dispatchedConversationProposalId}`;
      const dispatchedConversationRunId = await recordHuntEvent(
        db,
        projectId,
        {
          source: "issue",
          sourceKey: dispatchedConversationSourceKey,
          title: "Dispatched legacy conversation issue",
          stage: "queued",
          status: "backlog",
          workflowStage: null,
          eventKey: `${dispatchedConversationSourceKey}:backlog`,
          occurredAt: now,
          actor: "briar-conversation",
          repository: "Upgrade Project",
          detail: null,
          priority: 2,
          issueCheckpoints: [],
          fullAuto: false,
          branch: null,
          commitSha: null,
          tracker: null,
          issueDescription: "A member separately approved execution.",
          resultSummary: null,
          structuredResult: null,
          pullRequestUrls: [],
          targetSha: null,
          sourceCreatedAt: now,
          qaStatus: null,
          stagingQaDetail: null,
          productionQaDetail: null,
          context: {
            origin: "briar-conversation",
            proposalId: dispatchedConversationProposalId,
            conversationRunId,
            issueId: dispatchedConversationProposalId,
            attachmentCount: 0,
            fullAuto: false,
          },
        },
      );
      await db.prepare(
        `update briar_issue_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = ?, updated_at = ? where id = ?`,
      ).bind(
        approverId,
        now,
        dispatchedConversationRunId,
        now,
        dispatchedConversationProposalId,
      ).run();
      const dispatchedConversationAt = "2026-08-10T00:00:50.000Z";
      await db.prepare(
        `update briar_hunt_runs
         set status = 'completed', stage = 'completed', workflow_stage = null,
             requested_agent_provider = 'codex', requested_by_user_id = ?,
             dispatch_mode = 'any', dispatch_request_id = ?,
             dispatched_at = ?, completed_at = ?, last_event_at = ?, updated_at = ?
         where id = ?`,
      ).bind(
        approverId,
        `dispatch:${dispatchedConversationProposalId}`,
        dispatchedConversationAt,
        dispatchedConversationAt,
        dispatchedConversationAt,
        dispatchedConversationAt,
        dispatchedConversationRunId,
      ).run();
      await db.prepare(
        `insert into briar_execution_audit_events (
           id, organization_id, project_id, run_id, worker_id, agent_id,
           actor_user_id, actor_device_id, action, request_id, detail_json,
           occurred_at
         ) values (?, ?, ?, ?, null, null, ?, null, 'dispatched', ?, '{}', ?)`,
      ).bind(
        `audit:${dispatchedConversationProposalId}`,
        organizationId,
        projectId,
        dispatchedConversationRunId,
        approverId,
        `dispatch:${dispatchedConversationProposalId}`,
        dispatchedConversationAt,
      ).run();

      const beforeApprovalUpgradeCursor = await db.prepare(
        `select current_version from briar_channel_sync_state
         where organization_id = ?`,
      ).bind(organizationId).first<{ current_version: number }>();

      await expect(channelApprovalTablesAvailable(db)).resolves.toBe(false);
      await applyD1Migrations(db, { files: ["0090_channel_issue_approval.sql"] });
      await expect(channelApprovalTablesAvailable(db)).resolves.toBe(true);

      await expect(db.prepare(
        `select status, result_run_id, issue_source_key,
                approval_reserved_by_user_id
         from briar_issue_action_proposals where id = ?`,
      ).bind(conversationProposalId).first()).resolves.toEqual({
        status: "pending",
        result_run_id: null,
        issue_source_key: null,
        approval_reserved_by_user_id: null,
      });
      await expect(db.prepare(
        `select status, stage from briar_hunt_runs where id = ?`,
      ).bind(poisonedConversationRunId).first()).resolves.toEqual({
        status: "cancelled",
        stage: "cancelled",
      });
      await expect(db.prepare(
        `select reason from briar_conversation_issue_approval_quarantine
         where result_run_id = ?`,
      ).bind(poisonedConversationRunId).first()).resolves.toEqual({
        reason: "unfinalized_legacy_issue",
      });
      await expect(db.prepare(
        `update briar_hunt_runs
         set status = 'queued', stage = 'queued' where id = ?`,
      ).bind(poisonedConversationRunId).run()).rejects.toThrow(
        "reconciled channel proposal issue is quarantined",
      );

      await expect(db.prepare(
        `select status, result_run_id, issue_source_key,
                approval_reserved_by_user_id
         from briar_issue_action_proposals where id = ?`,
      ).bind(neverDispatchedConversationProposalId).first()).resolves.toEqual({
        status: "pending",
        result_run_id: null,
        issue_source_key: null,
        approval_reserved_by_user_id: null,
      });
      await expect(db.prepare(
        `select result_verification from briar_channel_issue_approval_audit
         where proposal_id = ? and channel_id = ?`,
      ).bind(
        neverDispatchedConversationProposalId,
        `conversation:${conversationRunId}`,
      ).first()).resolves.toEqual({ result_verification: "unverifiable" });
      await expect(db.prepare(
        `select reason from briar_conversation_issue_approval_quarantine
         where result_run_id = ?`,
      ).bind(neverDispatchedConversationRunId).first()).resolves.toEqual({
        reason: "unverifiable_legacy_result",
      });
      await expect(db.prepare(
        `select status, stage, repository, branch
         from briar_hunt_runs where id = ?`,
      ).bind(neverDispatchedConversationRunId).first()).resolves.toEqual({
        status: "cancelled",
        stage: "cancelled",
        repository: "attacker/poisoned-repository",
        branch: "agent-controlled-branch",
      });
      await expect(db.prepare(
        `update briar_hunt_runs
         set status = 'queued', stage = 'queued', completed_at = null
         where id = ?`,
      ).bind(neverDispatchedConversationRunId).run()).rejects.toThrow(
        "reconciled channel proposal issue is quarantined",
      );

      await expect(db.prepare(
        `select status, result_run_id, issue_source_key
         from briar_issue_action_proposals where id = ?`,
      ).bind(dispatchedConversationProposalId).first()).resolves.toEqual({
        status: "accepted",
        result_run_id: dispatchedConversationRunId,
        issue_source_key: dispatchedConversationSourceKey,
      });
      await expect(db.prepare(
        `select result_verification from briar_channel_issue_approval_audit
         where proposal_id = ? and channel_id = ?`,
      ).bind(
        dispatchedConversationProposalId,
        `conversation:${conversationRunId}`,
      ).first()).resolves.toEqual({ result_verification: "legacy_authorized" });
      await expect(db.prepare(
        `select reason from briar_conversation_issue_approval_quarantine
         where result_run_id = ?`,
      ).bind(dispatchedConversationRunId).first()).resolves.toBeNull();
      await expect(db.prepare(
        `select status, stage, dispatch_request_id,
                preferred_agent_provider
         from briar_hunt_runs where id = ?`,
      ).bind(dispatchedConversationRunId).first()).resolves.toEqual({
        status: "completed",
        stage: "completed",
        dispatch_request_id: `dispatch:${dispatchedConversationProposalId}`,
        preferred_agent_provider: "codex",
      });
      await expect(db.prepare(
        `update briar_hunt_runs
         set status = 'queued', stage = 'queued', completed_at = null
         where id = ?`,
      ).bind(dispatchedConversationRunId).run()).rejects.toThrow(
        "approved issue terminal reactivation requires fresh execution approval",
      );

      await expect(db.prepare(
        `select project_id, status, dispatch_request_id, claim_token_hash
         from briar_hunt_runs where id = ?`,
      ).bind(prematurelyMovedRunId).first()).resolves.toEqual({
        project_id: targetProjectId,
        status: "backlog",
        dispatch_request_id: null,
        claim_token_hash: null,
      });
      await expect(getIssueAttachment(
        db,
        projectId,
        prematurelyMovedRunId,
        strandedAttachmentId,
      )).resolves.toBeNull();
      await expect(getRunEvidenceImage(
        db,
        projectId,
        prematurelyMovedRunId,
        strandedEvidenceImageId,
      )).resolves.toBeNull();
      await expect(getRunEvidenceImage(
        db,
        targetProjectId,
        prematurelyMovedRunId,
        strandedEvidenceImageId,
      )).resolves.toMatchObject({
        id: strandedEvidenceImageId,
        project_id: targetProjectId,
      });
      await expect(db.prepare(
        `select project_id, run_id
         from briar_agent_transcript_sessions
         where session_id = ?`,
      ).bind(
        strandedTranscriptSessionId,
      ).first()).resolves.toEqual({
        project_id: projectId,
        run_id: prematurelyMovedRunId,
      });
      await expect(db.prepare(
        `select entity_kind, source_project_id, target_project_id
         from briar_channel_issue_transfer_quarantine where entity_id = ?`,
      ).bind(strandedTranscriptSessionId).first()).resolves.toEqual({
        entity_kind: "agent_transcript_session",
        source_project_id: projectId,
        target_project_id: targetProjectId,
      });
      const unconfiguredTransfer = await db.prepare(
        `select project_id, repository, status, workflow_snapshot_json
         from briar_hunt_runs where id = ?`,
      ).bind(unconfiguredTransferRunId).first<{
        project_id: string;
        repository: string;
        status: string;
        workflow_snapshot_json: string;
      }>();
      expect(unconfiguredTransfer).toMatchObject({
        project_id: unconfiguredTargetProjectId,
        repository: "Unconfigured Transfer Target",
        status: "backlog",
      });
      expect(JSON.parse(unconfiguredTransfer!.workflow_snapshot_json)).toEqual({
        version: 2,
        requirements: [],
        stages: [{
          id: "repository_workflow_pending",
          label: "Repository workflow pending",
          required: true,
        }],
        execution: {
          checkpoints: [{
            key: "project-after-repository_workflow_pending",
            stage: "repository_workflow_pending",
            position: "after",
          }],
        },
        completion: { requiredStages: ["repository_workflow_pending"] },
      });
      await expect(transferIssue(db, {
        sourceProjectId: projectId,
        targetProjectId,
        targetProjectName: "Transfer Target",
        runId: prematurelyMovedRunId,
        observedAt: "2026-08-10T00:01:10.000Z",
      })).resolves.toBe("transferred");
      await expect(db.prepare(
        `select project_id from briar_issue_attachments where id = ?`,
      ).bind(strandedAttachmentId).first()).resolves.toEqual({
        project_id: targetProjectId,
      });
      await expect(db.prepare(
        `select project_id from briar_issue_messages where id = ?`,
      ).bind(strandedMessageId).first()).resolves.toEqual({
        project_id: targetProjectId,
      });
      await expect(db.prepare(
        `select project_id from briar_agent_transcript_sessions
         where session_id = ?`,
      ).bind(strandedTranscriptSessionId).first()).resolves.toEqual({
        project_id: projectId,
      });
      await expect(db.prepare(
        `select count(*) as count from briar_dashboard_changes
         where project_id = ? and entity_type = 'run' and entity_id = ?
           and operation = 'delete'`,
      ).bind(projectId, prematurelyMovedRunId).first()).resolves.toMatchObject({
        count: 1,
      });
      for (const { runId } of prematurelyMovedExecutableRuns) {
        await expect(db.prepare(
          `select project_id, repository, status, stage, workflow_stage,
                  workflow_snapshot_json, issue_checkpoints_json,
                  dispatch_request_id, claim_token_hash, paused_at
           from briar_hunt_runs where id = ?`,
        ).bind(runId).first()).resolves.toMatchObject({
          project_id: targetProjectId,
          repository: "wordbricks/transfer-target",
          status: "backlog",
          stage: "queued",
          workflow_stage: null,
          dispatch_request_id: null,
          claim_token_hash: null,
          paused_at: null,
          issue_checkpoints_json: "[]",
        });
        const rebound = await db.prepare(
          `select workflow_snapshot_json from briar_hunt_runs where id = ?`,
        ).bind(runId).first<{ workflow_snapshot_json: string }>();
        expect(JSON.parse(rebound!.workflow_snapshot_json).stages).toEqual([
          { id: "planning", label: "Plan", required: true },
          { id: "implementing", label: "Implement", required: true },
        ]);
      }
      await expect(db.prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status,
           workflow_stage, detail, actor, pull_request_urls,
           occurred_at, recorded_at
         ) values (
           'stale-target-worker-event', ?, 'stale-target-worker:running',
           1, 1, 'implementing', 'running', 'implementing', null,
           'stale-target-worker', '[]', ?, ?
         )`,
      ).bind(
        prematurelyMovedExecutableRuns[0].runId,
        "2026-08-10T00:01:20.000Z",
        "2026-08-10T00:01:20.000Z",
      ).run()).rejects.toThrow(
        "channel-approved issue execution requires explicit dispatch",
      );
      await expect(db.prepare(
        `select project_id, status, dispatch_request_id
         from briar_hunt_runs where id = ?`,
      ).bind(prematurelyMovedCompletedRunId).first()).resolves.toEqual({
        project_id: targetProjectId,
        status: "completed",
        dispatch_request_id: null,
      });
      await expect(db.prepare(
        `update briar_hunt_runs
         set status = 'queued', stage = 'queued', workflow_stage = null
         where id = ?`,
      ).bind(prematurelyMovedCompletedRunId).run()).rejects.toThrow(
        "approved issue terminal reactivation requires fresh execution approval",
      );
      await expect(db.prepare(
        `select reason, channel_id
         from briar_channel_issue_approval_reconciliation where run_id = ?`,
      ).bind(orphanRunId).first()).resolves.toEqual({
        reason: "orphaned_legacy_issue",
        channel_id: null,
      });
      await expect(db.prepare(
        `select status, stage from briar_hunt_runs where id = ?`,
      ).bind(orphanRunId).first()).resolves.toEqual({
        status: "cancelled",
        stage: "cancelled",
      });

      const migrationProposalChanges = await db.prepare(
        `select entity_id from briar_channel_changes
         where organization_id = ? and version > ?
           and entity_type = 'proposal' and operation = 'upsert'`,
      ).bind(
        organizationId,
        beforeApprovalUpgradeCursor?.current_version ?? 0,
      ).all<{ entity_id: string }>();
      expect(migrationProposalChanges.results.map((change) => change.entity_id))
        .toEqual(expect.arrayContaining([acceptedId, dispatchedId, missingResultId]));

      await expect(db.prepare(
        `select run_id, approved_by_user_id, result_verification
         from briar_channel_issue_approval_audit
         where proposal_id = ?`,
      ).bind(acceptedId).first()).resolves.toEqual({
        run_id: acceptedRunId,
        approved_by_user_id: approverId,
        result_verification: "unverifiable",
      });
      await expect(db.prepare(
        `select status, result_run_id, issue_source_key
         from briar_channel_action_proposals where id = ?`,
      ).bind(acceptedId).first()).resolves.toEqual({
        status: "pending",
        result_run_id: null,
        issue_source_key: null,
      });
      await expect(db.prepare(
        `select reason from briar_channel_issue_approval_reconciliation
         where run_id = ?`,
      ).bind(acceptedRunId).first()).resolves.toEqual({
        reason: "unverifiable_legacy_result",
      });
      await expect(db.prepare(
        `select status, stage, repository, branch
         from briar_hunt_runs where id = ?`,
      ).bind(acceptedRunId).first()).resolves.toEqual({
        status: "cancelled",
        stage: "cancelled",
        repository: "attacker/poisoned-channel-repository",
        branch: "agent-controlled-channel-branch",
      });
      await expect(db.prepare(
        `update briar_hunt_runs
         set status = 'queued', stage = 'queued' where id = ?`,
      ).bind(acceptedRunId).run()).rejects.toThrow(
        "reconciled channel proposal issue is quarantined",
      );

      const reapprovalSourceKey = `briar-channel-approved:${"8".repeat(64)}`;
      await expect(reserveChannelActionProposalApproval(db, {
        organizationId,
        channelId,
        proposalId: acceptedId,
        projectId,
        userId: approverId,
        approvedAt: "2026-08-10T00:01:30.000Z",
        issueSourceKey: reapprovalSourceKey,
      })).resolves.toMatchObject({ issue_source_key: reapprovalSourceKey });
      const reapprovedRunId = await recordHuntEvent(db, projectId, {
        source: "issue",
        sourceKey: reapprovalSourceKey,
        title: "Upgrade 000000000001",
        stage: "queued",
        status: "backlog",
        workflowStage: null,
        eventKey: `${reapprovalSourceKey}:backlog:intake`,
        occurredAt: now,
        actor: "briar-channel",
        repository: "Upgrade Project",
        detail: "채널 대화에서 사용자가 승인한 제안으로 생성된 이슈입니다.",
        priority: 2,
        assigneeUserId: null,
        issueCheckpoints: [],
        fullAuto: false,
        branch: null,
        commitSha: null,
        tracker: null,
        issueDescription: null,
        resultSummary: null,
        structuredResult: null,
        pullRequestUrls: [],
        targetSha: null,
        sourceCreatedAt: now,
        qaStatus: null,
        stagingQaDetail: null,
        productionQaDetail: null,
        context: {
          origin: "briar-channel",
          proposalId: acceptedId,
          channelId,
          issueId: acceptedId,
          attachmentCount: 0,
          fullAuto: false,
        },
        createdByUserId: approverId,
        preferredAgentProvider: null,
        preferredAgentModel: null,
        preferredAgentEffort: null,
      });
      await expect(db.prepare(
        `select status, result_run_id, issue_source_key
         from briar_channel_action_proposals where id = ?`,
      ).bind(acceptedId).first()).resolves.toEqual({
        status: "accepted",
        result_run_id: reapprovedRunId,
        issue_source_key: reapprovalSourceKey,
      });
      await expect(db.prepare(
        `select result_verification, count(*) as count
         from briar_channel_issue_approval_audit
         where proposal_id = ?
         group by result_verification order by result_verification`,
      ).bind(acceptedId).all()).resolves.toMatchObject({
        results: [
          { result_verification: "atomic", count: 1 },
          { result_verification: "unverifiable", count: 1 },
        ],
      });
      await expect(recordHuntEvent(db, projectId, {
        source: "issue",
        sourceKey: reapprovalSourceKey,
        title: "Stale Worker bypass",
        stage: "implementing",
        status: "running",
        workflowStage: "implementing",
        eventKey: "stale-worker:running",
        occurredAt: "2026-08-10T00:02:00.000Z",
        actor: "stale-worker",
        repository: "Upgrade Project",
        detail: null,
        priority: 2,
        branch: null,
        commitSha: null,
        tracker: null,
        issueDescription: null,
        resultSummary: null,
        structuredResult: null,
        pullRequestUrls: [],
        targetSha: null,
        sourceCreatedAt: now,
        qaStatus: null,
        stagingQaDetail: null,
        productionQaDetail: null,
        context: { fullAuto: true },
      })).rejects.toThrow(
        "channel-approved issue execution requires explicit dispatch",
      );
      await expect(db.prepare(
        `update briar_hunt_runs set context_json = '{"fullAuto":true}'
         where id = ?`,
      ).bind(reapprovedRunId).run()).rejects.toThrow(
        "channel-approved issue context is immutable before dispatch",
      );
      await expect(db.prepare(
        `select status, context_json,
                (select count(*) from briar_hunt_events event
                 where event.run_id = run.id) as event_count
         from briar_hunt_runs run where id = ?`,
      ).bind(reapprovedRunId).first()).resolves.toMatchObject({
        status: "backlog",
        event_count: 1,
      });
      await expect(db.prepare(
        `select run_id, result_verification
         from briar_channel_issue_approval_audit where proposal_id = ?`,
      ).bind(missingResultId).first()).resolves.toEqual({
        run_id: null,
        result_verification: "missing",
      });
      await expect(db.prepare(
        `select status, result_run_id from briar_channel_action_proposals
         where id = ?`,
      ).bind(missingResultId).first()).resolves.toEqual({
        status: "pending",
        result_run_id: null,
      });
      await expect(db.prepare(
        `select result_verification from briar_channel_issue_approval_audit
         where proposal_id = ?`,
      ).bind(dispatchedId).first()).resolves.toEqual({
        result_verification: "legacy_authorized",
      });
      await expect(db.prepare(
        `select reason from briar_channel_issue_approval_reconciliation
         where run_id = ?`,
      ).bind(dispatchedRunId).first()).resolves.toBeNull();
      await expect(db.prepare(
        `select status, stage, requested_agent_provider,
                preferred_agent_provider, preferred_agent_model,
                preferred_agent_effort
         from briar_hunt_runs where id = ?`,
      ).bind(dispatchedRunId).first()).resolves.toEqual({
        status: "queued",
        stage: "queued",
        requested_agent_provider: "codex",
        preferred_agent_provider: "codex",
        preferred_agent_model: null,
        preferred_agent_effort: null,
      });
      await expect(db.prepare(
        `update briar_hunt_runs
         set preferred_agent_provider = 'grok',
             preferred_agent_model = 'grok-4',
             preferred_agent_effort = 'high'
         where id = ?`,
      ).bind(dispatchedRunId).run()).rejects.toThrow(
        "approved channel issue dispatch preferences are immutable",
      );
      await expect(db.prepare(
        `update briar_hunt_runs
         set project_id = ?, agent_id = null, worker_id = null,
             requested_worker_id = null, claim_token_hash = null,
             claimed_by = null, claimed_at = null, lease_expires_at = null,
             last_execution_id = null, dispatch_mode = null,
             dispatch_request_id = null, dispatched_at = null,
             requested_by_user_id = null, requested_agent_provider = null,
             requested_agent_model = null, requested_agent_effort = null
         where id = ?`,
      ).bind(targetProjectId, transferRunId).run()).rejects.toThrow(
        "channel-approved dispatch cancellation requires backlog reset",
      );
      for (const status of ["blocked", "failed"] as const) {
        await db.prepare(
          `update briar_hunt_runs
           set status = ?, stage = ?, workflow_stage = null where id = ?`,
        ).bind(status, status, transferRunId).run();
        await expect(db.prepare(
          `update briar_hunt_runs
           set project_id = ?, agent_id = null, worker_id = null,
               requested_worker_id = null, claim_token_hash = null,
               claimed_by = null, claimed_at = null, lease_expires_at = null,
               last_execution_id = null, dispatch_mode = null,
               dispatch_request_id = null, dispatched_at = null,
               requested_by_user_id = null, requested_agent_provider = null,
               requested_agent_model = null, requested_agent_effort = null
           where id = ?`,
        ).bind(targetProjectId, transferRunId).run()).rejects.toThrow(
          "channel-approved dispatch cancellation requires backlog reset",
        );
      }
      await expect(db.prepare(
        `update briar_hunt_runs
         set project_id = ?, status = 'backlog', stage = 'queued',
             workflow_stage = null, agent_id = null, worker_id = null,
             requested_worker_id = null, claim_token_hash = null,
             claimed_by = null, claimed_at = null, lease_expires_at = null,
             last_execution_id = null, dispatch_mode = null,
             dispatch_request_id = null, dispatched_at = null,
             requested_by_user_id = null, requested_agent_provider = null,
             requested_agent_model = null, requested_agent_effort = null
         where id = ? returning id`,
      ).bind(targetProjectId, transferRunId).first()).resolves.toEqual({
        id: transferRunId,
      });
      await expect(db.prepare(
        `select project_id, status, dispatch_request_id, requested_by_user_id
         from briar_hunt_runs where id = ?`,
      ).bind(transferRunId).first()).resolves.toEqual({
        project_id: targetProjectId,
        status: "backlog",
        dispatch_request_id: null,
        requested_by_user_id: null,
      });
      await expect(recordHuntEvent(db, projectId, {
        source: "issue",
        sourceKey: `briar-channel-proposal:${dispatchedId}`,
        title: "User-edited dispatched issue",
        stage: "implementing",
        status: "running",
        workflowStage: "implementing",
        eventKey: "legacy-in-flight:implementing",
        occurredAt: "2026-08-10T00:02:30.000Z",
        actor: "legacy-in-flight-worker",
        repository: "Upgrade Project",
        detail: "The explicitly dispatched legacy run can finish in place.",
        priority: 2,
        branch: null,
        commitSha: null,
        tracker: null,
        issueDescription: null,
        resultSummary: null,
        structuredResult: null,
        pullRequestUrls: [],
        targetSha: null,
        sourceCreatedAt: now,
        qaStatus: null,
        stagingQaDetail: null,
        productionQaDetail: null,
        context: {},
      })).resolves.toBe(dispatchedRunId);
      await expect(db.prepare(
        `select status, workflow_stage, source_key
         from briar_hunt_runs where id = ?`,
      ).bind(dispatchedRunId).first()).resolves.toEqual({
        status: "running",
        workflow_stage: "implementing",
        source_key: `briar-channel-proposal:${dispatchedId}`,
      });
      await expect(db.prepare(
        `select result_verification from briar_channel_issue_approval_audit
         where proposal_id = ?`,
      ).bind(poisonedId).first()).resolves.toEqual({
        result_verification: "unverifiable",
      });
      await expect(db.prepare(
        `select reason from briar_channel_issue_approval_reconciliation
         where run_id = ?`,
      ).bind(poisonedRunId).first()).resolves.toEqual({
        reason: "unverifiable_legacy_result",
      });
      await expect(db.prepare(
        `select status, stage from briar_hunt_runs where id = ?`,
      ).bind(poisonedRunId).first()).resolves.toEqual({
        status: "cancelled",
        stage: "cancelled",
      });
      await expect(db.prepare(
        `select audit.result_verification, proposal.issue_source_key
         from briar_channel_issue_approval_audit audit
         join briar_channel_action_proposals proposal
           on proposal.id = audit.proposal_id
         where audit.proposal_id = ?`,
      ).bind(preemptedId).first()).resolves.toEqual({
        result_verification: "unverifiable",
        issue_source_key: null,
      });
      await expect(db.prepare(
        `select reason from briar_channel_issue_approval_reconciliation
         where run_id = ?`,
      ).bind(preemptedRunId).first()).resolves.toEqual({
        reason: "unverifiable_legacy_result",
      });
      await expect(db.prepare(
        `select status, stage from briar_hunt_runs where id = ?`,
      ).bind(preemptedRunId).first()).resolves.toEqual({
        status: "cancelled",
        stage: "cancelled",
      });
      await expect(db.prepare(
        `select reason from briar_channel_issue_approval_reconciliation
         where run_id = ?`,
      ).bind(pendingRunId).first()).resolves.toEqual({
        reason: "unfinalized_legacy_issue",
      });
      await expect(db.prepare(
        `select status, stage from briar_hunt_runs where id = ?`,
      ).bind(pendingRunId).first()).resolves.toEqual({
        status: "cancelled",
        stage: "cancelled",
      });
      await expect(db.prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status,
           workflow_stage, detail, actor, branch, commit_sha, qa_status,
           tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         ) select ?, id, 'stale-revival:running', current_attempt,
                  current_revision, 'implementing', 'running', 'implementing',
                  null, 'stale-worker', null, null, null, null, '[]', null,
                  ?, ?
           from briar_hunt_runs where id = ?`,
      ).bind(
        "stale-revival-event",
        "2026-08-10T00:03:00.000Z",
        "2026-08-10T00:03:00.000Z",
        pendingRunId,
      ).run()).rejects.toThrow(
        "reconciled channel proposal issue is quarantined",
      );
      await expect(db.prepare(
        `update briar_hunt_runs
         set status = 'queued', stage = 'queued', completed_at = null
         where id = ?`,
      ).bind(pendingRunId).run()).rejects.toThrow(
        "reconciled channel proposal issue is quarantined",
      );
      await expect(db.prepare(
        `update briar_channel_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = ? where id = ?`,
      ).bind(approverId, now, pendingRunId, pendingId).run()).rejects.toThrow(
        "legacy channel proposal acceptance is disabled",
      );
      await expect(db.prepare(
        `update briar_channel_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             updated_at = ? where id = ?`,
      ).bind(approverId, now, now, planProposalId).run()).resolves.toMatchObject({
        meta: expect.objectContaining({ changes: expect.any(Number) }),
      });
      await expect(db.prepare(
        `select status from briar_channel_action_proposals where id = ?`,
      ).bind(planProposalId).first()).resolves.toEqual({ status: "accepted" });
      await expect(reserveChannelActionProposalApproval(db, {
        organizationId,
        channelId,
        proposalId: pendingId,
        projectId,
        userId: approverId,
        approvedAt: "2026-08-10T00:01:00.000Z",
        issueSourceKey: `briar-channel-approved:${"9".repeat(64)}`,
      })).resolves.toMatchObject({
        project_id: projectId,
        accepted_by_user_id: approverId,
        issue_source_key: `briar-channel-approved:${"9".repeat(64)}`,
      });
      await expect(db.prepare(
        `update briar_channel_action_proposals
         set status = 'accepted', result_run_id = ?, updated_at = ?
         where id = ?`,
      ).bind(pendingRunId, now, pendingId).run()).rejects.toThrow(
        "legacy channel proposal acceptance is disabled",
      );

      const postMigrationId = await seedProposal("000000000004");
      await expect(
        legacyRun(postMigrationId, "Upgrade 000000000004"),
      ).rejects.toThrow("legacy channel proposal issue creation is disabled");
      await expect(
        legacyRun(
          "97000000-0000-4000-8000-000000009999",
          "Unknown legacy channel proposal",
        ),
      ).rejects.toThrow("legacy channel proposal issue creation is disabled");

      await db.prepare(`delete from "user" where id = ?`).bind(approverId).run();
      await expect(db.prepare(
        `select approved_by_user_id from briar_channel_issue_approval_audit
         where proposal_id = ?`,
      ).bind(acceptedId).first()).resolves.toEqual({ approved_by_user_id: null });
      await db.prepare(`delete from briar_channels where id = ?`).bind(channelId).run();
      await expect(db.prepare(
        `select count(*) as count from briar_channel_issue_approval_audit
         where proposal_id in (?, ?)`,
      ).bind(acceptedId, missingResultId).first()).resolves.toEqual({ count: 3 });
    } finally {
      await miniflare.dispose();
    }
  }, 60_000);

  it("updates device fan-out cursors with indexed project lookups", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-dashboard-device-sync-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      for (const statement of [
        `create table briar_execution_worker_devices (
           id text primary key not null,
           updated_at text not null
         )`,
        `create table briar_execution_workers (
           id text primary key not null,
           project_id text not null,
           device_id text not null
         )`,
        `create unique index briar_execution_workers_project_device_idx
           on briar_execution_workers (project_id, device_id)`,
        `create index briar_execution_workers_device_idx
           on briar_execution_workers (device_id, project_id)`,
        `create table briar_dashboard_changes (
           version integer primary key autoincrement,
           project_id text not null,
           entity_type text not null,
           entity_id text,
           operation text not null,
           created_at text not null
         )`,
        `create index briar_dashboard_changes_project_version_idx
           on briar_dashboard_changes (project_id, version)`,
        `create table briar_dashboard_sync_state (
           project_id text primary key not null,
           current_version integer not null
         )`,
        `create trigger briar_dashboard_worker_devices_update_sync
         after update on briar_execution_worker_devices BEGIN
           select new.id;
         END`,
      ]) {
        await db.prepare(statement).run();
      }
      await db.prepare(
        `insert into briar_execution_worker_devices (id, updated_at)
         values ('device-1', '2026-08-10T00:00:00.000Z')`,
      ).run();
      await db.prepare(
        `insert into briar_execution_workers (id, project_id, device_id)
         values ('worker-1', 'project-1', 'device-1'),
                ('worker-2', 'project-2', 'device-1')`,
      ).run();
      await db.prepare(
        `insert into briar_dashboard_changes (
           project_id, entity_type, entity_id, operation, created_at
         ) values
           ('project-1', 'run', 'run-1', 'upsert', '2026-08-10 00:00:00'),
           ('project-2', 'run', 'run-2', 'upsert', '2026-08-10 00:00:00'),
           ('project-3', 'run', 'run-3', 'upsert', '2026-08-10 00:00:00')`,
      ).run();
      await db.prepare(
        `with recursive sequence(value) as (
           select 1
           union all
           select value + 1 from sequence where value < 1000
         )
         insert into briar_dashboard_changes (
           project_id, entity_type, entity_id, operation, created_at
         )
         select 'project-history', 'run', 'history-' || value, 'upsert',
                '2026-08-10 00:00:00'
         from sequence`,
      ).run();
      await db.prepare(
        `insert into briar_dashboard_sync_state (project_id, current_version)
         values ('project-1', 1), ('project-2', 2), ('project-3', 3)`,
      ).run();

      const sql = await readFile(
        resolve(
          "migrations",
          "0081_optimize_dashboard_worker_device_sync.sql",
        ),
        "utf8",
      );
      for (const statement of unstable_splitSqlQuery(sql)) {
        await db.prepare(statement).run();
      }
      const update = await db.prepare(
        `update briar_execution_worker_devices
         set updated_at = '2026-08-10T00:01:00.000Z'
         where id = 'device-1'`,
      ).run();
      expect(update.meta.rows_read).toBeLessThan(50);

      const changes = await db.prepare(
        `select project_id, entity_id
         from briar_dashboard_changes
         where entity_type = 'worker'
         order by project_id`,
      ).all<{ project_id: string; entity_id: string }>();
      expect(changes.results).toEqual([
        { project_id: "project-1", entity_id: "worker-1" },
        { project_id: "project-2", entity_id: "worker-2" },
      ]);

      const cursors = await db.prepare(
        `select state.project_id, state.current_version,
                max(change.version) as latest_version
         from briar_dashboard_sync_state state
         join briar_dashboard_changes change
           on change.project_id = state.project_id
         group by state.project_id, state.current_version
         order by state.project_id`,
      ).all<{
        project_id: string;
        current_version: number;
        latest_version: number;
      }>();
      expect(cursors.results).toHaveLength(3);
      expect(cursors.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            project_id: "project-1",
            current_version: expect.any(Number),
          }),
          expect.objectContaining({
            project_id: "project-2",
            current_version: expect.any(Number),
          }),
          { project_id: "project-3", current_version: 3, latest_version: 3 },
        ]),
      );
      expect(
        cursors.results
          .filter((row) => row.project_id !== "project-3")
          .every((row) => row.current_version === row.latest_version),
      ).toBe(true);

      const plan = await db.prepare(
        `explain query plan
         select worker.project_id, (
           select change.version
             from briar_dashboard_changes change
            where change.project_id = worker.project_id
            order by change.version desc
            limit 1
         )
         from briar_execution_workers worker
         where worker.device_id = 'device-1'`,
      ).all<{ detail: string }>();
      const details = plan.results.map((row) => row.detail).join("\n");
      expect(details).toContain("briar_execution_workers_device_idx");
      expect(details).toContain("briar_dashboard_changes_project_version_idx");
      expect(details).not.toMatch(/scan briar_dashboard_changes/iu);
    } finally {
      await miniflare.dispose();
    }
  });

  it("suppresses heartbeat-only dashboard changes without hiding semantic updates", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-dashboard-heartbeat-suppression-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await executeD1Sql(
        db,
        `create table briar_execution_worker_devices (
           id text primary key not null,
           organization_id text not null,
           owner_user_id text not null,
           label text not null,
           device_identity_hash text not null,
           state text not null,
           max_concurrent_sessions integer not null,
           icon_type text,
           icon_value text,
           last_heartbeat_at text not null,
           created_at text not null,
           updated_at text not null
         );
         create table briar_execution_workers (
           id text primary key not null,
           project_id text not null,
           device_id text not null,
           label text not null,
           host_fingerprint text not null,
           agent_provider text not null,
           versions_json text not null,
           capabilities_json text not null,
           state text not null,
           accepting_work integer not null,
           readiness_state text not null,
           readiness_detail text,
           last_heartbeat_at text not null,
           created_at text not null,
           updated_at text not null
         );
         create unique index briar_execution_workers_project_device_idx
           on briar_execution_workers (project_id, device_id);
         create index briar_execution_workers_device_idx
           on briar_execution_workers (device_id, project_id);
         create table briar_dashboard_changes (
           version integer primary key autoincrement,
           project_id text not null,
           entity_type text not null,
           entity_id text,
           operation text not null,
           created_at text not null
         );
         create index briar_dashboard_changes_project_version_idx
           on briar_dashboard_changes (project_id, version);
         create table briar_dashboard_sync_state (
           project_id text primary key not null,
           current_version integer not null
         );
         create trigger briar_dashboard_workers_update_sync
         after update on briar_execution_workers BEGIN
           insert into briar_dashboard_changes (
             project_id, entity_type, entity_id, operation, created_at
           ) values (new.project_id, 'worker', new.id, 'upsert', datetime('now'));
           insert into briar_dashboard_sync_state (project_id, current_version)
           values (new.project_id, last_insert_rowid())
           on conflict (project_id) do update set
             current_version = excluded.current_version;
         END;
         create trigger briar_dashboard_worker_devices_update_sync
         after update on briar_execution_worker_devices BEGIN
           select new.id;
         END;`,
      );
      await db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, max_concurrent_sessions, icon_type, icon_value,
           last_heartbeat_at, created_at, updated_at
         ) values (
           'device-1', 'organization-1', 'owner-1', 'Worker one',
           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
           'online', 2, 'emoji', '🌿',
           '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z',
           '2026-08-10T00:00:00.000Z'
         )`,
      ).run();
      await db.prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint,
           agent_provider, versions_json, capabilities_json, state,
           accepting_work, readiness_state, readiness_detail,
           last_heartbeat_at, created_at, updated_at
         ) values
           (
             'worker-1', 'project-1', 'device-1', 'Worker one',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             'codex', '{"briar":"1.2.94"}',
             '{"providerHealth":{"codex":{"healthy":true}}}',
             'online', 1, 'ready', null,
             '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z',
             '2026-08-10T00:00:00.000Z'
           ),
           (
             'worker-2', 'project-2', 'device-1', 'Worker one',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             'codex', '{"briar":"1.2.94"}',
             '{"providerHealth":{"codex":{"healthy":true}}}',
             'online', 1, 'ready', null,
             '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z',
             '2026-08-10T00:00:00.000Z'
           )`,
      ).run();
      await db.prepare(
        `insert into briar_dashboard_changes (
           project_id, entity_type, entity_id, operation, created_at
         ) values
           ('project-1', 'run', 'run-1', 'upsert', '2026-08-10 00:00:00'),
           ('project-2', 'run', 'run-2', 'upsert', '2026-08-10 00:00:00')`,
      ).run();
      await db.prepare(
        `insert into briar_dashboard_sync_state (project_id, current_version)
         values ('project-1', 1), ('project-2', 2)`,
      ).run();
      await db.prepare(
        `with recursive sequence(value) as (
           select 1
           union all
           select value + 1 from sequence where value < 1000
         )
         insert into briar_dashboard_changes (
           project_id, entity_type, entity_id, operation, created_at
         )
         select 'project-history', 'run', 'history-' || value, 'upsert',
                '2026-08-10 00:00:00'
         from sequence`,
      ).run();

      for (const name of [
        "0081_optimize_dashboard_worker_device_sync.sql",
        "0083_suppress_heartbeat_dashboard_changes.sql",
      ]) {
        await executeD1Sql(
          db,
          await readFile(resolve("migrations", name), "utf8"),
        );
      }

      const triggerDefinitions = await db.prepare(
        `select name, sql from sqlite_master
         where type = 'trigger' and name in (
           'briar_dashboard_workers_update_sync',
           'briar_dashboard_worker_devices_update_sync'
         )`,
      ).all<{ name: string; sql: string }>();
      const definitions = new Map(
        triggerDefinitions.results.map((trigger) => [trigger.name, trigger.sql]),
      );
      const workerTrigger = definitions.get("briar_dashboard_workers_update_sync") ?? "";
      for (const field of [
        "project_id",
        "device_id",
        "label",
        "host_fingerprint",
        "agent_provider",
        "versions_json",
        "capabilities_json",
        "state",
        "accepting_work",
        "readiness_state",
        "readiness_detail",
      ]) {
        expect(workerTrigger).toMatch(
          new RegExp(`old\\.${field}\\s+is\\s+not\\s+new\\.${field}`, "iu"),
        );
      }
      const deviceTrigger =
        definitions.get("briar_dashboard_worker_devices_update_sync") ?? "";
      for (const field of [
        "organization_id",
        "owner_user_id",
        "label",
        "device_identity_hash",
        "state",
        "max_concurrent_sessions",
        "icon_type",
        "icon_value",
      ]) {
        expect(deviceTrigger).toMatch(
          new RegExp(`old\\.${field}\\s+is\\s+not\\s+new\\.${field}`, "iu"),
        );
      }
      expect(`${workerTrigger}\n${deviceTrigger}`).not.toMatch(
        /old\.(last_heartbeat_at|updated_at)\s+is\s+not/iu,
      );
      expect(deviceTrigger).toMatch(
        /order\s+by\s+change\.version\s+desc\s+limit\s+1/iu,
      );
      expect(deviceTrigger).toMatch(
        /max\(briar_dashboard_sync_state\.current_version,\s*excluded\.current_version\)/iu,
      );

      const readState = async () => {
        const changes = await db.prepare(
          `select count(*) as count from briar_dashboard_changes
           where entity_type = 'worker'`,
        ).first<{ count: number }>();
        const cursors = await db.prepare(
          `select project_id, current_version from briar_dashboard_sync_state
           order by project_id`,
        ).all<{ project_id: string; current_version: number }>();
        return {
          changes: changes?.count ?? 0,
          cursors: cursors.results,
        };
      };
      const beforeHeartbeat = await readState();
      await db.prepare(
        `update briar_execution_worker_devices
         set last_heartbeat_at = '2026-08-10T00:01:00.000Z',
             updated_at = '2026-08-10T00:01:00.000Z',
             state = case when state = 'disabled' then 'disabled' else 'online' end
         where id = 'device-1'`,
      ).run();
      await db.prepare(
        `update briar_execution_workers
         set last_heartbeat_at = '2026-08-10T00:01:00.000Z',
             updated_at = '2026-08-10T00:01:00.000Z',
             versions_json = coalesce('{"briar":"1.2.94"}', versions_json),
             accepting_work = coalesce(1, accepting_work),
             readiness_state = coalesce('ready', readiness_state),
             readiness_detail = case when 1 is null
               then readiness_detail else null end,
             capabilities_json = coalesce(
               '{"providerHealth":{"codex":{"healthy":true}}}',
               capabilities_json
             ),
             state = case when state = 'disabled' then 'disabled' else 'online' end
         where id = 'worker-1' and project_id = 'project-1'`,
      ).run();
      expect(await readState()).toEqual(beforeHeartbeat);

      const liveness = await db.prepare(
        `select device.last_heartbeat_at as device_heartbeat_at,
                device.updated_at as device_updated_at,
                device.state as device_state,
                worker.last_heartbeat_at as worker_heartbeat_at,
                worker.updated_at as worker_updated_at,
                worker.state as worker_state
         from briar_execution_worker_devices device
         join briar_execution_workers worker on worker.device_id = device.id
         where device.id = 'device-1' and worker.id = 'worker-1'`,
      ).first<{
        device_heartbeat_at: string;
        device_updated_at: string;
        device_state: string;
        worker_heartbeat_at: string;
        worker_updated_at: string;
        worker_state: string;
      }>();
      expect(liveness).toEqual({
        device_heartbeat_at: "2026-08-10T00:01:00.000Z",
        device_updated_at: "2026-08-10T00:01:00.000Z",
        device_state: "online",
        worker_heartbeat_at: "2026-08-10T00:01:00.000Z",
        worker_updated_at: "2026-08-10T00:01:00.000Z",
        worker_state: "online",
      });

      await db.prepare(
        `update briar_execution_workers
         set capabilities_json =
               '{"providerHealth":{"codex":{"healthy":true},"claude":{"healthy":true}}}',
             updated_at = '2026-08-10T00:02:00.000Z'
         where id = 'worker-1'`,
      ).run();
      const afterCapabilities = await readState();
      expect(afterCapabilities.changes).toBe(beforeHeartbeat.changes + 1);
      expect(afterCapabilities.cursors[0].current_version).toBeGreaterThan(
        beforeHeartbeat.cursors[0].current_version,
      );
      expect(afterCapabilities.cursors[1]).toEqual(beforeHeartbeat.cursors[1]);

      await db.prepare(
        `update briar_execution_workers
         set accepting_work = 0, readiness_state = 'busy',
             updated_at = '2026-08-10T00:03:00.000Z'
         where id = 'worker-1'`,
      ).run();
      const afterReadiness = await readState();
      expect(afterReadiness.changes).toBe(afterCapabilities.changes + 1);
      expect(afterReadiness.cursors[0].current_version).toBeGreaterThan(
        afterCapabilities.cursors[0].current_version,
      );
      expect(afterReadiness.cursors[1]).toEqual(afterCapabilities.cursors[1]);

      const labelUpdate = await db.prepare(
        `update briar_execution_worker_devices
         set label = 'Renamed worker',
             updated_at = '2026-08-10T00:04:00.000Z'
         where id = 'device-1'`,
      ).run();
      expect(labelUpdate.meta.rows_read).toBeLessThan(50);
      const afterLabel = await readState();
      expect(afterLabel.changes).toBe(afterReadiness.changes + 2);
      expect(
        afterLabel.cursors.every((cursor, index) =>
          cursor.current_version > afterReadiness.cursors[index].current_version
        ),
      ).toBe(true);
      const published = await db.prepare(
        `select project_id, entity_id from briar_dashboard_changes
         where entity_type = 'worker' order by version`,
      ).all<{ project_id: string; entity_id: string }>();
      expect(published.results).toEqual([
        { project_id: "project-1", entity_id: "worker-1" },
        { project_id: "project-1", entity_id: "worker-1" },
        { project_id: "project-1", entity_id: "worker-1" },
        { project_id: "project-2", entity_id: "worker-2" },
      ]);
    } finally {
      await miniflare.dispose();
    }
  });

  it.each([
    "0055_agent_provider_opencode.sql",
    "0071_organization_agents.sql",
    "0072_organization_ideas.sql",
    "0073_organization_channels.sql",
    "0106_agent_provider_agy.sql",
  ])(
    "uses D1 transaction-safe foreign-key deferral for table rebuilds: %s",
    async (name) => {
      const sql = await readFile(resolve("migrations", name), "utf8");

      expect(sql).toMatch(/pragma\s+defer_foreign_keys\s*=\s*on\s*;/iu);
      expect(sql).toMatch(/pragma\s+defer_foreign_keys\s*=\s*off\s*;/iu);
      expect(sql).not.toMatch(/pragma\s+foreign_keys\s*=/iu);
    },
  );

  it("keeps Agent and idea ownership organization-scoped with an optional project", async () => {
    const agents = await readFile(
      resolve("migrations", "0071_organization_agents.sql"),
      "utf8",
    );
    const ideas = await readFile(
      resolve("migrations", "0072_organization_ideas.sql"),
      "utf8",
    );

    // A null project_id is what marks an organization Agent or idea, so the
    // column must not carry NOT NULL while organization_id must.
    expect(agents).toMatch(
      /organization_id text not null\s+references briar_organizations/iu,
    );
    expect(agents).toMatch(
      /project_id text references briar_projects \(id\) on delete cascade/iu,
    );
    expect(ideas).toMatch(
      /organization_id text not null\s+references briar_organizations/iu,
    );
    expect(ideas).toMatch(
      /project_id text references briar_projects \(id\) on delete cascade/iu,
    );
    expect(agents).toMatch(
      /create unique index briar_project_agents_handle_idx[\s\S]*where handle is not null/iu,
    );
  });

  it("retires legacy Agent handles without losing Agent records", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-remove-agent-handles-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await applyD1Migrations(db, {
        through: "0101_issue_conversation_realtime.sql",
      });
      await db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values ('org-1', 'Example', 'example', '2026-08-13', '2026-08-13')`,
      ).run();
      await createOrganizationAgent(db, {
        id: "agent-1",
        organizationId: "org-1",
        name: "기획 도우미",
        provider: "codex",
        model: null,
        responsibility: "제품 기획을 돕습니다.",
        effort: null,
        createdAt: "2026-08-13",
      });
      await db.prepare(
        `update briar_project_agents set handle = 'planning-helper'
         where id = 'agent-1'`,
      ).run();

      await applyD1Migrations(db, {
        files: ["0102_remove_agent_handles.sql"],
      });

      await expect(
        db.prepare(
          `select id, name, handle from briar_project_agents where id = 'agent-1'`,
        ).first(),
      ).resolves.toEqual({ id: "agent-1", name: "기획 도우미", handle: null });
      const indexes = await db.prepare(
        `pragma index_list(briar_project_agents)`,
      ).all<{ name: string }>();
      expect(indexes.results.map((index) => index.name))
        .not.toContain("briar_project_agents_handle_idx");
    } finally {
      await miniflare.dispose();
    }
  }, 30_000);

  it("migrates every localized default Agent to a Developer Agent with an issue Skill", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-agent-skills-locale-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await db.prepare(
        `create table briar_project_agents (
           id text primary key not null,
           name text not null,
           responsibility text not null,
           provider text not null,
           model text,
           effort text,
           skill_markdown text not null,
           created_at text not null,
           updated_at text not null
         )`,
      ).run();
      const rows = [
        ["en", "Issue processing agent", "Process every queued issue."],
        ["ko", "이슈 처리 에이전트", "대기 중인 모든 이슈를 처리합니다."],
        [
          "ko-legacy",
          "자동 사냥 에이전트",
          "모든 대기중인 이슈에 대해서 자동사냥을 수행하는것",
        ],
        ["zh", "问题处理智能体", "处理所有排队中的问题。"],
        ["zh-legacy", "自动狩猎智能体", "对所有排队中的问题执行自动狩猎。"],
        ["custom", "iOS release agent", "Release the iOS app."],
      ] as const;
      for (const [id, name, responsibility] of rows) {
        await db.prepare(
          `insert into briar_project_agents (
             id, name, responsibility, provider, model, effort,
             skill_markdown, created_at, updated_at
           ) values (?, ?, ?, 'codex', null, null, ?, ?, ?)`,
        ).bind(
          id,
          name,
          responsibility,
          `# ${name}\n\n## Responsibility\n\n${responsibility}\n`,
          "2026-08-01T00:00:00.000Z",
          "2026-08-01T00:00:00.000Z",
        ).run();
      }

      const sql = await readFile(
        resolve("migrations", "0079_agent_skills.sql"),
        "utf8",
      );
      await executeD1Sql(db, sql);

      const result = await db.prepare(
        `select agent.id, agent.name as agent_name, agent.responsibility,
                agent.skill_markdown, skill.name as skill_name, skill.kind
         from briar_project_agents agent
         join briar_agent_skills skill on skill.agent_id = agent.id
         order by agent.id`,
      ).all<{
        id: string;
        agent_name: string;
        responsibility: string;
        skill_markdown: string;
        skill_name: string;
        kind: string;
      }>();
      expect(result.results).toEqual([
        expect.objectContaining({
          id: "custom",
          agent_name: "iOS release agent",
          skill_name: "iOS release agent",
          kind: "custom",
        }),
        expect.objectContaining({
          id: "en",
          agent_name: "Developer agent",
          responsibility: "Process every queued issue.",
          skill_markdown: expect.stringContaining("# Developer agent\n"),
          skill_name: "Issue processing",
          kind: "issue_processing",
        }),
        expect.objectContaining({
          id: "ko",
          agent_name: "개발자 에이전트",
          responsibility: "대기 중인 모든 이슈를 처리합니다.",
          skill_markdown: expect.stringContaining("# 개발자 에이전트\n"),
          skill_name: "이슈 처리",
          kind: "issue_processing",
        }),
        expect.objectContaining({
          id: "ko-legacy",
          agent_name: "개발자 에이전트",
          responsibility: "모든 대기중인 이슈에 대해서 자동사냥을 수행하는것",
          skill_markdown: expect.stringContaining("# 개발자 에이전트\n"),
          skill_name: "이슈 처리",
          kind: "issue_processing",
        }),
        expect.objectContaining({
          id: "zh",
          agent_name: "开发者智能体",
          responsibility: "处理所有排队中的问题。",
          skill_markdown: expect.stringContaining("# 开发者智能体\n"),
          skill_name: "问题处理",
          kind: "issue_processing",
        }),
        expect.objectContaining({
          id: "zh-legacy",
          agent_name: "开发者智能体",
          responsibility: "对所有排队中的问题执行自动狩猎。",
          skill_markdown: expect.stringContaining("# 开发者智能体\n"),
          skill_name: "问题处理",
          kind: "issue_processing",
        }),
      ]);
    } finally {
      await miniflare.dispose();
    }
  });

  it("rewrites the default Developer Agent responsibility to own development work", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-default-agent-responsibility-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await db.prepare(
        `create table briar_project_agents (
           id text primary key not null,
           name text not null,
           responsibility text not null,
           provider text not null,
           model text,
           effort text,
           skill_markdown text not null,
           created_at text not null,
           updated_at text not null
         )`,
      ).run();
      await db.prepare(
        `create table briar_agent_skills (
           id text primary key not null,
           agent_id text not null
             references briar_project_agents (id) on delete cascade,
           name text not null,
           instructions text not null default '',
           provider text not null,
           model text,
           effort text,
           kind text not null default 'custom',
           is_default integer not null default 0,
           position integer not null default 0,
           created_at text not null,
           updated_at text not null
         )`,
      ).run();

      const agents = [
        ["dev-en", "Developer agent", "Process every queued issue."],
        ["dev-ko", "개발자 에이전트", "대기 중인 모든 이슈를 처리합니다."],
        ["dev-zh", "开发者智能体", "处理所有排队中的问题。"],
        ["customized", "Developer agent", "Ship the mobile release."],
        ["legacy-name", "Issue processing agent", "Process every queued issue."],
      ] as const;
      for (const [id, name, responsibility] of agents) {
        await db.prepare(
          `insert into briar_project_agents (
             id, name, responsibility, provider, model, effort,
             skill_markdown, created_at, updated_at
           ) values (?, ?, ?, 'codex', null, null, ?, ?, ?)`,
        ).bind(
          id,
          name,
          responsibility,
          `# ${name}\n\n## Responsibility\n\n${responsibility}\n`,
          "2026-08-01T00:00:00.000Z",
          "2026-08-01T00:00:00.000Z",
        ).run();
      }

      const skills = [
        ["skill-en", "dev-en", "issue_processing", "Process every queued issue."],
        ["skill-ko", "dev-ko", "issue_processing", "대기 중인 모든 이슈를 처리합니다."],
        ["skill-zh", "dev-zh", "issue_processing", "处理所有排队中的问题。"],
        ["skill-custom-kind", "dev-en", "custom", "Process every queued issue."],
        ["skill-customized", "customized", "issue_processing", "Ship the mobile release."],
      ] as const;
      for (const [id, agentId, kind, instructions] of skills) {
        await db.prepare(
          `insert into briar_agent_skills (
             id, agent_id, name, instructions, provider, model, effort,
             kind, is_default, position, created_at, updated_at
           ) values (?, ?, ?, ?, 'codex', null, null, ?, 1, 0, ?, ?)`,
        ).bind(
          id,
          agentId,
          id,
          instructions,
          kind,
          "2026-08-01T00:00:00.000Z",
          "2026-08-01T00:00:00.000Z",
        ).run();
      }

      const sql = await readFile(
        resolve("migrations", "0104_default_developer_agent_responsibility.sql"),
        "utf8",
      );
      await executeD1Sql(db, sql);

      const agentResults = await db.prepare(
        `select id, name, responsibility, skill_markdown from briar_project_agents
         order by id`,
      ).all<{
        id: string;
        name: string;
        responsibility: string;
        skill_markdown: string;
      }>();
      expect(agentResults.results).toEqual([
        expect.objectContaining({
          id: "customized",
          name: "Developer agent",
          responsibility: "Ship the mobile release.",
          skill_markdown: expect.stringContaining("Ship the mobile release."),
        }),
        expect.objectContaining({
          id: "dev-en",
          responsibility: "Owns the project's development and code-related work.",
          skill_markdown: expect.stringContaining(
            "Owns the project's development and code-related work.",
          ),
        }),
        expect.objectContaining({
          id: "dev-ko",
          responsibility: "프로젝트의 개발과 코드 관련 작업을 책임집니다.",
          skill_markdown: expect.stringContaining(
            "프로젝트의 개발과 코드 관련 작업을 책임집니다.",
          ),
        }),
        expect.objectContaining({
          id: "dev-zh",
          responsibility: "负责项目的开发和代码相关工作。",
          skill_markdown: expect.stringContaining(
            "负责项目的开发和代码相关工作。",
          ),
        }),
        expect.objectContaining({
          id: "legacy-name",
          name: "Issue processing agent",
          responsibility: "Process every queued issue.",
          skill_markdown: expect.stringContaining("Process every queued issue."),
        }),
      ]);

      const skillResults = await db.prepare(
        `select id, kind, instructions from briar_agent_skills order by id`,
      ).all<{ id: string; kind: string; instructions: string }>();
      expect(skillResults.results).toEqual([
        expect.objectContaining({
          id: "skill-custom-kind",
          kind: "custom",
          instructions: "Process every queued issue.",
        }),
        expect.objectContaining({
          id: "skill-customized",
          kind: "issue_processing",
          instructions: "Ship the mobile release.",
        }),
        expect.objectContaining({
          id: "skill-en",
          kind: "issue_processing",
          instructions: "Owns the project's development and code-related work.",
        }),
        expect.objectContaining({
          id: "skill-ko",
          kind: "issue_processing",
          instructions: "프로젝트의 개발과 코드 관련 작업을 책임집니다.",
        }),
        expect.objectContaining({
          id: "skill-zh",
          kind: "issue_processing",
          instructions: "负责项目的开发和代码相关工作。",
        }),
      ]);
    } finally {
      await miniflare.dispose();
    }
  });

  it("backfills claimable work before retiring implicit Skill selection", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-explicit-agent-skill-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await db.prepare(
         `create table briar_agent_skills (
           id text primary key not null,
           agent_id text not null,
           is_default integer not null default 0,
           position integer not null default 0,
           created_at text not null
         )`,
      ).run();
      await db.prepare(
        `create unique index briar_agent_skills_default_idx
         on briar_agent_skills (agent_id) where is_default = 1`,
      ).run();
      await db.prepare(
        `create table briar_project_agent_task_jobs (
           id text primary key not null,
           agent_id text not null,
           skill_id text,
           status text not null
         )`,
      ).run();
      await db.prepare(
        `create table briar_channel_agent_reply_jobs (
           id text primary key not null,
           agent_id text not null,
           skill_id text,
           status text not null
         )`,
      ).run();
      await db.batch([
        db.prepare(
          `insert into briar_agent_skills
             (id, agent_id, is_default, position, created_at)
           values ('skill-issue', 'agent-1', 1, 0, '2026-08-09T00:00:00.000Z')`,
        ),
        db.prepare(
          `insert into briar_agent_skills
             (id, agent_id, is_default, position, created_at)
           values ('skill-release', 'agent-1', 0, 1, '2026-08-09T00:00:00.000Z')`,
        ),
        db.prepare(
          `insert into briar_project_agent_task_jobs
             (id, agent_id, skill_id, status)
           values ('task-queued', 'agent-1', null, 'queued')`,
        ),
        db.prepare(
          `insert into briar_project_agent_task_jobs
             (id, agent_id, skill_id, status)
           values ('task-completed', 'agent-1', null, 'completed')`,
        ),
        db.prepare(
          `insert into briar_channel_agent_reply_jobs
             (id, agent_id, skill_id, status)
           values ('reply-running', 'agent-1', null, 'running')`,
        ),
        db.prepare(
          `insert into briar_channel_agent_reply_jobs
             (id, agent_id, skill_id, status)
           values ('reply-explicit', 'agent-1', 'skill-release', 'queued')`,
        ),
      ]);

      const sql = await readFile(
        resolve("migrations", "0082_explicit_agent_skill_selection.sql"),
        "utf8",
      );
      for (const statement of unstable_splitSqlQuery(sql)) {
        await db.prepare(statement).run();
      }

      const taskJobs = await db.prepare(
        `select id, skill_id from briar_project_agent_task_jobs order by id`,
      ).all<{ id: string; skill_id: string | null }>();
      expect(taskJobs.results).toEqual([
        { id: "task-completed", skill_id: null },
        { id: "task-queued", skill_id: "skill-issue" },
      ]);
      const replyJobs = await db.prepare(
        `select id, skill_id from briar_channel_agent_reply_jobs order by id`,
      ).all<{ id: string; skill_id: string | null }>();
      expect(replyJobs.results).toEqual([
        { id: "reply-explicit", skill_id: "skill-release" },
        { id: "reply-running", skill_id: "skill-issue" },
      ]);
      const skillFlags = await db.prepare(
        `select id, is_default from briar_agent_skills order by id`,
      ).all<{ id: string; is_default: number }>();
      expect(skillFlags.results.every((skill) => skill.is_default === 0)).toBe(true);
      const retiredIndex = await db.prepare(
        `select name from sqlite_master
         where type = 'index' and name = 'briar_agent_skills_default_idx'`,
      ).first<{ name: string }>();
      expect(retiredIndex).toBeNull();
    } finally {
      await miniflare.dispose();
    }
  });

  it("adds workflow progress and policy state while preserving legacy rows", async () => {
    await withPreWorkflowMigrationDatabase(
      "briar-additive-workflow-migrations-test",
      async (db) => {
        await seedPreWorkflowProjectRun(db);
        await db.prepare(
          `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
           values ('migration-assignee', 'Assignee', 'assignee@example.com', 1, ?, ?)`,
        ).bind(migrationFixture.now, migrationFixture.now).run();

        await applyD1Migrations(db, {
          files: [
            "0059_workflow_v2_progress.sql",
            "0060_workflow_checkpoint_policies.sql",
            "0061_resume_requested_state.sql",
            "0062_issue_assignees.sql",
            "0067_issue_checkpoints.sql",
          ],
        });

        const settings = await db.prepare(
          `select workflow_json, updated_at, mandatory_checkpoints_json,
                  checkpoint_policy_revision
           from briar_project_settings where project_id = ?`,
        ).bind(migrationFixture.projectId).first<{
          workflow_json: string;
          updated_at: string;
          mandatory_checkpoints_json: string | null;
          checkpoint_policy_revision: number;
        }>();
        expect(settings).toEqual({
          workflow_json: migrationFixture.workflow,
          updated_at: migrationFixture.now,
          mandatory_checkpoints_json: null,
          checkpoint_policy_revision: 1,
        });

        const run = await db.prepare(
          `select workflow_snapshot_json, updated_at, paused_at,
                  waiting_checkpoint_key, waiting_checkpoint_revision,
                  resume_requested_at, assignee_user_id, issue_checkpoints_json
           from briar_hunt_runs where id = ?`,
        ).bind(migrationFixture.runId).first<{
          workflow_snapshot_json: string;
          updated_at: string;
          paused_at: string;
          waiting_checkpoint_key: string | null;
          waiting_checkpoint_revision: number | null;
          resume_requested_at: string | null;
          assignee_user_id: string | null;
          issue_checkpoints_json: string;
        }>();
        expect(run).toEqual({
          workflow_snapshot_json: migrationFixture.workflow,
          updated_at: migrationFixture.now,
          paused_at: migrationFixture.pausedAt,
          waiting_checkpoint_key: null,
          waiting_checkpoint_revision: null,
          resume_requested_at: null,
          assignee_user_id: null,
          issue_checkpoints_json: "[]",
        });

        const schemaObjects = await db.prepare(
          `select name from sqlite_master
           where name in (
             'briar_run_stage_progress',
             'briar_run_checkpoint_progress',
             'briar_run_checkpoint_waiting_unique_idx',
             'briar_user_workflow_checkpoint_defaults',
             'briar_hunt_runs_resume_requested_idx',
             'briar_hunt_runs_assignee_idx'
           ) order by name`,
        ).all<{ name: string }>();
        expect(schemaObjects.results.map((row) => row.name)).toEqual([
          "briar_hunt_runs_assignee_idx",
          "briar_hunt_runs_resume_requested_idx",
          "briar_run_checkpoint_progress",
          "briar_run_checkpoint_waiting_unique_idx",
          "briar_run_stage_progress",
          "briar_user_workflow_checkpoint_defaults",
        ]);

        await db.prepare(
          `insert into briar_run_stage_progress (
             run_id, attempt, revision, stage_id, state, started_at, finished_at
           ) values (?, 1, 1, 'implementing', 'completed', ?, ?)`,
        ).bind(migrationFixture.runId, migrationFixture.now, migrationFixture.now).run();
        await db.prepare(
          `insert into briar_run_checkpoint_progress (
             run_id, attempt, revision, checkpoint_key, stage_id,
             position, state, reached_at
           ) values (?, 1, 1, 'before-merge', 'implementing',
                     'after', 'waiting', ?)`,
        ).bind(migrationFixture.runId, migrationFixture.now).run();
        await expect(db.prepare(
          `insert into briar_run_checkpoint_progress (
             run_id, attempt, revision, checkpoint_key, stage_id,
             position, state, reached_at
           ) values (?, 1, 1, 'before-release', 'implementing',
                     'after', 'waiting', ?)`,
        ).bind(migrationFixture.runId, migrationFixture.now).run()).rejects.toThrow();
        await db.prepare(
          `insert into briar_run_checkpoint_progress (
             run_id, attempt, revision, checkpoint_key, stage_id,
             position, state
           ) values (?, 1, 1, 'before-release', 'implementing',
                     'after', 'pending')`,
        ).bind(migrationFixture.runId).run();

        await db.prepare(
          `insert into briar_user_workflow_checkpoint_defaults (
             project_id, user_id, created_at, updated_at
           ) values (?, ?, ?, ?)`,
        ).bind(
          migrationFixture.projectId,
          migrationFixture.userId,
          migrationFixture.now,
          migrationFixture.now,
        ).run();
        expect(await db.prepare(
          `select checkpoints_json, revision
           from briar_user_workflow_checkpoint_defaults
           where project_id = ? and user_id = ?`,
        ).bind(
          migrationFixture.projectId,
          migrationFixture.userId,
        ).first()).toEqual({ checkpoints_json: "[]", revision: 1 });

        await db.prepare(
          `update briar_hunt_runs
           set resume_requested_at = ?, assignee_user_id = 'migration-assignee'
           where id = ?`,
        ).bind("2026-08-10T00:10:00.000Z", migrationFixture.runId).run();
        await db.prepare(`delete from "user" where id = 'migration-assignee'`).run();
        expect(await db.prepare(
          `select paused_at, resume_requested_at, assignee_user_id
           from briar_hunt_runs where id = ?`,
        ).bind(migrationFixture.runId).first()).toEqual({
          paused_at: migrationFixture.pausedAt,
          resume_requested_at: "2026-08-10T00:10:00.000Z",
          assignee_user_id: null,
        });
        await expect(db.prepare(
          `update briar_hunt_runs set issue_checkpoints_json = '{}' where id = ?`,
        ).bind(migrationFixture.runId).run()).rejects.toThrow();
      },
    );
  }, 30_000);

  it("stores valid issue proposals without changing their source run", async () => {
    await withPreWorkflowMigrationDatabase(
      "briar-issue-proposal-migration-test",
      async (db) => {
        await seedPreWorkflowProjectRun(db);
        await applyD1Migrations(db, {
          files: ["0068_issue_action_proposals.sql"],
        });

        for (const [id, actionType, triggerId, replyId] of [
          ["proposal-update", "request_issue_update", "trigger-update", "reply-update"],
          ["proposal-create", "request_issue_create", "trigger-create", "reply-create"],
        ] as const) {
          await db.prepare(
            `insert into briar_issue_action_proposals (
               id, project_id, conversation_run_id, trigger_message_id,
               reply_message_id, action_type, payload_json,
               expected_run_updated_at, created_at, updated_at
             ) values (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
          ).bind(
            id,
            migrationFixture.projectId,
            migrationFixture.runId,
            triggerId,
            replyId,
            actionType,
            migrationFixture.now,
            migrationFixture.now,
            migrationFixture.now,
          ).run();
        }

        const proposals = await db.prepare(
          `select id, action_type, status from briar_issue_action_proposals
           order by id`,
        ).all<{ id: string; action_type: string; status: string }>();
        expect(proposals.results).toEqual([
          {
            id: "proposal-create",
            action_type: "request_issue_create",
            status: "pending",
          },
          {
            id: "proposal-update",
            action_type: "request_issue_update",
            status: "pending",
          },
        ]);
        await expect(db.prepare(
          `insert into briar_issue_action_proposals (
             id, project_id, conversation_run_id, trigger_message_id,
             reply_message_id, action_type, payload_json, created_at, updated_at
           ) values ('proposal-invalid', ?, ?, 'trigger-invalid', 'reply-invalid',
                     'delete_issue', '{}', ?, ?)`,
        ).bind(
          migrationFixture.projectId,
          migrationFixture.runId,
          migrationFixture.now,
          migrationFixture.now,
        ).run()).rejects.toThrow();
        expect(await db.prepare(
          `select workflow_snapshot_json, updated_at
           from briar_hunt_runs where id = ?`,
        ).bind(migrationFixture.runId).first()).toEqual({
          workflow_snapshot_json: migrationFixture.workflow,
          updated_at: migrationFixture.now,
        });
      },
    );
  }, 30_000);

  it("leaves already-canonical workflow snapshots stable", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-workflow-v2-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await db
        .prepare(
          `create table briar_project_settings (
             project_id text primary key,
             workflow_json text not null,
             mandatory_checkpoints_json text,
             updated_at text not null
           )`,
        )
        .run();
      await db
        .prepare(
          `create table briar_hunt_runs (
             id text primary key,
             workflow_snapshot_json text not null,
             updated_at text not null
           )`,
        )
        .run();
      const workflow = (checkpointStage?: string) => JSON.stringify({
        version: 2,
        requirements: [],
        stages: [
          { id: "implementing", label: "Implement", required: true },
          { id: "merged", label: "Merge", required: true },
        ],
        execution: {
          checkpoints: checkpointStage
            ? [{
                key: `project-after-${checkpointStage}`,
                stage: checkpointStage,
                position: "after",
              }]
            : [],
        },
        completion: { requiredStages: ["implementing", "merged"] },
      });
      const explicitCheckpoint = JSON.stringify([
        { key: "project-before-merged", stage: "merged", position: "before" },
      ]);
      const alreadyV2 = JSON.stringify({
        version: 2,
        requirements: [],
        stages: [{ id: "implementing", label: "Implement", required: true }],
        execution: { checkpoints: [] },
        completion: { requiredStages: ["implementing"] },
      });
      for (const row of [
        ["lazy", workflow("merged"), null],
        ["explicit-empty", workflow("merged"), "[]"],
        ["explicit-checkpoint", workflow("implementing"), explicitCheckpoint],
        ["fallback", workflow(), null],
        ["implementing-checkpoint", workflow("implementing"), null],
        ["already-v2", alreadyV2, "[]"],
      ] as const) {
        await db
          .prepare(
            `insert into briar_project_settings (
               project_id, workflow_json, mandatory_checkpoints_json, updated_at
             ) values (?, ?, ?, '2026-08-06T00:00:00.000Z')`,
          )
          .bind(...row)
          .run();
      }
      for (const row of [
        ["run-checkpoint", workflow("implementing")],
        ["run-empty", workflow()],
        ["run-v2", alreadyV2],
      ] as const) {
        await db
          .prepare(
            `insert into briar_hunt_runs (
               id, workflow_snapshot_json, updated_at
             ) values (?, ?, '2026-08-06T00:00:00.000Z')`,
          )
          .bind(...row)
          .run();
      }

      const sql = await readFile(
        resolve("migrations", "0066_normalize_project_workflows_v2.sql"),
        "utf8",
      );
      await executeD1Sql(db, sql);
      const firstPass = await db
        .prepare(
          `select project_id, workflow_json, updated_at
           from briar_project_settings order by project_id`,
        )
        .all<{ project_id: string; workflow_json: string; updated_at: string }>();
      const byProject = new Map(
        firstPass.results.map((row) => [row.project_id, JSON.parse(row.workflow_json)]),
      );

      expect(byProject.get("lazy")).toMatchObject({
        version: 2,
        requirements: [],
        execution: {
          checkpoints: [{
            key: "project-after-merged",
            stage: "merged",
            position: "after",
          }],
        },
      });
      expect(byProject.get("explicit-empty")?.execution.checkpoints).toEqual([{
        key: "project-after-merged",
        stage: "merged",
        position: "after",
      }]);
      expect(byProject.get("explicit-checkpoint")?.execution.checkpoints).toEqual(
        [{
          key: "project-after-implementing",
          stage: "implementing",
          position: "after",
        }],
      );
      expect(byProject.get("fallback")?.execution.checkpoints).toEqual([]);
      expect(byProject.get("implementing-checkpoint")?.execution.checkpoints).toEqual([{
        key: "project-after-implementing",
        stage: "implementing",
        position: "after",
      }]);
      expect(
        firstPass.results.find((row) => row.project_id === "already-v2")?.workflow_json,
      ).toBe(alreadyV2);
      expect(firstPass.results.every(
        (row) => row.updated_at === "2026-08-06T00:00:00.000Z",
      )).toBe(true);
      const firstRunPass = await db
        .prepare(
          `select id, workflow_snapshot_json, updated_at
           from briar_hunt_runs order by id`,
        )
        .all<{ id: string; workflow_snapshot_json: string; updated_at: string }>();
      const byRun = new Map(
        firstRunPass.results.map((row) => [
          row.id,
          JSON.parse(row.workflow_snapshot_json),
        ]),
      );
      expect(byRun.get("run-checkpoint")).toMatchObject({
        version: 2,
        requirements: [],
        execution: {
          checkpoints: [{
            key: "project-after-implementing",
            stage: "implementing",
            position: "after",
          }],
        },
      });
      expect(byRun.get("run-empty")?.execution.checkpoints).toEqual([]);
      expect(
        firstRunPass.results.find((row) => row.id === "run-v2")
          ?.workflow_snapshot_json,
      ).toBe(alreadyV2);
      expect(firstRunPass.results.every(
        (row) => row.updated_at === "2026-08-06T00:00:00.000Z",
      )).toBe(true);

      await executeD1Sql(db, sql);
      const secondPass = await db
        .prepare(
          `select project_id, workflow_json, updated_at
           from briar_project_settings order by project_id`,
        )
        .all<{ project_id: string; workflow_json: string; updated_at: string }>();
      expect(secondPass.results).toEqual(firstPass.results);
      const secondRunPass = await db
        .prepare(
          `select id, workflow_snapshot_json, updated_at
           from briar_hunt_runs order by id`,
        )
        .all<{ id: string; workflow_snapshot_json: string; updated_at: string }>();
      expect(secondRunPass.results).toEqual(firstRunPass.results);
    } finally {
      await miniflare.dispose();
    }
  });

  it("scopes inbox read state by account and cascades deleted accounts", async () => {
    await withPreWorkflowMigrationDatabase(
      "briar-inbox-read-state-migration-test",
      async (db) => {
        await seedPreWorkflowProjectRun(db);
        await db.prepare(
          `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
           values ('migration-reader', 'Reader', 'reader@example.com', 1, ?, ?)`,
        ).bind(migrationFixture.now, migrationFixture.now).run();
        await applyD1Migrations(db, {
          files: ["0063_inbox_read_states.sql"],
        });

        for (const row of [
          [migrationFixture.userId, "message-1", "version-owner"],
          [migrationFixture.userId, "message-2", "version-owner-2"],
          ["migration-reader", "message-1", "version-reader"],
        ] as const) {
          await db.prepare(
            `insert into briar_inbox_read_states (
               user_id, message_id, version, updated_at
             ) values (?, ?, ?, ?)`,
          ).bind(...row, migrationFixture.now).run();
        }
        await expect(db.prepare(
          `insert into briar_inbox_read_states (
             user_id, message_id, version, updated_at
           ) values (?, 'message-1', 'duplicate', ?)`,
        ).bind(migrationFixture.userId, migrationFixture.now).run()).rejects.toThrow();

        expect(await db.prepare(
          `select name from sqlite_master
           where type = 'index'
             and name = 'briar_inbox_read_states_user_updated_idx'`,
        ).first("name")).toBe("briar_inbox_read_states_user_updated_idx");
        await db.prepare(`delete from "user" where id = ?`)
          .bind(migrationFixture.userId).run();
        const remaining = await db.prepare(
          `select user_id, message_id, version from briar_inbox_read_states`,
        ).all();
        expect(remaining.results).toEqual([{
          user_id: "migration-reader",
          message_id: "message-1",
          version: "version-reader",
        }]);
      },
    );
  }, 30_000);

  it("normalizes terminal session summaries and their read state", async () => {
    const miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-inbox-session-version-migration-test" },
    });
    try {
      const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
      await db.prepare(
        `create table briar_project_agent_session_summaries (
           project_id text not null,
           session_id text not null,
           summary_json text not null,
           updated_at text not null,
           archived integer not null default 0,
           primary key (project_id, session_id)
         )`,
      ).run();
      await db.prepare(
        `create table briar_inbox_read_states (
           user_id text not null,
           message_id text not null,
           version text not null,
           updated_at text not null,
           primary key (user_id, message_id)
         )`,
      ).run();
      const completedAt = "2026-08-01T12:22:38.913Z";
      await db.prepare(
        `insert into briar_project_agent_session_summaries (
           project_id, session_id, summary_json, updated_at, archived
         ) values ('project-1', 'session-1', ?, ?, 0)`,
      ).bind(JSON.stringify({
        status: "failed",
        startedAt: "2026-08-01T12:00:00.000Z",
        completedAt,
        inboxVersion: "legacy-terminal-event-id",
      }), completedAt).run();
      await db.prepare(
        `insert into briar_inbox_read_states (
           user_id, message_id, version, updated_at
         ) values ('user-1', 'session:session-1', 'legacy-terminal-event-id', ?)`,
      ).bind(completedAt).run();

      const sql = await readFile(
        resolve("migrations/0094_canonical_inbox_session_versions.sql"),
        "utf8",
      );
      await executeD1Sql(db, sql);
      await executeD1Sql(db, sql);

      const expectedVersion = `session:v1:failed:${completedAt}`;
      const summary = await db.prepare(
        `select summary_json
         from briar_project_agent_session_summaries
         where session_id = 'session-1'`,
      ).first<{ summary_json: string }>();
      expect(JSON.parse(summary!.summary_json).inboxVersion)
        .toBe(expectedVersion);
      expect(await db.prepare(
        `select version from briar_inbox_read_states
         where message_id = 'session:session-1'`,
      ).first("version")).toBe(expectedVersion);
    } finally {
      await miniflare.dispose();
    }
  });

  it("migrates GitHub identity storage without backfilling URL-only evidence", async () => {
    await withPreWorkflowMigrationDatabase(
      "briar-github-storage-migration-test",
      async (db) => {
        await seedPreWorkflowProjectRun(db);
        await db.prepare(
          `insert into briar_run_evidence (
             id, project_id, run_id, attempt, revision, evidence_key,
             workflow_stage, evidence_type, status, url, actor,
             observed_at, recorded_at
           ) values ('migration-evidence', ?, ?, 1, 1, 'legacy-pr',
                     'pr_open', 'pull_request', 'passed',
                     'https://github.com/example/repository/pull/1',
                     'migration', ?, ?)`,
        ).bind(
          migrationFixture.projectId,
          migrationFixture.runId,
          migrationFixture.now,
          migrationFixture.now,
        ).run();
        await applyD1Migrations(db, {
          files: [
            "0063_github_pull_request_sync.sql",
            "0064_github_integration.sql",
          ],
        });

        expect(await db.prepare(
          `select id, url, github_association_started_at
           from briar_run_evidence where id = 'migration-evidence'`,
        ).first()).toEqual({
          id: "migration-evidence",
          url: "https://github.com/example/repository/pull/1",
          github_association_started_at: null,
        });
        expect(await db.prepare(
          `select count(*) as count from briar_run_pull_requests`,
        ).first<number>("count")).toBe(0);

        await db.prepare(
          `insert into briar_github_deliveries (
             delivery_id, event_name, action, status, claimed_at
           ) values ('delivery-1', 'pull_request', 'opened', 'processing', ?)`,
        ).bind(migrationFixture.now).run();
        await expect(db.prepare(
          `insert into briar_github_deliveries (
             delivery_id, event_name, status, claimed_at
           ) values ('delivery-1', 'pull_request', 'processing', ?)`,
        ).bind(migrationFixture.now).run()).rejects.toThrow();
        await db.prepare(
          `update briar_github_deliveries
           set status = 'completed', completed_at = ?
           where delivery_id = 'delivery-1'`,
        ).bind(migrationFixture.now).run();

        const sharedUrl = "https://github.com/example/repository/pull/1";
        for (const [repositoryId, pullRequestId, repository] of [
          [101, 1001, "example/repository"],
          [102, 1002, "example/recreated-repository"],
        ] as const) {
          await db.prepare(
            `insert into briar_github_pull_requests (
               repository_id, pull_request_number, repository,
               pull_request_id, pull_request_node_id, url, state, draft,
               head_sha, base_sha, opened_at, provider_updated_at,
               last_delivery_id, briar_issue_links_json, created_at, updated_at
             ) values (?, 1, ?, ?, ?, ?, 'open', 0,
                       'abcdef1', '1234567', ?, ?, 'delivery-1', '[]', ?, ?)`,
          ).bind(
            repositoryId,
            repository,
            pullRequestId,
            `PR_${pullRequestId}`,
            sharedUrl,
            migrationFixture.now,
            migrationFixture.now,
            migrationFixture.now,
            migrationFixture.now,
          ).run();
        }
        expect(await db.prepare(
          `select count(*) as count from briar_github_pull_requests
           where url = ?`,
        ).bind(sharedUrl).first<number>("count")).toBe(2);

        for (const revision of [1, 2]) {
          await db.prepare(
            `insert into briar_run_pull_requests (
               project_id, run_id, attempt, revision, revision_started_at,
               url, repository_id, repository, pull_request_id,
               pull_request_node_id, pull_request_number, created_at, updated_at
             ) values (?, ?, 1, ?, ?, ?, 101, 'example/repository',
                       1001, 'PR_1001', 1, ?, ?)`,
          ).bind(
            migrationFixture.projectId,
            migrationFixture.runId,
            revision,
            migrationFixture.now,
            sharedUrl,
            migrationFixture.now,
            migrationFixture.now,
          ).run();
        }
        await expect(db.prepare(
          `insert into briar_run_pull_requests (
             project_id, run_id, attempt, revision, revision_started_at,
             url, repository_id, repository, pull_request_id,
             pull_request_node_id, pull_request_number, created_at, updated_at
           ) values (?, ?, 1, 2, ?, ?, 101, 'example/repository',
                     1001, 'PR_1001', 1, ?, ?)`,
        ).bind(
          migrationFixture.projectId,
          migrationFixture.runId,
          migrationFixture.now,
          sharedUrl,
          migrationFixture.now,
          migrationFixture.now,
        ).run()).rejects.toThrow();

        await db.prepare(
          `insert into briar_github_connections (
             installation_id, organization_id, installation_account_id,
             account_login, account_avatar_url, authorized_github_user_id,
             authorized_github_user_login, connected_by_user_id, status,
             connected_at, updated_at
           ) values (501, ?, 601, 'example', 'https://example.com/avatar.png',
                     701, 'migration-user', ?, 'connected', ?, ?)`,
        ).bind(
          migrationFixture.organizationId,
          migrationFixture.userId,
          migrationFixture.now,
          migrationFixture.now,
        ).run();
        await db.prepare(
          `insert into briar_github_oauth_states (
             state_hash, organization_id, user_id, pkce_verifier,
             installation_id, expires_at, created_at, updated_at
           ) values (?, ?, ?, ?, 501, ?, ?, ?)`,
        ).bind(
          "b".repeat(64),
          migrationFixture.organizationId,
          migrationFixture.userId,
          "c".repeat(43),
          "2026-08-10T01:00:00.000Z",
          migrationFixture.now,
          migrationFixture.now,
        ).run();
        await expect(db.prepare(
          `insert into briar_github_connections (
             installation_id, organization_id, installation_account_id,
             account_login, account_avatar_url, authorized_github_user_id,
             authorized_github_user_login, status, connected_at, updated_at
           ) values (502, ?, 602, 'other', 'https://example.com/other.png',
                     702, 'other-user', 'connected', ?, ?)`,
        ).bind(
          migrationFixture.organizationId,
          migrationFixture.now,
          migrationFixture.now,
        ).run()).rejects.toThrow();

        const connectionColumns = await db.prepare(
          `pragma table_info(briar_github_connections)`,
        ).all<{ name: string }>();
        const oauthColumns = await db.prepare(
          `pragma table_info(briar_github_oauth_states)`,
        ).all<{ name: string }>();
        const persistedColumnNames = [
          ...connectionColumns.results,
          ...oauthColumns.results,
        ].map((column) => column.name);
        expect(persistedColumnNames).toContain("pkce_verifier");
        expect(persistedColumnNames.join("\n")).not.toMatch(
          /(?:access|refresh)_?token/iu,
        );
      },
    );
  }, 30_000);
});
