import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const executeSql = async (db: D1Database, sql: string) => {
  for (const statement of sql.split(/;\s*(?:\n|$)/u)) {
    if (statement.trim()) await db.prepare(statement).run();
  }
};

describe("Slack D1 integration", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-slack-test" },
  });
  let db: D1Database;
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const firstProjectId = "22222222-2222-4222-8222-222222222222";
  const secondProjectId = "33333333-3333-4333-8333-333333333333";

  beforeAll(async () => {
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    const migrations = (await readdir(resolve("migrations")))
      .filter((name) => /^\d+.*\.sql$/u.test(name))
      .sort();
    for (const migration of migrations) {
      await executeSql(
        db,
        await readFile(resolve("migrations", migration), "utf8"),
      );
    }
    const now = "2026-07-29T00:00:00.000Z";
    await executeSql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Owner', 'owner@example.com', 1, '${now}', '${now}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${organizationId}', 'Briar', 'briar', '${now}', '${now}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${organizationId}', 'owner', 'owner', '${now}', '${now}');
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
    expect(
      await deleteSlackInstallation(db, organizationId, "T123"),
    ).toBe(true);
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
