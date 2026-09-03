import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";

describe("project named icon migration", () => {
  it("adds validated icon_name and icon_color columns to briar_teams", async () => {
    const db = env.DB;
    const now = "2026-09-01T00:00:00.000Z";
    await applyD1Migrations(db, {
      through: "0177_managed_computer_jay_promotion_campaigns.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values (
        'named-icon-owner', 'Named Icon Owner', 'named-icon@example.com', 1, '${now}', '${now}'
      );
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'named-icon-org', 'Named Icon Org', 'named-icon-org', '${now}', '${now}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        'named-icon-org', 'named-icon-owner', 'owner', '${now}', '${now}'
      );
      insert into briar_teams (
        id, owner_user_id, name, agent_token_hash, created_at, updated_at,
        organization_id, icon_data_url_browser
      ) values (
        'named-icon-team', 'named-icon-owner', 'Named Icon Team',
        '${'a'.repeat(64)}', '${now}', '${now}', 'named-icon-org',
        'data:image/png;base64,aA=='
      );
    `);

    await applyD1Migrations(db, {
      files: ["0178_project_named_icons.sql"],
    });

    expect(await db.prepare(
      `select icon_name, icon_color,
              coalesce(icon_data_url_browser, icon_data_url) as icon
       from briar_teams where id = 'named-icon-team'`,
    ).first()).toEqual({
      icon_name: null,
      icon_color: null,
      icon: "data:image/png;base64,aA==",
    });

    await db.prepare(
      `update briar_teams
       set icon_name = 'rocket', icon_color = '#6366f1'
       where id = 'named-icon-team'`,
    ).run();
    expect(await db.prepare(
      `select icon_name, icon_color from briar_teams where id = 'named-icon-team'`,
    ).first()).toEqual({ icon_name: "rocket", icon_color: "#6366f1" });

    await expect(
      db.prepare(
        `update briar_teams set icon_name = 'Not Valid!' where id = 'named-icon-team'`,
      ).run(),
    ).rejects.toThrow();
    await expect(
      db.prepare(
        `update briar_teams set icon_color = 'purple' where id = 'named-icon-team'`,
      ).run(),
    ).rejects.toThrow();
  });
});
