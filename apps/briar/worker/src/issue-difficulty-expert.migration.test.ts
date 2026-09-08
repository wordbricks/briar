import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { issueDifficulties } from "../../src/lib/issue-difficulty";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

const now = "2026-09-08T00:00:00.000Z";
// `briar_hunt_runs_workflow_v2_insert` refuses a run whose snapshot is not a
// canonical v2 one, and the column default is still v1.
const workflow =
  '{"version":2,"stages":[{"id":"implementing","label":"Implement","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["implementing"]}}';
const target = "0214_issue_difficulty_expert.sql";
const previous = "0213_channel_text_attachments.sql";
const digest = (character: string) => character.repeat(64);

/*
  `briar_hunt_runs.difficulty` was a `check (… in (…))` list, and SQLite can
  only change a CHECK by rebuilding the table. So this migration is the last
  rebuild the column needs: the list becomes rows in `briar_issue_difficulties`
  and the column becomes a foreign key into it, after which a fifth difficulty
  is one insert.

  The rebuild is deliberately narrow. Only descendants with a `not null`
  foreign key are parked; a nullable one is saved, nulled and restored, which
  is what keeps the migration off the million rows hanging below
  `briar_agent_transcript_sessions`. These tests are for what that costs:
  the parked rows, the nulled columns coming back with the values they had,
  the rows below the nulled columns never moving, the new value, and the
  values still refused.

  The fixture is written with plain inserts rather than through the repository
  functions: those join tables that this migration's schema point knows nothing
  about, and the schema here is the one the migration is about to change.
*/
const seed = async (db: D1Database) => {
  await executeD1Sql(db, `
    insert into "user" (
      id, name, email, emailVerified, createdAt, updatedAt
    ) values (
      'expert-owner', 'Expert Owner', 'expert@example.com', 1, '${now}', '${now}'
    );
    insert into briar_organizations (
      id, name, handle, created_at, updated_at
    ) values (
      'expert-org', 'Expert Org', 'expert-org', '${now}', '${now}'
    );
    insert into briar_organization_members (
      organization_id, user_id, role, created_at, updated_at
    ) values (
      'expert-org', 'expert-owner', 'owner', '${now}', '${now}'
    );
    insert into briar_projects (
      id, owner_user_id, organization_id, name, agent_token_hash,
      created_at, updated_at
    ) values (
      'expert-project', 'expert-owner', 'expert-org', 'Expert Project',
      '${digest("a")}', '${now}', '${now}'
    );
    insert into briar_hunt_runs (
      id, project_id, source, source_key, title, stage, repository,
      difficulty, workflow_snapshot_json,
      started_at, last_event_at, created_at, updated_at
    ) values
      ('expert-run-easy', 'expert-project', 'issue', 'easy-1', 'Easy issue',
       'queued', 'acme/repo', 'easy', '${workflow}',
       '${now}', '${now}', '${now}', '${now}'),
      ('expert-run-normal', 'expert-project', 'issue', 'normal-1',
       'Normal issue', 'queued', 'acme/repo', 'normal', '${workflow}',
       '${now}', '${now}', '${now}', '${now}'),
      ('expert-run-hard', 'expert-project', 'issue', 'hard-1', 'Hard issue',
       'queued', 'acme/repo', 'hard', '${workflow}',
       '${now}', '${now}', '${now}', '${now}'),
      ('expert-run-unset', 'expert-project', 'issue', 'unset-1',
       'Unset issue', 'queued', 'acme/repo', null, '${workflow}',
       '${now}', '${now}', '${now}', '${now}');
    insert into briar_hunt_events (
      id, run_id, event_key, stage, actor, occurred_at, recorded_at
    ) values (
      'expert-event', 'expert-run-hard', 'queued', 'queued', 'tester',
      '${now}', '${now}'
    );
    insert into briar_issue_messages (
      id, project_id, run_id, body, created_at, updated_at
    ) values (
      'expert-message', 'expert-project', 'expert-run-hard', 'A note',
      '${now}', '${now}'
    );
    insert into briar_run_stage_progress (
      run_id, attempt, revision, stage_id, state, started_at, finished_at
    ) values (
      'expert-run-hard', 1, 1, 'analysis', 'completed', '${now}', '${now}'
    );
    -- Two transcript sessions, because run_id is nullable and so is saved,
    -- nulled and restored instead of parked: the first has to come back with
    -- the run it named, and the second must stay null rather than being
    -- doubled or filled in.
    insert into briar_agent_transcript_sessions (
      session_id, project_id, run_id, agent_provider, started_at, last_event_at
    ) values
      ('expert-session-run', 'expert-project', 'expert-run-hard', 'codex',
       '${now}', '${now}'),
      ('expert-session-loose', 'expert-project', null, 'codex',
       '${now}', '${now}');
    -- The rows the nulled column gates. They do not reference
    -- briar_hunt_runs at all, and in production they are 1.05M of the 1.2M
    -- rows a naive rebuild would have parked.
    insert into briar_agent_transcript_segments (
      session_id, first_sequence, last_sequence, object_key, event_count,
      uncompressed_bytes, compressed_bytes, sha256, recorded_at
    ) values (
      'expert-session-run', 1, 4, 'expert/segment-1', 4, 100, 50,
      '${digest("b")}', '${now}'
    );
    insert into briar_agent_worklog_entries (
      session_id, entry_id, sequence, updated_sequence, entry_type, status,
      started_at, updated_at
    ) values (
      'expert-session-run', 'expert-entry', 1, 1, 'message', 'completed',
      '${now}', '${now}'
    );
    insert into briar_agent_transcripts (
      session_id, sequence, direction, payload_json, recorded_at
    ) values ('expert-session-run', 1, 'client', '{}', '${now}');
    insert into briar_execution_audit_events (
      id, organization_id, project_id, run_id, action, occurred_at
    ) values
      ('expert-audit-run', 'expert-org', 'expert-project', 'expert-run-hard',
       'dispatched', '${now}'),
      ('expert-audit-loose', 'expert-org', 'expert-project', null,
       'dispatched', '${now}');
    -- result_run_id is declared "on delete set null": the drop would blank it,
    -- so the migration has to have saved it first.
    insert into briar_channels (
      id, organization_id, slug, name, created_at, updated_at
    ) values (
      'expert-channel', 'expert-org', 'expert-channel', 'Expert Channel',
      '${now}', '${now}'
    );
    insert into briar_channel_action_proposals (
      id, channel_id, project_id, trigger_message_id, reply_message_id,
      action_type, payload_json, result_run_id, created_at, updated_at
    ) values (
      'expert-proposal', 'expert-channel', 'expert-project', 'expert-trigger',
      'expert-reply', 'request_issue_create', '{}', 'expert-run-hard',
      '${now}', '${now}'
    );
  `);
};

