import { toBinary } from "@bufbuild/protobuf";
import {
  type MobilePushNotificationTarget,
  MobilePushNotificationTargetSchema,
} from "@briar/contracts/gen/briar/app/v1/inbox_pb";
import type {
  MobilePushRegistrationRow,
} from "./mobile-push-repository";

export type MobilePushContent = {
  title: string;
  body: string;
  collapseId: string;
  target: MobilePushNotificationTarget;
};

export type MobilePushProviderResult =
  | { outcome: "delivered" }
  | { outcome: "invalid_token"; reason: string }
  | { outcome: "retry"; reason: string };

type CachedCredential = { value: string; expiresAt: number };
let cachedApnsCredential: CachedCredential | null = null;
let cachedFcmCredential: CachedCredential | null = null;

export function mobilePushProvidersConfigured(env: Env) {
  const apnsConfigured = Boolean(
    env.APNS_TEAM_ID?.trim() &&
      env.APNS_KEY_ID?.trim() &&
      env.APNS_PRIVATE_KEY?.trim(),
  );
  const fcmConfigured = Boolean(
    env.FIREBASE_PROJECT_ID?.trim() &&
      env.FIREBASE_CLIENT_EMAIL?.trim() &&
      env.FIREBASE_PRIVATE_KEY?.trim(),
  );
  return apnsConfigured || fcmConfigured;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function standardBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function mobilePushTargetProtoBase64(
  target: MobilePushNotificationTarget,
) {
  return standardBase64(
    toBinary(MobilePushNotificationTargetSchema, target),
  );
}

export function mobilePushTargetProviderData(
  target: MobilePushNotificationTarget,
) {
  return {
    briarInboxTargetProto: mobilePushTargetProtoBase64(target),
  };
}

const encodeJson = (value: unknown) =>
  base64Url(new TextEncoder().encode(JSON.stringify(value)));

function pemBytes(value: string) {
  const encoded = value
    .replace(/-----BEGIN [^-]+-----/gu, "")
    .replace(/-----END [^-]+-----/gu, "")
    .replace(/\s/gu, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function apnsCredential(env: Env, now = Date.now()) {
  if (
    cachedApnsCredential &&
    cachedApnsCredential.expiresAt > now + 60_000
  ) return cachedApnsCredential.value;
  const teamId = env.APNS_TEAM_ID?.trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const privateKey = env.APNS_PRIVATE_KEY?.trim();
  if (!teamId || !keyId || !privateKey) return null;
  const issuedAt = Math.floor(now / 1_000);
  const header = encodeJson({ alg: "ES256", kid: keyId });
  const claims = encodeJson({ iss: teamId, iat: issuedAt });
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );
  const value = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  cachedApnsCredential = {
    value,
    expiresAt: now + 50 * 60 * 1_000,
  };
  return value;
}

async function jsonObject(response: Response) {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function normalizedMobilePushCollapseId(value: string) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= 64) return value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `briar-${base64Url(new Uint8Array(digest))}`;
}

async function sendApns(
  env: Env,
  registration: MobilePushRegistrationRow,
  content: MobilePushContent,
): Promise<MobilePushProviderResult> {
  const credential = await apnsCredential(env);
  if (!credential) {
    return { outcome: "retry", reason: "apns_not_configured" };
  }
  const collapseId = await normalizedMobilePushCollapseId(content.collapseId);
  const host = registration.environment === "development"
    ? "api.sandbox.push.apple.com"
    : "api.push.apple.com";
  const response = await fetch(
    `https://${host}/3/device/${encodeURIComponent(registration.token)}`,
    {
      method: "POST",
      headers: {
        authorization: `bearer ${credential}`,
        "apns-topic": registration.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-collapse-id": collapseId,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        aps: {
          alert: { title: content.title, body: content.body },
          ...(registration.play_sound ? { sound: "default" } : {}),
          "thread-id": collapseId,
        },
        ...mobilePushTargetProviderData(content.target),
      }),
    },
  );
  if (response.ok) return { outcome: "delivered" };
  const body = await jsonObject(response);
  const reason = typeof body?.reason === "string"
    ? body.reason
    : `http_${response.status}`;
  if (
    response.status === 410 ||
    reason === "BadDeviceToken" ||
    reason === "Unregistered" ||
    reason === "DeviceTokenNotForTopic"
  ) return { outcome: "invalid_token", reason };
  return { outcome: "retry", reason };
}

async function fcmCredential(env: Env, now = Date.now()) {
  if (
    cachedFcmCredential &&
    cachedFcmCredential.expiresAt > now + 60_000
  ) return cachedFcmCredential.value;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = env.FIREBASE_PRIVATE_KEY?.trim();
  if (!clientEmail || !privateKey) return null;
  const issuedAt = Math.floor(now / 1_000);
  const expiresAt = issuedAt + 3_600;
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const claims = encodeJson({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: expiresAt,
  });
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await jsonObject(response);
  const accessToken = typeof body?.access_token === "string"
    ? body.access_token
    : null;
  const expiresIn = typeof body?.expires_in === "number"
    ? body.expires_in
    : 3_600;
  if (!response.ok || !accessToken) return null;
  cachedFcmCredential = {
    value: accessToken,
    expiresAt: now + Math.max(60, expiresIn - 120) * 1_000,
  };
  return accessToken;
}

function fcmErrorCode(body: Record<string, unknown> | null) {
  const error = body?.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const record = error as Record<string, unknown>;
  const details = Array.isArray(record.details) ? record.details : [];
  for (const detail of details) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) continue;
    const code = (detail as Record<string, unknown>).errorCode;
    if (typeof code === "string") return code;
  }
  return typeof record.status === "string" ? record.status : null;
}

async function sendFcm(
  env: Env,
  registration: MobilePushRegistrationRow,
  content: MobilePushContent,
): Promise<MobilePushProviderResult> {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const credential = await fcmCredential(env);
  if (!projectId || !credential) {
    return { outcome: "retry", reason: "fcm_not_configured" };
  }
  const collapseId = await normalizedMobilePushCollapseId(content.collapseId);
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: registration.token,
          notification: { title: content.title, body: content.body },
          data: mobilePushTargetProviderData(content.target),
          android: {
            priority: "high",
            notification: {
              tag: collapseId,
              ...(registration.play_sound ? { sound: "default" } : {}),
              clickAction: "BRIAR_INBOX_NOTIFICATION",
            },
          },
        },
      }),
    },
  );
  if (response.ok) return { outcome: "delivered" };
  const body = await jsonObject(response);
  const reason = fcmErrorCode(body) ?? `http_${response.status}`;
  if (reason === "UNREGISTERED" || reason === "NOT_FOUND") {
    return { outcome: "invalid_token", reason };
  }
  return { outcome: "retry", reason };
}

export async function sendMobilePush(
  env: Env,
  registration: MobilePushRegistrationRow,
  content: MobilePushContent,
) {
  try {
    return registration.platform === "apns"
      ? await sendApns(env, registration, content)
      : await sendFcm(env, registration, content);
  } catch (error) {
    return {
      outcome: "retry" as const,
      reason: error instanceof Error ? error.name : "provider_error",
    };
  }
}

export function resetMobilePushProviderCachesForTest() {
  cachedApnsCredential = null;
  cachedFcmCredential = null;
}
