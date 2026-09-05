import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

const now = "2026-09-06T00:00:00.000Z";

/*
  The schema stops just before 0201 so the fixture is written with plain
  inserts rather than through the production repository functions, which read
  rows back with catalog queries this migration has not reshaped yet.
*/
const seedOrganization = async (db: D1Database) => {
  await executeD1Sql(db, `
    insert into "user" (
      id, name, email, emailVerified, createdAt, updatedAt
    ) values (
      'relay-owner', 'Relay Owner', 'relay@example.com', 1, '${now}', '${now}'
    );
    insert into briar_organizations (
      id, name, handle, created_at, updated_at
    ) values (
      'relay-org', 'Relay Org', 'relay-org', '${now}', '${now}'
    );
    insert into briar_organization_members (
      organization_id, user_id, role, created_at, updated_at
    ) values (
      'relay-org', 'relay-owner', 'owner', '${now}', '${now}'
    );
    insert into briar_projects (
      id, owner_user_id, organization_id, name, agent_token_hash,
      created_at, updated_at
    ) values (
      'relay-project', 'relay-owner', 'relay-org', 'Relay Project',
      '${"e".repeat(64)}', '${now}', '${now}'
    );
    insert into briar_project_agents (
      id, project_id, organization_id, name, responsibility, provider,
      created_at, updated_at
    ) values
      (
        'relay-agent-a', null, 'relay-org', 'Agent A', 'Talks to people',
        'codex', '${now}', '${now}'
      ),
      (
        'relay-agent-b', 'relay-project', 'relay-org', 'Agent B',
        'Reads the repository', 'codex', '${now}', '${now}'
      );
  `);
};

/*
  Two conversations: the person's thread with A, and the Agent-to-Agent DM
  where A and B talk. `agents:` is the dm_key prefix the unique direct-message
  index already enforces one row per pair for.
*/
const seedChannels = async (db: D1Database) => {
  await executeD1Sql(db, `
    insert into briar_channels (
      id, organization_id, kind, dm_key, slug, name, topic, visibility,
      default_project_id, created_by_user_id, created_at, updated_at
    ) values
      (
        'relay-thread', 'relay-org', 'dm', 'agent:["relay-owner","relay-agent-a"]',
        'relay-thread', 'Agent A', null, 'private', null, 'relay-owner',
        '${now}', '${now}'
      ),
      (
        'relay-peer-dm', 'relay-org', 'dm',
        'agents:["relay-agent-a","relay-agent-b"]', 'relay-peer-dm',
        'Agent A, Agent B', null, 'private', null, null, '${now}', '${now}'
      );
    insert into briar_channel_members (
      channel_id, user_id, role, created_at
    ) values (
      'relay-thread', 'relay-owner', 'owner', '${now}'
    );
    insert into briar_channel_agents (
      channel_id, agent_id, created_at
    ) values
      ('relay-thread', 'relay-agent-a', '${now}'),
      ('relay-peer-dm', 'relay-agent-a', '${now}'),
      ('relay-peer-dm', 'relay-agent-b', '${now}');
    insert into briar_channel_messages (
      id, channel_id, parent_message_id, author_user_id, author_agent_id,
      author_agent_name, body, created_at, updated_at
    ) values
      (
        'relay-trigger', 'relay-thread', null, 'relay-owner', null, null,
        'Ask B to check the ticker', '${now}', '${now}'
      ),
      (
        'relay-reply', 'relay-thread', null, null, 'relay-agent-a', 'Agent A',
        'On it', '${now}', '${now}'
      ),
      (
        'relay-notice', 'relay-thread', null, null, 'relay-agent-a', 'Agent A',
        'Sent to Agent B', '${now}', '${now}'
      ),
      (
        'relay-peer-request', 'relay-peer-dm', null, null, 'relay-agent-a',
        'Agent A', 'Please check the ticker', '${now}', '${now}'
      ),
      (
        'relay-peer-answer', 'relay-peer-dm', null, null, 'relay-agent-b',
        'Agent B', 'Checked, nothing new', '${now}', '${now}'
      );
  `);
};

const insertOriginJob = (db: D1Database) =>
  executeD1Sql(db, `
    insert into briar_channel_agent_reply_jobs (
      id, organization_id, channel_id, project_id, agent_id,
      trigger_message_id, parent_message_id, reply_message_id, status,
      agent_provider, created_at, updated_at
    ) values (
      'relay-origin-job', 'relay-org', 'relay-thread', null, 'relay-agent-a',
      'relay-trigger', 'relay-trigger', 'relay-reply', 'completed', 'codex',
      '${now}', '${now}'
    );
  `);