const insertRun = (db: D1Database, id: string, difficulty: string) =>
  db
    .prepare(
      `insert into briar_hunt_runs (
         id, project_id, source, source_key, title, stage, repository,
         difficulty, workflow_snapshot_json,
         started_at, last_event_at, created_at, updated_at
       ) values (?, 'expert-project', 'issue', ?, 'Issue', 'queued',
                 'acme/repo', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, id, difficulty, workflow, now, now, now, now)
    .run();

describe("issue difficulty expert migration", () => {
  it("keeps every existing difficulty and the parked rows", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);

    await applyD1Migrations(db, { files: [target] });

    expect(
      await db
        .prepare(
          `select id, difficulty from briar_hunt_runs order by id`,
        )
        .all(),
    ).toMatchObject({
      results: [
        { id: "expert-run-easy", difficulty: "easy" },
        { id: "expert-run-hard", difficulty: "hard" },
        { id: "expert-run-normal", difficulty: "normal" },
        { id: "expert-run-unset", difficulty: null },
      ],
    });
    // The descendants the drop cascaded away, back with the rows they had.
    expect(
      await db
        .prepare(
          `select run_id from briar_hunt_events where id = 'expert-event'`,
        )
        .first(),
    ).toEqual({ run_id: "expert-run-hard" });
    expect(
      await db
        .prepare(
          `select run_id, body from briar_issue_messages
           where id = 'expert-message'`,
        )
        .first(),
    ).toEqual({ run_id: "expert-run-hard", body: "A note" });
    expect(
      await db
        .prepare(
          `select count(*) as count from briar_run_stage_progress
           where run_id = 'expert-run-hard'`,
        )
        .first<number>("count"),
    ).toBe(1);
  });

  it("restores every nulled foreign key with the value it had", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);

    await applyD1Migrations(db, { files: [target] });

    // The whole point of nulling these instead of parking them: present
    // exactly once, and pointing where they pointed before.
    expect(
      await db
        .prepare(
          `select session_id, run_id from briar_agent_transcript_sessions
           order by session_id`,
        )
        .all(),
    ).toMatchObject({
      results: [
        { session_id: "expert-session-loose", run_id: null },
        { session_id: "expert-session-run", run_id: "expert-run-hard" },
      ],
    });
    expect(
      await db
        .prepare(
          `select id, run_id from briar_execution_audit_events order by id`,
        )
        .all(),
    ).toMatchObject({
      results: [
        { id: "expert-audit-loose", run_id: null },
        { id: "expert-audit-run", run_id: "expert-run-hard" },
      ],
    });
    // `on delete set null`, so the drop alone would have blanked this.
    expect(
      await db
        .prepare(
          `select result_run_id from briar_channel_action_proposals
           where id = 'expert-proposal'`,
        )
        .first<string>("result_run_id"),
    ).toBe("expert-run-hard");
  });

  it("never touches the rows the nulled columns gate", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);

    await applyD1Migrations(db, { files: [target] });

    expect(
      await db
        .prepare(
          `select session_id, first_sequence, last_sequence, object_key,
                  event_count, sha256
           from briar_agent_transcript_segments`,
        )
        .all(),
    ).toMatchObject({
      results: [
        {
          session_id: "expert-session-run",
          first_sequence: 1,
          last_sequence: 4,
          object_key: "expert/segment-1",
          event_count: 4,
          sha256: digest("b"),
        },
      ],
    });
    expect(
      await db
        .prepare(
          `select session_id, entry_id, status from briar_agent_worklog_entries`,
        )
        .all(),
    ).toMatchObject({
      results: [
        {
          session_id: "expert-session-run",
          entry_id: "expert-entry",
          status: "completed",
        },
      ],
    });
    expect(
      await db
        .prepare(
          `select session_id, sequence, direction from briar_agent_transcripts`,
        )
        .all(),
    ).toMatchObject({
      results: [
        { session_id: "expert-session-run", sequence: 1, direction: "client" },
      ],
    });
  });

  it("accepts 'expert' and still refuses a value outside the catalog", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);
    await expect(insertRun(db, "expert-run-early", "expert")).rejects.toThrow();

    await applyD1Migrations(db, { files: [target] });

    await insertRun(db, "expert-run-new", "expert");
    expect(
      await db
        .prepare(
          `select difficulty from briar_hunt_runs where id = 'expert-run-new'`,
        )
        .first<string>("difficulty"),
    ).toBe("expert");
    // Refused by the foreign key now rather than by a CHECK list.
    await expect(insertRun(db, "expert-run-bogus", "extreme"))
      .rejects.toThrow();
    await expect(
      db
        .prepare(
          `update briar_hunt_runs set difficulty = 'legendary'
           where id = 'expert-run-hard'`,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("keys the column to the catalog instead of spelling it out", async () => {
    const db = env.DB;
    await applyD1Migrations(db);

    const rows = await db
      .prepare(
        `select difficulty, proto_name from briar_issue_difficulties
         order by difficulty`,
      )
      .all<{ difficulty: string; proto_name: string }>();
    // Nothing in the app can write a difficulty the lookup table does not
    // carry, so the catalog it advertises has to be exactly these rows.
    expect(rows.results.map((row) => row.difficulty)).toEqual(
      [...issueDifficulties].sort(),
    );
    expect(rows.results.map((row) => row.proto_name)).toEqual(
      [...issueDifficulties].sort().map((difficulty) =>
        `ISSUE_DIFFICULTY_${difficulty.toUpperCase()}`
      ),
    );

    const schema = await db
      .prepare(
        `select sql from sqlite_schema
         where type = 'table' and name = 'briar_hunt_runs'`,
      )
      .first<string>("sql");
    expect(schema).toContain(
      'foreign key ("difficulty") references briar_issue_difficulties (difficulty)',
    );
    expect(schema).not.toMatch(/difficulty\s+in\s*\(/iu);
  });

  it("takes one insert to add the difficulty after this one", async () => {
    const db = env.DB;
    await applyD1Migrations(db);
    await seed(db);

    await db
      .prepare(
        `insert into briar_issue_difficulties (difficulty, proto_name)
         values ('legendary', 'ISSUE_DIFFICULTY_LEGENDARY')`,
      )
      .run();

    await insertRun(db, "expert-run-legendary", "legendary");
    expect(
      await db
        .prepare(
          `select difficulty from briar_hunt_runs
           where id = 'expert-run-legendary'`,
        )
        .first<string>("difficulty"),
    ).toBe("legendary");
    // The derived column is what keeps the catalog honest against the proto.
    await expect(
      db
        .prepare(
          `insert into briar_issue_difficulties (difficulty, proto_name)
           values ('mythic', 'ISSUE_DIFFICULTY_LEGENDARY')`,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("leaves the schema whole and every foreign key satisfied", async () => {
    const db = env.DB;
    await applyD1Migrations(db);

    expect(
      await db
        .prepare(
          `select count(*) as count from sqlite_schema
           where type = 'table'
             and (name like 'briar_difficulty_backup_%'
                  or name like 'briar_difficulty_link_%')`,
        )
        .first<number>("count"),
    ).toBe(0);
    expect(
      await db
        .prepare(
          `select count(*) as count from sqlite_schema
           where type = 'table'
             and sql like '%references briar_hunt_runs%'`,
        )
        .first<number>("count"),
    ).toBeGreaterThan(0);
    expect(
      await db.prepare("pragma foreign_key_check").all(),
    ).toMatchObject({ results: [] });
  });

  it("keeps the indexes and triggers the rebuilt table dropped with it", async () => {
    const db = env.DB;
    await applyD1Migrations(db);

    const objects = async (type: "index" | "trigger") =>
      (await db
        .prepare(
          `select name from sqlite_schema
           where type = ? and tbl_name = 'briar_hunt_runs' and sql is not null
           order by name`,
        )
        .bind(type)
        .all<{ name: string }>()).results.map((row) => row.name);

    expect(await objects("index")).toEqual([
      "briar_hunt_runs_assignee_idx",
      "briar_hunt_runs_attention_idx",
      "briar_hunt_runs_dispatch_queue_idx",
      "briar_hunt_runs_dispatch_request_idx",
      "briar_hunt_runs_github_reconcile_idx",
      "briar_hunt_runs_planning_project_idx",
      "briar_hunt_runs_project_created_idx",
      "briar_hunt_runs_project_idx",
      "briar_hunt_runs_project_run_number_idx",
      "briar_hunt_runs_queue_claim_idx",
      "briar_hunt_runs_resume_requested_idx",
      "briar_hunt_runs_source_identity_project_idx",
      "briar_hunt_runs_status_idx",
      "briar_hunt_runs_team_hierarchy_idx",
      "briar_hunt_runs_tracker_issue_idx",
      "briar_hunt_runs_tracker_issue_unique_idx",
      "briar_hunt_runs_waiting_checkpoint_idx",
      "briar_hunt_runs_worker_idx",
    ]);
    expect((await objects("trigger")).length).toBe(54);
  });

  it("restores the closure without re-announcing it to the sync feed", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);

    const changeRows = () =>
      db
        .prepare(
          `select count(*) as count from briar_dashboard_changes
           where entity_type = 'run'`,
        )
        .first<number>("count");
    const beforeRebuild = await changeRows();
    // Otherwise the comparison below would hold vacuously.
    expect(beforeRebuild).toBeGreaterThan(0);

    await applyD1Migrations(db, { files: [target] });

    // The restore replays rows that already existed, so it runs with the
    // triggers dropped: re-announcing every run would make every client
    // refetch the whole board.
    expect(await changeRows()).toBe(beforeRebuild);

    await insertRun(db, "expert-run-after", "expert");
    expect(
      await db
        .prepare(
          `select count(*) as count from briar_dashboard_changes
           where entity_type = 'run' and entity_id = 'expert-run-after'`,
        )
        .first<number>("count"),
    ).toBeGreaterThan(0);
  });
});
