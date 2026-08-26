import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import worker from "./index";
import {
  createIsolatedTestDatabase,
  type IsolatedTestDatabase,
} from "./test-helpers/d1";

const userId = "account-profile-user";
const otherUserId = "account-profile-other-user";
const token = "account-profile-token";
const now = "2026-08-26T00:00:00.000Z";

describe("account profile routes", () => {
  let database: IsolatedTestDatabase;
  let db: D1Database;

  beforeAll(async () => {
    database = await createIsolatedTestDatabase({
      suite: "account-profile-routes",
    });
    db = database.db;
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt, username
         ) values (?, 'Jay', 'jay@example.com', 1, ?, ?, null)`,
      ).bind(userId, now, now),
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt, username
         ) values (?, 'Other', 'other@example.com', 1, ?, ?, 'taken_name')`,
      ).bind(otherUserId, now, now),
      db.prepare(
        `insert into "session" (
           id, expiresAt, token, createdAt, updatedAt, userId
         ) values ('account-profile-session', '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
      ).bind(token, now, now, userId),
    ]);
  }, 60_000);

  beforeEach(async () => {
    await db.prepare(
      `update "user"
       set username = null, name = 'Jay', image = null, updatedAt = ?
       where id = ?`,
    ).bind(now, userId).run();
  });

  afterAll(async () => database.dispose());

  const env = () => ({
    DB: db,
    ATTACHMENTS: {} as R2Bucket,
    BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
  }) as Env;

  const patchProfile = (body: {
    username: string | null;
    name: string;
    image: string | null;
  }) => worker.fetch(new Request("https://briar.example/me", {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }), env());

  it("updates a nickname while leaving username unset", async () => {
    const response = await patchProfile({
      username: null,
      name: "Jay Park",
      image: null,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { username: null, name: "Jay Park" },
    });
    await expect(db.prepare(
      `select username, name from "user" where id = ?`,
    ).bind(userId).first()).resolves.toEqual({
      username: null,
      name: "Jay Park",
    });
  });

  it("assigns an available username", async () => {
    const response = await patchProfile({
      username: "available_name",
      name: "Jay",
      image: null,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { username: "available_name", name: "Jay" },
    });
  });

  it("reports a conflict only for a username owned by another account", async () => {
    const response = await patchProfile({
      username: "taken_name",
      name: "Jay Park",
      image: null,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: "Username is already taken",
    });
    await expect(db.prepare(
      `select username, name from "user" where id = ?`,
    ).bind(userId).first()).resolves.toEqual({
      username: null,
      name: "Jay",
    });
  });
});
