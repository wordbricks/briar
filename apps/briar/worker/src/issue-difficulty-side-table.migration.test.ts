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
const target = "0214_issue_difficulty_side_table.sql";
const previous = "0213_channel_text_attachments.sql";
const digest = (character: string) => character.repeat(64);

/*
  `briar_hunt_runs.difficulty` is a `check (… in (…))` list, and SQLite can only
  change a CHECK by rebuilding the table. The rebuild that would have widened it
  came to 469 statements and failed the remote D1 import, so 0214 leaves the
  column and its CHECK alone and moves the difficulty into
  `briar_run_difficulties`, keyed to a `briar_issue_difficulties` catalog.

  These tests are for what that move has to preserve: every difficulty a run
  already had, `expert` being accepted, an unknown value being refused by the
  foreign key, the legacy column staying readable and untouched, and the side
  table going away with the run it belongs to.

  The fixture is written with plain inserts rather than through the repository
  functions: those join `briar_run_difficulties`, which does not exist at the
  schema point this migration starts from.
*/
const seed = async (db: D1Database) => {
  await executeD1Sql(
    db,
    `
    insert into "user" (
      id, name, email, emailVerified, createdAt, updatedAt
    ) values (
      'difficulty-owner', 'Difficulty Owner', 'difficulty@example.com', 1,
      '${now}', '${now}'
    );
    insert into briar_organizations (
      id, name, handle, created_at, updated_at
    ) values (
      'difficulty-org', 'Difficulty Org', 'difficulty-org', '${now}', '${now}'
    );
    insert into briar_organization_members (
      organization_id, user_id, role, created_at, updated_at
    ) values (
      'difficulty-org', 'difficulty-owner', 'owner', '${now}', '${now}'
    );
    insert into briar_projects (
      id, owner_user_id, organization_id, name, agent_token_hash,
      created_at, updated_at
    ) values (
      'difficulty-project', 'difficulty-owner', 'difficulty-org',
      'Difficulty Project', '${digest("a")}', '${now}', '${now}'
    );
    insert into briar_hunt_runs (
      id, project_id, source, source_key, title, stage, repository,
      difficulty, workflow_snapshot_json,
      started_at, last_event_at, created_at, updated_at
    ) values
      ('difficulty-run-easy', 'difficulty-project', 'issue', 'easy-1',
       'Easy issue', 'queued', 'acme/repo', 'easy', '${workflow}',
       '${now}', '${now}', '${now}', '${now}'),
      ('difficulty-run-normal', 'difficulty-project', 'issue', 'normal-1',
       'Normal issue', 'queued', 'acme/repo', 'normal', '${workflow}',
       '${now}', '${now}', '${now}', '${now}'),
      ('difficulty-run-hard', 'difficulty-project', 'issue', 'hard-1',
       'Hard issue', 'queued', 'acme/repo', 'hard', '${workflow}',
       '${now}', '${now}', '${now}', '${now}'),
      ('difficulty-run-unset', 'difficulty-project', 'issue', 'unset-1',
       'Unset issue', 'queued', 'acme/repo', null, '${workflow}',
       '${now}', '${now}', '${now}', '${now}');
  `,
  );
};

const insertRun = (db: D1Database, id: string) =>
  db
    .prepare(
      `insert into briar_hunt_runs (
         id, project_id, source, source_key, title, stage, repository,
         workflow_snapshot_json,
         started_at, last_event_at, created_at, updated_at
       ) values (?, 'difficulty-project', 'issue', ?, 'Issue', 'queued',
                 'acme/repo', ?, ?, ?, ?, ?)`,
    )
    .bind(id, id, workflow, now, now, now, now)
    .run();

const setDifficulty = (db: D1Database, runId: string, difficulty: string) =>
  db
    .prepare(
      `insert into briar_run_difficulties (run_id, difficulty) values (?, ?)`,
    )
    .bind(runId, difficulty)
    .run();

const difficulties = (db: D1Database) =>
  db
    .prepare(
      `select run.id, side.difficulty
       from briar_hunt_runs run
       left join briar_run_difficulties side on side.run_id = run.id
       order by run.id`,
    )
    .all();

