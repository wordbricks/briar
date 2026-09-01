import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { repositoryWorkflowBootstrap } from "../../src/lib/auto-hunt-contract";
import { isChannelApprovedIssue } from "./channel-issue-approval-repository";
import { recordHuntEvent } from "./hunt-event-repository";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

describe("channel approval authority cutover", () => {
  it("removes unverifiable authority without deleting visible issues", async () => {
    const db = env.DB;
    const now = "2026-09-01T00:00:00.000Z";
    await applyD1Migrations(db, {
      through: "0163_canonical_agent_execution_metrics_storage.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values (
        'approval-owner', 'Approval Owner', 'approval@example.com', 1,
        '${now}', '${now}'
      );
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'approval-org', 'Approval Org', 'approval-org', '${now}', '${now}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values
        (
          'approval-project-a', 'approval-owner', 'approval-org',
          'Approval Project A', '${"c".repeat(64)}', '${now}', '${now}'
        ),
        (
          'approval-project-b', 'approval-owner', 'approval-org',
          'Approval Project B', '${"d".repeat(64)}', '${now}', '${now}'
        );
      insert into briar_channels (
        id, organization_id, slug, name, default_project_id,
        created_by_user_id, created_at, updated_at
      ) values (
        'approval-channel', 'approval-org', 'approval', 'Approval',
        'approval-project-a', 'approval-owner', '${now}', '${now}'
      );
      drop trigger briar_hunt_runs_legacy_channel_proposal_guard;
      drop trigger briar_conversation_issue_creation_project_guard;
    `);

    const insertRun = db.prepare(
      `insert into briar_hunt_runs (
         id, project_id, source, source_key, title, stage, status,
         workflow_snapshot_json, repository, context_json,
         started_at, last_event_at, created_at, updated_at
       ) values (?, ?, 'issue', ?, ?, 'queued', ?, ?, 'briar/approval',
         '{}', ?, ?, ?, ?)`,
    );
    await db.batch([
      insertRun.bind(
        "atomic-run",
        "approval-project-a",
        "atomic-approved",
        "Atomic approved issue",
        "backlog",
        JSON.stringify(repositoryWorkflowBootstrap),
        now,
        now,
        now,
        now,
      ),
      insertRun.bind(
        "legacy-channel-run",
        "approval-project-a",
        "briar-channel-proposal:legacy",
        "Legacy channel issue",
        "cancelled",
        JSON.stringify(repositoryWorkflowBootstrap),
        now,
        now,
        now,
        now,
      ),
      insertRun.bind(
        "legacy-conversation-run",
        "approval-project-a",
        "briar-conversation-proposal:legacy",
        "Legacy conversation issue",
        "cancelled",
        JSON.stringify(repositoryWorkflowBootstrap),
        now,
        now,
        now,
        now,
      ),
    ]);

    await db.batch([
      db.prepare(
        `insert into briar_channel_action_proposals (
           id, channel_id, project_id, trigger_message_id, reply_message_id,
           action_type, payload_json, status, accepted_by_user_id, accepted_at,
           result_run_id, issue_source_key, created_at, updated_at
         ) values (
           'legacy-channel-proposal', 'approval-channel', 'approval-project-a',
           'legacy-channel-trigger', 'legacy-channel-reply',
           'request_issue_create', ?, 'accepted', 'approval-owner', ?,
           'legacy-channel-run', 'briar-channel-proposal:legacy', ?, ?
         )`,
      ).bind(
        JSON.stringify({
          issue: { title: "Legacy channel issue", description: null, priority: null },
        }),
        now,
        now,
        now,
      ),
      db.prepare(
        `insert into briar_issue_action_proposals (
           id, project_id, conversation_run_id, trigger_message_id,
           reply_message_id, action_type, payload_json, status,
           accepted_by_user_id, accepted_at, result_run_id, issue_source_key,
           created_at, updated_at
         ) values (
           'legacy-conversation-proposal', 'approval-project-a', 'atomic-run',
           'legacy-conversation-trigger', 'legacy-conversation-reply',
           'request_issue_create', ?, 'accepted', 'approval-owner', ?,
           'legacy-conversation-run', 'briar-conversation-proposal:legacy', ?, ?
         )`,
      ).bind(
        JSON.stringify({
          issue: {
            title: "Legacy conversation issue",
            description: null,
            priority: null,
          },
        }),
        now,
        now,
        now,
      ),
    ]);

    const insertAudit = db.prepare(
      `insert into briar_channel_issue_approval_audit (
         id, proposal_id, organization_id, channel_id, project_id, run_id,
         approved_by_user_id, approved_at, issue_source_key,
         result_verification, payload_json, created_at
       ) values (?, ?, 'approval-org', 'approval-channel',
         'approval-project-a', ?, 'approval-owner', ?, ?, ?, '{}', ?)`,
    );
    await db.batch([
      insertAudit.bind(
        "atomic-audit",
        "atomic-proposal",
        "atomic-run",
        now,
        "atomic-approved",
        "atomic",
        now,
      ),
      insertAudit.bind(
        "legacy-audit",
        "legacy-proposal",
        "legacy-channel-run",
        now,
        "briar-channel-proposal:legacy",
        "legacy_authorized",
        now,
      ),
      insertAudit.bind(
        "old-prefix-atomic-audit",
        "old-prefix-atomic-proposal",
        "legacy-conversation-run",
        now,
        "briar-conversation-proposal:legacy",
        "atomic",
        now,
      ),
      insertAudit.bind(
        "unverifiable-audit",
        "unverifiable-proposal",
        null,
        now,
        null,
        "unverifiable",
        now,
      ),
    ]);

    await applyD1Migrations(db, {
      files: ["0165_canonical_hunt_run_execution_policy.sql"],
    });

    await expect(db.prepare(
      `select id from briar_channel_issue_approval_audit order by id`,
    ).all()).resolves.toMatchObject({
      results: [{ id: "atomic-audit" }],
    });
    await expect(db.prepare(
      `select id from briar_hunt_runs order by id`,
    ).all()).resolves.toMatchObject({
      results: [
        { id: "atomic-run" },
        { id: "legacy-channel-run" },
        { id: "legacy-conversation-run" },
      ],
    });
    await expect(db.prepare(
      `select id from briar_channel_action_proposals
       where issue_source_key like 'briar-channel-proposal:%'
       union all
       select id from briar_issue_action_proposals
       where issue_source_key like 'briar-conversation-proposal:%'`,
    ).all()).resolves.toMatchObject({
      results: [
        { id: "legacy-channel-proposal" },
        { id: "legacy-conversation-proposal" },
      ],
    });
    await expect(isChannelApprovedIssue(db, {
      id: "atomic-run",
      source_key: "atomic-approved",
    })).resolves.toBe(true);
    await expect(isChannelApprovedIssue(db, {
      id: "legacy-channel-run",
      source_key: "briar-channel-proposal:legacy",
    })).resolves.toBe(false);
    await expect(isChannelApprovedIssue(db, {
      id: "legacy-conversation-run",
      source_key: "briar-conversation-proposal:legacy",
    })).resolves.toBe(false);

    await expect(insertAudit.bind(
      "future-legacy-audit",
      "future-legacy-proposal",
      "atomic-run",
      now,
      "atomic-approved",
      "legacy_authorized",
      now,
    ).run()).rejects.toThrow(/atomic verification/iu);
    await expect(db.prepare(
      `update briar_channel_issue_approval_audit
       set result_verification = 'legacy_authorized'
       where id = 'atomic-audit'`,
    ).run()).rejects.toThrow();

    await expect(recordHuntEvent(db, "approval-project-a", {
      source: "issue",
      sourceKey: "atomic-approved",
      title: "Atomic approved issue",
      stage: "queued",
      status: "queued",
      workflowStage: null,
      eventKey: "atomic-approved:unapproved-queue",
      occurredAt: "2026-09-01T00:01:00.000Z",
      actor: "project-agent",
      repository: "briar/approval",
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
    })).rejects.toThrow("explicit dispatch");
    await expect(db.prepare(
      `select status from briar_hunt_runs where id = 'atomic-run'`,
    ).first()).resolves.toEqual({ status: "backlog" });

    const insertRetiredNamespaceRun = db.prepare(
      `insert into briar_hunt_runs (
         id, project_id, source, source_key, title, stage, status,
         workflow_snapshot_json, repository, context_json,
         started_at, last_event_at, created_at, updated_at
       ) values (?, ?, 'issue', ?, ?,
         'queued', 'queued', ?, 'briar/approval', '{}', ?, ?, ?, ?)`,
    );
    await expect(db.batch([
      insertRetiredNamespaceRun.bind(
        "ordinary-old-prefix-a",
        "approval-project-a",
        "briar-channel-proposal:ordinary",
        "Ordinary issue A",
        JSON.stringify(repositoryWorkflowBootstrap),
        now,
        now,
        now,
        now,
      ),
      insertRetiredNamespaceRun.bind(
        "ordinary-old-prefix-b",
        "approval-project-b",
        "briar-channel-proposal:ordinary",
        "Ordinary issue B",
        JSON.stringify(repositoryWorkflowBootstrap),
        now,
        now,
        now,
        now,
      ),
      insertRetiredNamespaceRun.bind(
        "ordinary-old-conversation-prefix-a",
        "approval-project-a",
        "briar-conversation-proposal:ordinary",
        "Ordinary conversation issue A",
        JSON.stringify(repositoryWorkflowBootstrap),
        now,
        now,
        now,
        now,
      ),
      insertRetiredNamespaceRun.bind(
        "ordinary-old-conversation-prefix-b",
        "approval-project-b",
        "briar-conversation-proposal:ordinary",
        "Ordinary conversation issue B",
        JSON.stringify(repositoryWorkflowBootstrap),
        now,
        now,
        now,
        now,
      ),
    ])).resolves.toHaveLength(4);
  });
});
