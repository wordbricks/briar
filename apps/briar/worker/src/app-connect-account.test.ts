import { Code, createClient, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  AccountService,
  MobilePushEndpoint,
  MobilePushLocale,
} from "@briar/contracts/gen/briar/app/v1/account_pb";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import {
  createIsolatedTestDatabase,
  executeD1Sql,
} from "./test-helpers/d1";

describe("AccountService", () => {
  const now = "2026-08-31T00:00:00.000Z";
  const ownerToken = "account-push-owner-token";
  const memberToken = "account-push-member-token";
  let miniflare: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "app-connect-account",
    });
    miniflare = database.miniflare;
    db = database.db;
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values
        ('owner', 'Owner', 'owner@example.com', 1, '${now}', '${now}'),
        ('member', 'Member', 'member@example.com', 1, '${now}', '${now}');
      insert into "session" (
        id, expiresAt, token, createdAt, updatedAt, userId
      ) values
        ('owner-session', '2099-01-01T00:00:00.000Z', '${ownerToken}', '${now}', '${now}', 'owner'),
        ('member-session', '2099-01-01T00:00:00.000Z', '${memberToken}', '${now}', '${now}', 'member');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values (
        '11111111-1111-4111-8111-111111111111',
        'Push',
        'push',
        '${now}',
        '${now}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values
        ('11111111-1111-4111-8111-111111111111', 'owner', 'owner', '${now}', '${now}'),
        ('11111111-1111-4111-8111-111111111111', 'member', 'viewer', '${now}', '${now}');
      insert into briar_organization_inbox_sync_state (
        organization_id, current_version
      ) values ('11111111-1111-4111-8111-111111111111', 7);
    `);
  }, 60_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  const client = createClient(
    AccountService,
    createConnectTransport({
      baseUrl: "https://briar.example",
      fetch: async (input, init) =>
        worker.fetch(new Request(input, init), {
          DB: db,
          ATTACHMENTS: {},
          ARCHIVES: {},
          BETTER_AUTH_SECRET:
            "briar-test-secret-that-is-at-least-32-characters",
          GOOGLE_CLIENT_ID: "google-client",
          GOOGLE_CLIENT_SECRET: "google-secret",
        } as never),
    }),
  );

  const options = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });
  const preferences = {
    playSound: true,
    urgent: true,
    actionRequired: true,
    important: false,
    activity: false,
  };
  const deviceToken = "a".repeat(64);
  const fcmToken = "f".repeat(96);

  it("updates nullable profile fields through typed oneofs", async () => {
    const response = await client.updateAccountProfile(
      {
        usernameUpdate: { case: "username", value: "owner_dev" },
        name: "Owner Renamed",
        imageUpdate: { case: "clearImage", value: {} },
      },
      options(ownerToken),
    );
    expect(response.user).toMatchObject({
      id: "owner",
      username: "owner_dev",
      name: "Owner Renamed",
      email: "owner@example.com",
    });
    await expect(db.prepare(
      `select username, name, image from "user" where id = 'owner'`,
    ).first()).resolves.toEqual({
      username: "owner_dev",
      name: "Owner Renamed",
      image: null,
    });

    const error = await client.updateAccountProfile(
      {
        name: "Incomplete",
        imageUpdate: { case: "clearImage", value: {} },
      },
      options(ownerToken),
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
  });

  it("enforces confirmation and recent-auth deletion invariants", async () => {
    const createdAt = new Date().toISOString();
    const deleteToken = "account-delete-token";
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('delete-user', 'Delete', 'delete@example.com', 1, '${createdAt}', '${createdAt}');
      insert into "session" (
        id, expiresAt, token, createdAt, updatedAt, userId
      ) values (
        'delete-session', '2099-01-01T00:00:00.000Z', '${deleteToken}',
        '${createdAt}', '${createdAt}', 'delete-user'
      );
    `);

    const mismatch = await client.deleteAccount(
      { confirmation: "other@example.com" },
      options(deleteToken),
    ).catch((cause: unknown) => cause);
    expect(mismatch).toBeInstanceOf(ConnectError);
    expect((mismatch as ConnectError).code).toBe(Code.InvalidArgument);

    await client.deleteAccount(
      { confirmation: "delete@example.com" },
      options(deleteToken),
    );
    await expect(db.prepare(
      `select id from "user" where id = 'delete-user'`,
    ).first()).resolves.toBeNull();
  });

  it("normalizes endpoints and keeps token ownership scoped to the session", async () => {
    const inboxState = await db.prepare(
      `select current_version from briar_organization_inbox_sync_state
       where organization_id = '11111111-1111-4111-8111-111111111111'`,
    ).first<{ current_version: number }>();
    await client.registerMobilePushDevice(
      {
        endpoint: MobilePushEndpoint.APNS_DEVELOPMENT,
        token: deviceToken,
        locale: MobilePushLocale.KO,
        preferences,
      },
      options(ownerToken),
    );
    const initial = await db.prepare(
      `select registration.id, registration.user_id, registration.platform,
              registration.environment, registration.topic,
              registration.locale, registration.play_sound,
              registration.notify_important, registration.registered_at,
              scope.baseline_version
       from briar_mobile_push_registrations registration
       join briar_mobile_push_registration_scopes scope
         on scope.registration_id = registration.id
       where registration.token = ?`,
    ).bind(deviceToken).first<Record<string, unknown>>();
    expect(initial).toMatchObject({
      user_id: "owner",
      platform: "apns",
      environment: "development",
      topic: "app.briar.companion.native.dev",
      locale: "ko",
      play_sound: 1,
      notify_important: 0,
      baseline_version: inboxState?.current_version,
    });

    await client.registerMobilePushDevice(
      {
        endpoint: MobilePushEndpoint.APNS_PRODUCTION,
        token: deviceToken,
        locale: MobilePushLocale.EN,
        preferences: { ...preferences, playSound: false },
      },
      options(ownerToken),
    );
    await expect(db.prepare(
      `select registration.id, registration.registered_at,
              registration.environment, registration.play_sound,
              scope.baseline_version
       from briar_mobile_push_registrations registration
       join briar_mobile_push_registration_scopes scope
         on scope.registration_id = registration.id
       where registration.token = ?`,
    ).bind(deviceToken).first()).resolves.toEqual({
      id: initial?.id,
      registered_at: initial?.registered_at,
      environment: "production",
      play_sound: 0,
      baseline_version: inboxState?.current_version,
    });

    await client.unregisterMobilePushDevice(
      { endpoint: MobilePushEndpoint.APNS_PRODUCTION, token: deviceToken },
      options(memberToken),
    );
    await expect(db.prepare(
      "select user_id from briar_mobile_push_registrations where token = ?",
    ).bind(deviceToken).first()).resolves.toEqual({ user_id: "owner" });

    await client.registerMobilePushDevice(
      {
        endpoint: MobilePushEndpoint.APNS_PRODUCTION,
        token: deviceToken,
        locale: MobilePushLocale.EN,
        preferences,
      },
      options(memberToken),
    );
    await expect(db.prepare(
      `select user_id, platform, environment, topic, locale
       from briar_mobile_push_registrations where token = ?`,
    ).bind(deviceToken).first()).resolves.toEqual({
      user_id: "member",
      platform: "apns",
      environment: "production",
      topic: "app.briar.companion",
      locale: "en",
    });

    await client.unregisterMobilePushDevice(
      { endpoint: MobilePushEndpoint.APNS_PRODUCTION, token: deviceToken },
      options(ownerToken),
    );
    await expect(db.prepare(
      "select user_id from briar_mobile_push_registrations where token = ?",
    ).bind(deviceToken).first()).resolves.toEqual({ user_id: "member" });
    await client.unregisterMobilePushDevice(
      { endpoint: MobilePushEndpoint.APNS_PRODUCTION, token: deviceToken },
      options(memberToken),
    );
    await expect(db.prepare(
      "select user_id from briar_mobile_push_registrations where token = ?",
    ).bind(deviceToken).first()).resolves.toBeNull();

    await client.registerMobilePushDevice(
      {
        endpoint: MobilePushEndpoint.FCM,
        token: fcmToken,
        locale: MobilePushLocale.ZH,
        preferences,
      },
      options(ownerToken),
    );
    await expect(db.prepare(
      `select platform, environment, topic, locale
       from briar_mobile_push_registrations where token = ?`,
    ).bind(fcmToken).first()).resolves.toEqual({
      platform: "fcm",
      environment: "production",
      topic: "app.briar.companion",
      locale: "zh",
    });
    await client.unregisterMobilePushDevice(
      { endpoint: MobilePushEndpoint.FCM, token: fcmToken },
      options(ownerToken),
    );
  });

  it("rejects incomplete generated registration requests", async () => {
    const invalidRequests = [
      {
        endpoint: MobilePushEndpoint.UNSPECIFIED,
        token: deviceToken,
        locale: MobilePushLocale.EN,
        preferences,
      },
      {
        endpoint: MobilePushEndpoint.FCM,
        token: "short",
        locale: MobilePushLocale.EN,
        preferences,
      },
      {
        endpoint: MobilePushEndpoint.FCM,
        token: deviceToken,
        locale: MobilePushLocale.UNSPECIFIED,
        preferences,
      },
      {
        endpoint: MobilePushEndpoint.FCM,
        token: deviceToken,
        locale: MobilePushLocale.EN,
      },
    ];
    for (const request of invalidRequests) {
      const error = await client.registerMobilePushDevice(
        request,
        options(ownerToken),
      ).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    }
  });
});
