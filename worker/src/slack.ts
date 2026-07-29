import type { AutoHuntRunStatus } from "../../src/lib/auto-hunt-contract";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const slackBotScopes = ["app_mentions:read", "chat:write"] as const;
export const slackOAuthStateTtlMs = 10 * 60_000;
export const slackEventClaimTtlMs = 5 * 60_000;

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const timingSafeEqual = (left: string, right: string) => {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

export async function sha256Hex(value: string) {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
  );
}

export function randomUrlSafeToken(bytes = 32) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function verifySlackRequest(
  rawBody: string,
  headers: Headers,
  signingSecret: string,
  now = Date.now(),
) {
  const timestamp = headers.get("x-slack-request-timestamp");
  const signature = headers.get("x-slack-signature");
  if (!timestamp || !signature || !/^\d+$/u.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 5 * 60) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`v0:${timestamp}:${rawBody}`),
    ),
  );
  return timingSafeEqual(`v0=${bytesToHex(digest)}`, signature);
}

async function tokenEncryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSlackToken(token: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await tokenEncryptionKey(secret),
    encoder.encode(token),
  );
  return {
    encryptedToken: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptSlackToken(
  encryptedToken: string,
  iv: string,
  secret: string,
) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await tokenEncryptionKey(secret),
    base64ToBytes(encryptedToken),
  );
  return decoder.decode(plaintext);
}

export type SlackIssueInstruction = {
  title: string;
  description: string | null;
  priority: number | null;
  status: Extract<AutoHuntRunStatus, "backlog" | "queued">;
};

const priorityByName: Record<string, number> = {
  urgent: 1,
  긴급: 1,
  high: 2,
  높음: 2,
  medium: 3,
  normal: 3,
  보통: 3,
  low: 4,
  낮음: 4,
};

export function parseSlackIssueInstruction(
  text: string,
): SlackIssueInstruction | null {
  let normalized = text
    .replace(/<@[A-Z0-9]+>/giu, " ")
    .replace(/\r\n?/gu, "\n")
    .trim();
  if (!normalized) return null;
  if (/^(?:help|도움말|사용법|\?)$/iu.test(normalized)) return null;

  let status: SlackIssueInstruction["status"] = "queued";
  normalized = normalized.replace(
    /(?:^|\s)--(backlog|백로그)(?=\s|$)/giu,
    () => {
      status = "backlog";
      return " ";
    },
  );
  normalized = normalized.replace(
    /(?:^|\s)--(?:queue|queued|대기)(?=\s|$)/giu,
    () => {
      status = "queued";
      return " ";
    },
  );

  let priority: number | null = null;
  normalized = normalized.replace(
    /(?:^|\s)--(?:priority|우선순위)(?:=|\s+)(p?[1-4]|urgent|high|medium|normal|low|긴급|높음|보통|낮음)(?=\s|$)/giu,
    (_match, rawPriority: string) => {
      const key = rawPriority.toLocaleLowerCase();
      priority = /^p?[1-4]$/u.test(key)
        ? Number(key.replace(/^p/u, ""))
        : (priorityByName[key] ?? null);
      return " ";
    },
  );

  normalized = normalized
    .replace(
      /^(?:(?:이슈|issue|bug|버그)\s*)?(?:만들어\s*줘|만들어줘|생성해\s*줘|생성해줘|생성|등록|create|file)\s*[:：-]?\s*/iu,
      "",
    )
    .replace(/^(?:이슈|issue)\s*[:：-]\s*/iu, "")
    .trim();

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const title = lines.shift()?.replace(/\s+/gu, " ").trim() ?? "";
  if (!title) return null;

  return {
    title: title.slice(0, 300),
    description: lines.length > 0 ? lines.join("\n") : null,
    priority,
    status,
  };
}

export function slackHelpMessage() {
  return [
    "*Briar 이슈 만들기*",
    "멘션 뒤 첫 줄은 제목, 다음 줄부터는 설명으로 저장됩니다.",
    "예: `@Briar 로그인 버튼이 동작하지 않아요 --priority high`",
    "옵션: `--backlog`, `--priority P1` (P1~P4)",
  ].join("\n");
}

type SlackApiResponse = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

export async function callSlackApi<T extends SlackApiResponse>(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T;
  if (!response.ok || !result.ok) {
    throw new Error(`Slack ${method} failed: ${result.error ?? response.status}`);
  }
  return result;
}

export async function exchangeSlackOAuthCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}) {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = (await response.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
  };
  if (
    !response.ok ||
    !result.ok ||
    !result.access_token ||
    !result.bot_user_id ||
    !result.team?.id ||
    !result.team.name
  ) {
    throw new Error(`Slack OAuth failed: ${result.error ?? response.status}`);
  }
  return {
    token: result.access_token,
    botUserId: result.bot_user_id,
    teamId: result.team.id,
    teamName: result.team.name,
  };
}