describe("Agent message relay migration", () => {
  it("adds the hop columns, guards them and cascades relay rows", async () => {
    const db = env.DB;
    await applyD1Migrations(db, {
      through: "0200_channel_sidebar_preferences.sql",
    });
    await seedOrganization(db);
    await seedChannels(db);
    await insertOriginJob(db);

    await applyD1Migrations(db, {
      files: ["0201_agent_message_relays.sql"],
    });

    // An existing job predates the feature, so it reads back as hop 0 with no
    // origin: the round-trip columns default to "not part of one".
    expect(await db.prepare(
      `select agent_message_hop, origin_reply_job_id
       from briar_channel_agent_reply_jobs where id = 'relay-origin-job'`,
    ).first()).toEqual({
      agent_message_hop: 0,
      origin_reply_job_id: null,
    });

    const insertHopJob = (
      id: string,
      columns: {
        hop: number;
        originReplyJobId: string | null;
        delegatedByReplyJobId?: string | null;
        delegationRequest?: string | null;
      },
    ) =>
      db.prepare(
        `insert into briar_channel_agent_reply_jobs (
           id, organization_id, channel_id, project_id, agent_id,
           trigger_message_id, parent_message_id, reply_message_id, status,
           agent_provider, created_at, updated_at, agent_message_hop,
           origin_reply_job_id, delegated_by_reply_job_id, delegation_request
         ) values (
           ?, 'relay-org', 'relay-peer-dm', 'relay-project', 'relay-agent-b',
           'relay-peer-request', 'relay-peer-request', ?, 'queued', 'codex',
           '${now}', '${now}', ?, ?, ?, ?
         )`,
      ).bind(
        id,
        `${id}-message`,
        columns.hop,
        columns.originReplyJobId,
        columns.delegatedByReplyJobId ?? null,
        columns.delegationRequest ?? null,
      ).run();

    // A job is either a delegation child inside one thread or a hop of an
    // Agent-to-Agent round trip; the two provenance paths never mix.
    await expect(insertHopJob("relay-hop-delegated", {
      hop: 1,
      originReplyJobId: "relay-origin-job",
      delegatedByReplyJobId: "relay-origin-job",
      delegationRequest: "Check the ticker",
    })).rejects.toThrow(
      /delegated reply cannot carry an Agent message hop/u,
    );

    // A hop without its origin would be unreachable for cancellation, the
    // progress indicator and the hourly cap.
    await expect(insertHopJob("relay-hop-orphan", {
      hop: 1,
      originReplyJobId: null,
    })).rejects.toThrow(/Agent message hop requires an origin reply job/u);

    await insertHopJob("relay-hop-job", {
      hop: 1,
      originReplyJobId: "relay-origin-job",
    });
    expect(await db.prepare(
      `select agent_message_hop, origin_reply_job_id
       from briar_channel_agent_reply_jobs where id = 'relay-hop-job'`,
    ).first()).toEqual({
      agent_message_hop: 1,
      origin_reply_job_id: "relay-origin-job",
    });

    // The same guards apply to an update, so a job cannot be turned into a
    // delegated hop or stripped of its origin after the fact.
    await expect(db.prepare(
      `update briar_channel_agent_reply_jobs
       set origin_reply_job_id = null where id = 'relay-hop-job'`,
    ).run()).rejects.toThrow(
      /Agent message hop requires an origin reply job/u,
    );
    await expect(db.prepare(
      `update briar_channel_agent_reply_jobs
       set delegated_by_reply_job_id = 'relay-origin-job',
           delegation_request = 'Check the ticker'
       where id = 'relay-hop-job'`,
    ).run()).rejects.toThrow(
      /delegated reply cannot carry an Agent message hop/u,
    );
    // Hop 3 has no meaning: the round trip stops at the sender's relay turn.
    await expect(db.prepare(
      `update briar_channel_agent_reply_jobs
       set agent_message_hop = 3 where id = 'relay-hop-job'`,
    ).run()).rejects.toThrow();

    await executeD1Sql(db, `
      insert into briar_channel_message_relays (
        message_id, direction, peer_channel_id, peer_message_id,
        origin_reply_job_id, created_at
      ) values
        (
          'relay-notice', 'outbound', 'relay-peer-dm', 'relay-peer-request',
          'relay-origin-job', '${now}'
        );
    `);
    await expect(db.prepare(
      `insert into briar_channel_message_relays (
         message_id, direction, peer_channel_id, peer_message_id,
         origin_reply_job_id, created_at
       ) values (
         'relay-reply', 'sideways', 'relay-peer-dm', 'relay-peer-answer',
         'relay-origin-job', '${now}'
       )`,
    ).run()).rejects.toThrow();

    // Deleting the Agent-to-Agent side removes the thread-side link with it,
    // so no relay can point at a message that is gone.
    await executeD1Sql(db, `
      delete from briar_channel_messages where id = 'relay-peer-request';
    `);
    expect(await db.prepare(
      "select count(*) as count from briar_channel_message_relays",
    ).first()).toEqual({ count: 0 });
    expect((await db.prepare("pragma foreign_key_check").all()).results)
      .toEqual([]);
  });
});
