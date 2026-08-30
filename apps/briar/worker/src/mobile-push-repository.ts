export type MobilePushPlatform = "apns" | "fcm";
export type MobilePushLocale = "ko" | "en" | "zh";

export type MobilePushPreferences = {
  playSound: boolean;
  urgent: boolean;
  actionRequired: boolean;
  important: boolean;
  activity: boolean;
};

export type MobilePushRegistrationInput = {
  platform: MobilePushPlatform;
  token: string;
  environment: "development" | "production";
  topic: string;
  locale: MobilePushLocale;
  preferences: MobilePushPreferences;
};

export type MobilePushRegistrationRow = {
  id: string;
  user_id: string;
  platform: MobilePushPlatform;
  token: string;
  environment: "development" | "production";
  topic: string;
  locale: MobilePushLocale;
  play_sound: number;
  notify_urgent: number;
  notify_action_required: number;
  notify_important: number;
  notify_activity: number;
  registered_at: string;
  baseline_version: number | null;
};

export type MobilePushOutboxRow = {
  organization_id: string;
  version: number;
};

export async function upsertMobilePushRegistration(
  db: D1Database,
  userId: string,
  input: MobilePushRegistrationInput,
  observedAt: string,
) {
  await db.prepare(
    `delete from briar_mobile_push_registrations
     where platform = ? and token = ? and user_id <> ?`,
  ).bind(input.platform, input.token, userId).run();
  const id = crypto.randomUUID();
  const row = await db.prepare(
    `insert into briar_mobile_push_registrations (
       id, user_id, platform, token, environment, topic, locale,
       play_sound, notify_urgent, notify_action_required, notify_important,
       notify_activity, registered_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(platform, token) do update set
       environment = excluded.environment,
       topic = excluded.topic,
       locale = excluded.locale,
       play_sound = excluded.play_sound,
       notify_urgent = excluded.notify_urgent,
       notify_action_required = excluded.notify_action_required,
       notify_important = excluded.notify_important,
       notify_activity = excluded.notify_activity,
       updated_at = excluded.updated_at
     returning id, registered_at`,
  ).bind(
    id,
    userId,
    input.platform,
    input.token,
    input.environment,
    input.topic,
    input.locale,
    input.preferences.playSound ? 1 : 0,
    input.preferences.urgent ? 1 : 0,
    input.preferences.actionRequired ? 1 : 0,
    input.preferences.important ? 1 : 0,
    input.preferences.activity ? 1 : 0,
    observedAt,
    observedAt,
  ).first<{ id: string; registered_at: string }>();
  if (!row) throw new Error("Mobile push registration was not persisted");
  await db.prepare(
    `insert into briar_mobile_push_registration_scopes (
       registration_id, organization_id, baseline_version,
       registered_at, updated_at
     )
     select ?, membership.organization_id, coalesce(sync.current_version, 0),
            ?, ?
     from briar_organization_members membership
     left join briar_organization_inbox_sync_state sync
       on sync.organization_id = membership.organization_id
     where membership.user_id = ?
     on conflict(registration_id, organization_id) do nothing`,
  ).bind(row.id, row.registered_at, observedAt, userId).run();
  return { id: row.id };
}
export async function deleteMobilePushRegistration(
  db: D1Database,
  userId: string,
  platform: MobilePushPlatform,
  token: string,
) {
  const result = await db.prepare(
    `delete from briar_mobile_push_registrations
     where user_id = ? and platform = ? and token = ?`,
  ).bind(userId, platform, token).run();
  return result.meta.changes > 0;
}

export async function deleteMobilePushRegistrationById(
  db: D1Database,
  registrationId: string,
) {
  await db.prepare(
    `delete from briar_mobile_push_registrations where id = ?`,
  ).bind(registrationId).run();
}

export async function listMobilePushOutbox(
  db: D1Database,
  limit = 50,
) {
  const result = await db.prepare(
    `select organization_id, version
     from briar_mobile_push_outbox
     order by updated_at, organization_id
     limit ?`,
  ).bind(Math.max(1, Math.min(limit, 50))).all<MobilePushOutboxRow>();
  return result.results;
}

export async function acknowledgeMobilePushOutbox(
  db: D1Database,
  organizationId: string,
  version: number,
) {
  await db.prepare(
    `delete from briar_mobile_push_outbox
     where organization_id = ? and version <= ?`,
  ).bind(organizationId, version).run();
}

export async function listMobilePushRegistrations(
  db: D1Database,
  organizationId: string,
) {
  const result = await db.prepare(
    `select registration.id, registration.user_id, registration.platform,
            registration.token, registration.environment, registration.topic,
            registration.locale, registration.play_sound,
            registration.notify_urgent,
            registration.notify_action_required,
            registration.notify_important, registration.notify_activity,
            registration.registered_at, scope.baseline_version
     from briar_mobile_push_registrations registration
     join briar_organization_members membership
       on membership.user_id = registration.user_id
      and membership.organization_id = ?
     left join briar_mobile_push_registration_scopes scope
       on scope.registration_id = registration.id
      and scope.organization_id = membership.organization_id
     order by registration.updated_at, registration.id`,
  ).bind(organizationId).all<MobilePushRegistrationRow>();
  return result.results;
}

export async function establishMobilePushScope(
  db: D1Database,
  registrationId: string,
  organizationId: string,
  version: number,
  observedAt: string,
) {
  await db.prepare(
    `insert into briar_mobile_push_registration_scopes (
       registration_id, organization_id, baseline_version,
       registered_at, updated_at
     ) values (?, ?, ?, ?, ?)
     on conflict(registration_id, organization_id) do nothing`,
  ).bind(
    registrationId,
    organizationId,
    version,
    observedAt,
    observedAt,
  ).run();
}

export async function advanceMobilePushScope(
  db: D1Database,
  registrationId: string,
  organizationId: string,
  version: number,
  observedAt: string,
) {
  await db.prepare(
    `update briar_mobile_push_registration_scopes
     set baseline_version = max(baseline_version, ?), updated_at = ?
     where registration_id = ? and organization_id = ?`,
  ).bind(version, observedAt, registrationId, organizationId).run();
}

export async function listMobilePushDeliveries(
  db: D1Database,
  registrationId: string,
) {
  const result = await db.prepare(
    `select message_id, message_version
     from briar_mobile_push_deliveries
     where registration_id = ?
     order by delivered_at desc
     limit 4000`,
  ).bind(registrationId).all<{
    message_id: string;
    message_version: string;
  }>();
  return result.results;
}

export async function recordMobilePushDeliveries(
  db: D1Database,
  registrationId: string,
  messages: ReadonlyArray<{ id: string; version: string }>,
  deliveredAt: string,
) {
  if (messages.length === 0) return;
  await db.batch(messages.map((message) =>
    db.prepare(
      `insert or ignore into briar_mobile_push_deliveries (
         registration_id, message_id, message_version, delivered_at
       ) values (?, ?, ?, ?)`,
    ).bind(registrationId, message.id, message.version, deliveredAt)
  ));
}

export async function pruneMobilePushDeliveries(
  db: D1Database,
  cutoff: string,
) {
  await db.prepare(
    `delete from briar_mobile_push_deliveries
     where rowid in (
       select rowid from briar_mobile_push_deliveries
       where delivered_at < ?
       order by delivered_at
       limit 500
     )`,
  ).bind(cutoff).run();
}