describe("issue difficulty side table migration", () => {
  it("carries every existing difficulty into the side table", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);

    await applyD1Migrations(db, { files: [target] });

    expect(await difficulties(db)).toMatchObject({
      results: [
        { id: "difficulty-run-easy", difficulty: "easy" },
        { id: "difficulty-run-hard", difficulty: "hard" },
        { id: "difficulty-run-normal", difficulty: "normal" },
        // No row rather than a null column: an unset difficulty is an absent
        // row, which is what the clear path writes.
        { id: "difficulty-run-unset", difficulty: null },
      ],
    });
    expect(
      await db
        .prepare(
          `select count(*) as count from briar_run_difficulties`,
        )
        .first<number>("count"),
    ).toBe(3);
  });

  it("leaves the legacy column and its CHECK exactly where they were", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);

    await applyD1Migrations(db, { files: [target] });

    // Dropping the column would need the rebuild this migration exists to
    // avoid: SQLite refuses to drop a column named in a CHECK constraint.
    const schema = await db
      .prepare(
        `select sql from sqlite_schema
         where type = 'table' and name = 'briar_hunt_runs'`,
      )
      .first<string>("sql");
    expect(schema).toContain("check (difficulty in ('easy', 'normal', 'hard'))");
    expect(await db.prepare(
      `select id, difficulty from briar_hunt_runs order by id`,
    ).all()).toMatchObject({
      results: [
        { id: "difficulty-run-easy", difficulty: "easy" },
        { id: "difficulty-run-hard", difficulty: "hard" },
        { id: "difficulty-run-normal", difficulty: "normal" },
        { id: "difficulty-run-unset", difficulty: null },
      ],
    });
    // The whole point of not touching the table: a run inserted without a
    // difficulty still satisfies the old CHECK, because `col in (…)` is NULL
    // rather than false when col is NULL.
    await insertRun(db, "difficulty-run-new");
    expect(
      await db
        .prepare(
          `select difficulty from briar_hunt_runs where id = ?`,
        )
        .bind("difficulty-run-new")
        .first<string | null>("difficulty"),
    ).toBeNull();
  });

  it("accepts 'expert' and refuses a value outside the catalog", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);
    // Before the migration the CHECK list is the only gate, and it has no
    // 'expert'. Otherwise the assertion after it would hold vacuously.
    await expect(
      db
        .prepare(
          `update briar_hunt_runs set difficulty = 'expert' where id = ?`,
        )
        .bind("difficulty-run-easy")
        .run(),
    ).rejects.toThrow();

    await applyD1Migrations(db, { files: [target] });

    await setDifficulty(db, "difficulty-run-unset", "expert");
    expect(
      await db
        .prepare(
          `select difficulty from briar_run_difficulties where run_id = ?`,
        )
        .bind("difficulty-run-unset")
        .first<string>("difficulty"),
    ).toBe("expert");
    // Refused by the foreign key now rather than by a CHECK list.
    await expect(setDifficulty(db, "difficulty-run-easy", "extreme"))
      .rejects.toThrow();
    await expect(
      db
        .prepare(
          `update briar_run_difficulties set difficulty = 'legendary'
           where run_id = ?`,
        )
        .bind("difficulty-run-hard")
        .run(),
    ).rejects.toThrow();
    // And a difficulty cannot be hung off a run that does not exist.
    await expect(setDifficulty(db, "difficulty-run-missing", "hard"))
      .rejects.toThrow();
  });

  it("takes the side-table row away with the run", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });
    await seed(db);
    await applyD1Migrations(db, { files: [target] });

    await db
      .prepare(`delete from briar_hunt_runs where id = ?`)
      .bind("difficulty-run-hard")
      .run();

    expect(
      await db
        .prepare(
          `select count(*) as count from briar_run_difficulties where run_id = ?`,
        )
        .bind("difficulty-run-hard")
        .first<number>("count"),
    ).toBe(0);
    expect(
      await db.prepare("pragma foreign_key_check").all(),
    ).toMatchObject({ results: [] });
  });

  it("seeds the catalog the application advertises", async () => {
    const db = env.DB;
    await applyD1Migrations(db);

    const rows = await db
      .prepare(
        `select difficulty, proto_name from briar_issue_difficulties
         order by difficulty`,
      )
      .all<{ difficulty: string; proto_name: string }>();
    // Nothing in the app can write a difficulty the lookup table does not
    // carry, so adding a fifth value to `issueDifficulties` without seeding
    // its row has to fail here rather than at runtime.
    expect(rows.results.map((row) => row.difficulty)).toEqual(
      [...issueDifficulties].sort(),
    );
    expect(rows.results.map((row) => row.proto_name)).toEqual(
      [...issueDifficulties].sort().map((difficulty) =>
        `ISSUE_DIFFICULTY_${difficulty.toUpperCase()}`
      ),
    );
  });

  it("takes one insert to add the difficulty after this one", async () => {
    const db = env.DB;
    await applyD1Migrations(db);
    await seed(db);

    // No migration: the value the CHECK list used to hold is now a row.
    await db
      .prepare(
        `insert into briar_issue_difficulties (difficulty, proto_name)
         values ('legendary', 'ISSUE_DIFFICULTY_LEGENDARY')`,
      )
      .run();

    await setDifficulty(db, "difficulty-run-unset", "legendary");
    expect(
      await db
        .prepare(
          `select difficulty from briar_run_difficulties where run_id = ?`,
        )
        .bind("difficulty-run-unset")
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

  it("rebuilds nothing and leaves no scaffolding behind", async () => {
    const db = env.DB;
    await applyD1Migrations(db);

    // A rebuild would have parked rows in backup tables; this migration has
    // none, and every existing reference to briar_hunt_runs is still declared
    // against the table it was always declared against.
    expect(
      await db
        .prepare(
          `select count(*) as count from sqlite_schema
           where type = 'table'
             and (name like '%_backup_%' or name like 'briar_difficulty_%')`,
        )
        .first<number>("count"),
    ).toBe(0);
    expect(
      await db
        .prepare(
          `select count(*) as count from sqlite_schema
           where type = 'table' and sql like '%references briar_hunt_runs%'`,
        )
        .first<number>("count"),
    ).toBeGreaterThan(0);
    expect(
      await db.prepare("pragma foreign_key_check").all(),
    ).toMatchObject({ results: [] });
  });
});
