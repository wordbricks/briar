export type AuthLocale = "ko" | "en" | "zh";

export type AuthEmailMessage = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
};

export type AuthEmailSender = {
  send(message: AuthEmailMessage): Promise<unknown>;
};

type EmailRateLimitRow = {
  count: number;
  window_started_at: number;
  last_sent_at: number;
};

export type EmailRateLimitResult =
  | { allowed: true; identifierHash: string }
  | { allowed: false; identifierHash: string; retryAfter: number };

const senderAddress = "login@auth.wordbricks.ai";
const resendCooldownSeconds = 60;
const hourlyWindowSeconds = 60 * 60;
const hourlySendLimit = 5;

const templates = {
  ko: {
    subject: "Briar 로그인 인증코드",
    heading: "Briar 로그인 인증코드",
    intro: "아래 6자리 코드를 Briar 로그인 화면에 입력하세요.",
    expiry: "이 코드는 5분 동안 유효합니다.",
    ignore: "직접 요청하지 않았다면 이 메일을 무시해 주세요.",
  },
  en: {
    subject: "Your Briar sign-in code",
    heading: "Briar sign-in code",
    intro: "Enter the 6-digit code below on the Briar sign-in screen.",
    expiry: "This code expires in 5 minutes.",
    ignore: "If you did not request this code, you can ignore this email.",
  },
  zh: {
    subject: "Briar 登录验证码",
    heading: "Briar 登录验证码",
    intro: "请在 Briar 登录页面输入下方的 6 位验证码。",
    expiry: "此验证码将在 5 分钟后失效。",
    ignore: "如果这不是您的操作，请忽略此邮件。",
  },
} satisfies Record<
  AuthLocale,
  { subject: string; heading: string; intro: string; expiry: string; ignore: string }
>;

const localeFromLanguage = (value: string | null | undefined): AuthLocale => {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("ko")) return "ko";
  return "en";
};

export function resolveAuthLocale(request?: Request): AuthLocale {
  return localeFromLanguage(
    request?.headers.get("x-briar-locale") ??
      request?.headers.get("accept-language"),
  );
}

export function normalizeAuthEmail(email: string) {
  return email.trim().toLowerCase();
}

const bytesToHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export async function authEmailIdentifierHash(email: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(
    await crypto.subtle.sign("HMAC", key, encoder.encode(normalizeAuthEmail(email))),
  );
}

export async function consumeEmailOTPEmailLimit(
  db: D1Database,
  email: string,
  secret: string,
  nowMs = Date.now(),
): Promise<EmailRateLimitResult> {
  const identifierHash = await authEmailIdentifierHash(email, secret);
  const now = Math.floor(nowMs / 1_000);
  const updatedAt = new Date(now * 1_000).toISOString();
  const allowed = await db
    .prepare(
      `insert into briar_auth_email_rate_limits (
         identifier_hash, window_started_at, count, last_sent_at, updated_at
       ) values (?, ?, 1, ?, ?)
       on conflict(identifier_hash) do update set
         window_started_at = case
           when excluded.window_started_at - window_started_at >= ?
             then excluded.window_started_at
           else window_started_at
         end,
         count = case
           when excluded.window_started_at - window_started_at >= ? then 1
           else count + 1
         end,
         last_sent_at = excluded.last_sent_at,
         updated_at = excluded.updated_at
       where excluded.last_sent_at - last_sent_at >= ?
         and (
           excluded.window_started_at - window_started_at >= ?
           or count < ?
         )
       returning count, window_started_at, last_sent_at`,
    )
    .bind(
      identifierHash,
      now,
      now,
      updatedAt,
      hourlyWindowSeconds,
      hourlyWindowSeconds,
      resendCooldownSeconds,
      hourlyWindowSeconds,
      hourlySendLimit,
    )
    .first<EmailRateLimitRow>();
  if (allowed) return { allowed: true, identifierHash };

  const current = await db
    .prepare(
      `select count, window_started_at, last_sent_at
       from briar_auth_email_rate_limits where identifier_hash = ?`,
    )
    .bind(identifierHash)
    .first<EmailRateLimitRow>();
  if (!current) {
    throw new Error("Email OTP rate limit state was not persisted");
  }
  const cooldownRetry = Math.max(
    0,
    resendCooldownSeconds - (now - current.last_sent_at),
  );
  const hourlyRetry =
    current.count >= hourlySendLimit &&
      now - current.window_started_at < hourlyWindowSeconds
      ? hourlyWindowSeconds - (now - current.window_started_at)
      : 0;
  return {
    allowed: false,
    identifierHash,
    retryAfter: Math.max(1, cooldownRetry, hourlyRetry),
  };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);

export function authOTPEmailMessage(input: {
  email: string;
  otp: string;
  locale: AuthLocale;
}): AuthEmailMessage {
  const copy = templates[input.locale];
  const otp = escapeHtml(input.otp);
  return {
    to: normalizeAuthEmail(input.email),
    from: senderAddress,
    subject: copy.subject,
    text: `${copy.heading}\n\n${copy.intro}\n\n${input.otp}\n\n${copy.expiry}\n${copy.ignore}`,
    html: `<!doctype html><html lang="${input.locale}"><body style="margin:0;background:#f5f3ee;color:#20231d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="display:none;max-height:0;overflow:hidden">${copy.intro}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border:1px solid #dfddd5;border-radius:20px"><tr><td style="padding:34px"><div style="font-size:20px;font-weight:750">briar</div><h1 style="margin:32px 0 12px;font-size:24px;line-height:1.25">${copy.heading}</h1><p style="margin:0;color:#666b61;font-size:15px;line-height:1.65">${copy.intro}</p><div style="margin:28px 0;padding:20px;border-radius:14px;background:#f1edff;color:#5e47ae;text-align:center;font:700 32px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:8px">${otp}</div><p style="margin:0;color:#666b61;font-size:13px;line-height:1.65">${copy.expiry}<br>${copy.ignore}</p></td></tr></table></td></tr></table></body></html>`,
  };
}

export async function sendAuthOTPEmail(
  sender: AuthEmailSender,
  input: { email: string; otp: string; locale: AuthLocale },
) {
  await sender.send(authOTPEmailMessage(input));
}

const safeEmailErrorCode = (error: unknown) => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "EMAIL_SEND_FAILED";
  return /^[A-Z0-9_.-]{1,64}$/u.test(code) ? code : "EMAIL_SEND_FAILED";
};

export function logAuthEmailFailure(error: unknown, correlationId: string) {
  console.error(JSON.stringify({
    message: "Authentication email delivery failed",
    correlationId,
    errorCode: safeEmailErrorCode(error),
  }));
}
