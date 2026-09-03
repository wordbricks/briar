import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

describe("issue proposal payload migration", () => {
  it("removes placement status and enforces the status-free stored shape", async () => {
    const db = env.DB;
    const now = "2026-08-31T00:00:00.000Z";
    await applyD1Migrations(db, {
      through: "0162_canonical_archive_storage.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values (
        'proposal-owner', 'Proposal Owner', 'proposal@example.com', 1,
        '${now}', '${now}'
      );
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'proposal-org', 'Proposal Org', 'proposal-org', '${now}', '${now}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        'proposal-org', 'proposal-owner', 'owner', '${now}', '${now}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        'proposal-project', 'proposal-owner', 'proposal-org',
        'Proposal Project', '${"a".repeat(64)}', '${now}', '${now}'
      );
      insert into briar_project_settings (
        project_id, workflow_json, mandatory_checkpoints_json,
        created_at, updated_at
      ) values (
        'proposal-project',
        '{"version":2,"requirements":[],"stages":[{"id":"implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["implementing"]}}',
        '[]', '${now}', '${now}'
      );
      insert into briar_channels (
        id, organization_id, slug, name, topic, visibility,
        default_project_id, created_by_user_id, created_at, updated_at
      ) values (
        'proposal-channel', 'proposal-org', 'proposals', 'Proposals', null,
        'public', 'proposal-project', 'proposal-owner', '${now}', '${now}'
      );
      insert into briar_channel_members (
        channel_id, user_id, role, created_at
      ) values (
        'proposal-channel', 'proposal-owner', 'owner', '${now}'
      );
      insert into briar_hunt_runs (
        id, project_id, source, source_key, title, stage, status,
        workflow_snapshot_json, repository, context_json,
        started_at, last_event_at, created_at, updated_at
      ) values (
        'proposal-conversation-run', 'proposal-project', 'issue',
        'proposal-conversation', 'Proposal conversation', 'queued', 'backlog',
        '{"version":2,"requirements":[],"stages":[{"id":"implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["implementing"]}}',
        'Proposal Project', '{}', '${now}', '${now}', '${now}', '${now}'
      );
    `);
    const conversationRunId = "proposal-conversation-run";

    const channelProposal = (id: string, payload: unknown) => db.prepare(
      `insert into briar_channel_action_proposals (
         id, channel_id, project_id, trigger_message_id, reply_message_id,
         action_type, payload_json, created_at, updated_at
       ) values (?, 'proposal-channel', 'proposal-project', ?, ?,
                 'request_issue_create', ?, ?, ?)`,
    ).bind(
      id,
      `${id}-trigger`,
      `${id}-reply`,
      JSON.stringify(payload),
      now,
      now,
    ).run();
    const conversationProposal = (id: string, payload: unknown) => db.prepare(
      `insert into briar_issue_action_proposals (
         id, project_id, conversation_run_id, trigger_message_id,
         reply_message_id, action_type, payload_json, created_at, updated_at
       ) values (?, 'proposal-project', ?, ?, ?, 'request_issue_create', ?, ?, ?)`,
    ).bind(
      id,
      conversationRunId,
      `${id}-trigger`,
      `${id}-reply`,
      JSON.stringify(payload),
      now,
      now,
    ).run();
    const legacyIssue = (title: string) => ({
      title,
      description: null,
      priority: 2,
      status: "queued",
    });

    await channelProposal("legacy-channel", {
      issue: legacyIssue("Legacy channel issue"),
    });
    await channelProposal("legacy-batch", {
      batch: {
        items: [
          { key: "api", issue: legacyIssue("Legacy API issue") },
          { key: "ui", issue: legacyIssue("Legacy UI issue") },
        ],
        dependencies: [{ prerequisiteKey: "api", dependentKey: "ui" }],
      },
    });
    await conversationProposal("legacy-conversation", {
      issue: legacyIssue("Legacy conversation issue"),
    });
    await db.prepare(
      `insert into briar_channel_action_proposals (
         id, channel_id, project_id, trigger_message_id, reply_message_id,
         action_type, payload_json, created_at, updated_at
       ) values (
         'legacy-plan', 'proposal-channel', null, 'legacy-plan-trigger',
         'legacy-plan-reply', 'request_plan_document', '{}', ?, ?
       )`,
    ).bind(now, now).run();
    await db.prepare(
      `insert into briar_channel_issue_batch_items (
         organization_id, channel_id, proposal_id, project_id, local_key,
         position, source_key, run_id, created_at
       ) values (
         'proposal-org', 'proposal-channel', 'legacy-plan',
         'proposal-project', 'orphan', 0, 'legacy-plan:orphan',
         '00000000-0000-4000-8000-000000000160', ?
       )`,
    ).bind(now).run();

    await applyD1Migrations(db, {
      files: ["0163_remove_issue_proposal_status.sql"],
    });

    expect(await db.prepare(
      `select json_type(payload_json, '$.issue.status') as status_type
       from briar_channel_action_proposals where id = 'legacy-channel'`,
    ).first()).toEqual({ status_type: null });
    expect((await db.prepare(
      `select json_type(item.value, '$.issue.status') as status_type
       from briar_channel_action_proposals proposal,
            json_each(proposal.payload_json, '$.batch.items') item
       where proposal.id = 'legacy-batch'
       order by item.key`,
    ).all()).results).toEqual([
      { status_type: null },
      { status_type: null },
    ]);
    expect(await db.prepare(
      `select json_type(payload_json, '$.issue.status') as status_type
       from briar_issue_action_proposals where id = 'legacy-conversation'`,
    ).first()).toEqual({ status_type: null });

    const currentIssue = (title: string) => ({
      title,
      description: null,
      priority: 2,
    });
    await expect(channelProposal("current-channel", {
      issue: currentIssue("Current channel issue"),
    })).resolves.toBeDefined();
    await expect(channelProposal("current-batch", {
      batch: {
        items: [{ key: "api", issue: currentIssue("Current API issue") }],
        dependencies: [],
      },
    })).resolves.toBeDefined();
    await expect(conversationProposal("current-conversation", {
      issue: currentIssue("Current conversation issue"),
    })).resolves.toBeDefined();

    await expect(channelProposal("rejected-channel", {
      issue: { ...currentIssue("Rejected channel issue"), status: "backlog" },
    })).rejects.toThrow(/payload cannot include status/iu);
    await expect(channelProposal("rejected-batch", {
      batch: {
        items: [{
          key: "api",
          issue: { ...currentIssue("Rejected batch issue"), status: "backlog" },
        }],
        dependencies: [],
      },
    })).rejects.toThrow(/payload cannot include status/iu);
    await expect(conversationProposal("rejected-conversation", {
      issue: {
        ...currentIssue("Rejected conversation issue"),
        status: "backlog",
      },
    })).rejects.toThrow(/payload cannot include status/iu);

    expect(await db.prepare(
      `select count(*) as count from briar_channel_action_proposals
       where id = 'legacy-plan'`,
    ).first<number>("count")).toBe(0);
    expect(await db.prepare(
      `select count(*) as count from briar_channel_issue_batch_items
       where proposal_id = 'legacy-plan'`,
    ).first<number>("count")).toBe(0);
    expect(await db.prepare(
      `select count(*) as count from briar_channel_changes
       where entity_type = 'proposal' and entity_id = 'legacy-plan'`,
    ).first<number>("count")).toBe(0);
    expect(await db.prepare(
      `select count(*) as count from briar_channel_action_proposals
       where id = 'current-channel'`,
    ).first<number>("count")).toBe(1);
    await expect(db.prepare(
      `insert into briar_channel_action_proposals (
         id, channel_id, project_id, trigger_message_id, reply_message_id,
         action_type, payload_json, created_at, updated_at
       ) values (
         'rejected-plan', 'proposal-channel', null, 'rejected-plan-trigger',
         'rejected-plan-reply', 'request_plan_document', '{}', ?, ?
       )`,
    ).bind(now, now).run()).rejects.toThrow(
      /channel proposals must create issues/iu,
    );
    await expect(db.prepare(
      `update briar_channel_action_proposals
       set action_type = 'request_plan_document'
       where id = 'current-channel'`,
    ).run()).rejects.toThrow();
    expect((await db.prepare(`pragma foreign_key_check`).all()).results)
      .toEqual([]);
  });
});
