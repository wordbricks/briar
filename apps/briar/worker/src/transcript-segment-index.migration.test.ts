import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";

const table = "briar_agent_transcript_segments";
const duplicate = "briar_agent_transcript_segments_session_sequence_idx";
const previous = "0218_issue_attachment_sources.sql";
const target = "0219_drop_duplicate_transcript_segment_index.sql";

type IndexInfo = { name: string; origin: string; unique: number };
type IndexColumn = { name: string; seqno: number };

async function indexes(db: D1Database) {
  return (await db.prepare(`pragma index_list('${table}')`).all<IndexInfo>()).results;
}

async function columns(db: D1Database, index: string) {
  return (await db.prepare(`pragma index_info('${index}')`).all<IndexColumn>()).results
    .sort((a, b) => a.seqno - b.seqno)
    .map(({ name }) => name);
}

describe("transcript segment duplicate index migration", () => {
  it("removes only the duplicate and retains the same PK lookup path", async () => {
    const db = env.DB;
    await applyD1Migrations(db, { through: previous });

    const before = await indexes(db);
    const pk = before.find(({ origin }) => origin === "pk");
    expect(pk).toBeDefined();
    expect(before.some(({ name }) => name === duplicate)).toBe(true);
    const key = ["session_id", "first_sequence", "last_sequence"];
    expect(await columns(db, duplicate)).toEqual(key);
    expect(await columns(db, pk!.name)).toEqual(key);

    await applyD1Migrations(db, { files: [target] });

    const after = await indexes(db);
    expect(after.map(({ name, origin, unique }) => ({ name, origin, unique })))
      .toEqual(before.filter(({ name }) => name !== duplicate)
        .map(({ name, origin, unique }) => ({ name, origin, unique })));
    expect(await columns(db, pk!.name)).toEqual(key);
    const plan = (await db.prepare(
      `explain query plan select * from briar_agent_transcript_segments
       where session_id = ? and first_sequence = ? and last_sequence = ?`,
    ).bind("session", 1, 2).all<{ detail: string }>()).results;
    expect(plan.some(({ detail }) => detail.includes(pk!.name))).toBe(true);
  });
});
