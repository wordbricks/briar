import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

describe("channel issue proposal status migration", () => {
  it("backfills queued proposals and rejects the obsolete value", async () => {
    const db = env.DB;
    const now = "2026-08-31T00:00:00.000Z";
    await applyD1Migrations(db, {
      through: "0155_archive_format_v2.sql",
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
    `);

    const insertProposal = (id: string, status: "backlog" | "queued") =>
      db.prepare(
        `insert into briar_channel_action_proposals (
           id, channel_id, project_id, trigger_message_id, reply_message_id,
           action_type, payload_json, created_at, updated_at
         ) values (?, 'proposal-channel', 'proposal-project', ?, ?,
                   'request_issue_create', ?, ?, ?)`,
      ).bind(
        id,
        `${id}-trigger`,
        `${id}-reply`,
        JSON.stringify({
          issue: {
            title: "Canonical proposal",
            description: null,
            priority: 2,
            status,
          },
        }),
        now,
        now,
      ).run();

    const insertBatchProposal = (
      id: string,
      statuses: readonly ("backlog" | "queued")[],
    ) => db.prepare(
      `insert into briar_channel_action_proposals (
         id, channel_id, project_id, trigger_message_id, reply_message_id,
         action_type, payload_json, created_at, updated_at
       ) values (?, 'proposal-channel', 'proposal-project', ?, ?,
                 'request_issue_create', ?, ?, ?)`,
    ).bind(
      id,
      `${id}-trigger`,
      `${id}-reply`,
      JSON.stringify({
        batch: {
          items: statuses.map((status, index) => ({
            issue: {
              title: `Canonical proposal ${index + 1}`,
              description: null,
              priority: 2,
              status,
            },
          })),
        },
      }),
      now,
      now,
    ).run();

    await insertProposal("queued-proposal", "queued");
    await insertBatchProposal("queued-batch", ["queued", "backlog"]);
    await applyD1Migrations(db, {
      files: ["0156_canonical_channel_issue_proposal_status.sql"],
    });

    expect(await db.prepare(
      `select json_extract(payload_json, '$.issue.status') as status
       from briar_channel_action_proposals where id = 'queued-proposal'`,
    ).first()).toEqual({ status: "backlog" });
    expect((await db.prepare(
      `select item.value ->> '$.issue.status' as status
       from briar_channel_action_proposals proposal,
            json_each(proposal.payload_json, '$.batch.items') item
       where proposal.id = 'queued-batch'
       order by item.key`,
    ).all()).results).toEqual([
      { status: "backlog" },
      { status: "backlog" },
    ]);
    await expect(insertProposal("rejected-proposal", "queued"))
      .rejects.toThrow(/status must be backlog/iu);
    await expect(insertBatchProposal("rejected-batch", ["backlog", "queued"]))
      .rejects.toThrow(/status must be backlog/iu);
    await expect(insertProposal("backlog-proposal", "backlog"))
      .resolves.toBeDefined();
    await expect(insertBatchProposal("backlog-batch", ["backlog", "backlog"]))
      .resolves.toBeDefined();
  });
});
