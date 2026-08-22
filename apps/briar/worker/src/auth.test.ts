import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, handleAuthRequest } from "./auth";
import {
  consumeEmailOTPEmailLimit,
  type AuthEmailMessage,
  type AuthEmailSender,
} from "./auth-email";
import {
  createIsolatedTestDatabase,
  type IsolatedTestDatabase,
} from "./test-helpers/d1";

const apiOrigin = "https://briar-api.example";
const secret = "test-secret-with-enough-entropy-for-email-otp";

class FakeEmailSender implements AuthEmailSender {
  messages: AuthEmailMessage[] = [];
  failure: Error | null = null;

  async send(message: AuthEmailMessage) {
    this.messages.push(message);
    if (this.failure) throw this.failure;
    return { messageId: `fake-${this.messages.length}` };
  }
}

const otpFrom = (message: AuthEmailMessage) => {
  const match = message.text.match(/\b\d{6}\b/u);
  if (!match) throw new Error("OTP was not present in the fake email");
  return match[0];
};

describe("email OTP authentication", () => {
  let database: IsolatedTestDatabase;
  let db: D1Database;
  let sender: FakeEmailSender;
  let backgroundTasks: Promise<unknown>[];
  let auth: ReturnType<typeof createAuth>;

  beforeEach(async () => {
    database = await createIsolatedTestDatabase({ suite: "auth-email-otp" });
    db = database.db;
    sender = new FakeEmailSender();
    backgroundTasks = [];
    const env = {
      DB: db,
      BETTER_AUTH_SECRET: secret,
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
    } as unknown as Env;
    auth = createAuth(
      env,
      apiOrigin,
      { waitUntil: (promise) => backgroundTasks.push(promise) },
      sender,
    );
  }, 60_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await database.dispose();
  });

  const post = async (
    path: string,
    body: Record<string, unknown>,
    ip = "203.0.113.10",
    locale = "ko",
  ) => handleAuthRequest(
    new Request(`${apiOrigin}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": ip,
        "x-briar-locale": locale,
      },
      body: JSON.stringify(body),
    }),
    auth,
    db,
    secret,
    true,
  );

  const sendCode = async (
    email: string,
    ip = "203.0.113.10",
    locale = "ko",
  ) => {
    const response = await post(
      "/api/auth/email-otp/send-verification-otp",
      { email, type: "sign-in" },
      ip,
      locale,
    );
    await Promise.all(backgroundTasks.splice(0));
    return response;
  };

  it("normalizes email, stores an encrypted OTP, and creates a new session", async () => {
    await expect(sendCode("  New.User@Example.COM ", undefined, "zh"))
      .resolves.toMatchObject({ status: 200 });
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]).toMatchObject({
      to: "new.user@example.com",
      from: "login@auth.wordbricks.ai",
      subject: "Briar 登录验证码",
    });
    const otp = otpFrom(sender.messages[0]!);
    const verification = await db.prepare(
      `select identifier, value from verification where identifier = ?`,
    ).bind("sign-in-otp-new.user@example.com").first<{
      identifier: string;
      value: string;
    }>();
    expect(verification?.value).not.toContain(otp);

    const response = await post("/api/auth/sign-in/email-otp", {
      email: "NEW.USER@example.com",
      otp,
      name: "New User",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("better-auth.session_token");
    await expect(
      db.prepare(
        `select email, emailVerified from "user" where email = ?`,
      ).bind("new.user@example.com").first(),
    ).resolves.toEqual({ email: "new.user@example.com", emailVerified: 1 });
  });

  it("uses the existing Google user when the verified email matches", async () => {
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, image, createdAt, updatedAt
         ) values (?, ?, ?, 1, null, ?, ?)`,
      ).bind(
        "google-user",
        "Google User",
        "same@example.com",
        "2026-08-19T00:00:00.000Z",
        "2026-08-19T00:00:00.000Z",
      ),
      db.prepare(
        `insert into account (
           id, accountId, providerId, userId, createdAt, updatedAt
         ) values (?, ?, 'google', ?, ?, ?)`,
      ).bind(
        "google-account",
        "google-subject",
        "google-user",
        "2026-08-19T00:00:00.000Z",
        "2026-08-19T00:00:00.000Z",
      ),
    ]);
    await sendCode("SAME@EXAMPLE.COM");
    const response = await post("/api/auth/sign-in/email-otp", {
      email: "same@example.com",
      otp: otpFrom(sender.messages[0]!),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { id: "google-user" } });
    await expect(
      db.prepare(`select count(*) as count from "user"`).first(),
    ).resolves.toEqual({ count: 1 });
  });

  it("rejects expired codes and consumes the three-attempt budget", async () => {
    await sendCode("attempts@example.com");
    const validOtp = otpFrom(sender.messages[0]!);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await post("/api/auth/sign-in/email-otp", {
        email: "attempts@example.com",
        otp: validOtp === "000000" ? "111111" : "000000",
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_OTP" });
    }
    const exhausted = await post("/api/auth/sign-in/email-otp", {
      email: "attempts@example.com",
      otp: validOtp,
    });
    expect(exhausted.status).toBe(403);
    await expect(exhausted.json()).resolves.toMatchObject({
      code: "TOO_MANY_ATTEMPTS",
    });

    await sendCode("expired@example.com", "203.0.113.11");
    await db.prepare(
      `update verification set expiresAt = ? where identifier = ?`,
    ).bind("2000-01-01T00:00:00.000Z", "sign-in-otp-expired@example.com").run();
    const expired = await post("/api/auth/sign-in/email-otp", {
      email: "expired@example.com",
      otp: otpFrom(sender.messages[1]!),
    }, "203.0.113.11");
    expect(expired.status).toBe(400);
    await expect(expired.json()).resolves.toMatchObject({ code: "OTP_EXPIRED" });
  });

  it("reuses the active OTP and extends its expiry on resend", async () => {
    await sendCode("resend@example.com");
    const shortenedExpiry = new Date(Date.now() + 30_000).toISOString();
    await db.prepare(
      `update verification set expiresAt = ? where identifier = ?`,
    ).bind(shortenedExpiry, "sign-in-otp-resend@example.com").run();
    const before = await db.prepare(
      `select value, expiresAt from verification where identifier = ?`,
    ).bind("sign-in-otp-resend@example.com").first<{
      value: string;
      expiresAt: string;
    }>();
    await db.prepare(
      `update briar_auth_email_rate_limits set last_sent_at = last_sent_at - 61`,
    ).run();
    await sendCode("RESEND@example.com", "203.0.113.10", "en");
    const after = await db.prepare(
      `select value, expiresAt from verification where identifier = ?`,
    ).bind("sign-in-otp-resend@example.com").first<{
      value: string;
      expiresAt: string;
    }>();
    expect(sender.messages.map(otpFrom)).toEqual([
      otpFrom(sender.messages[0]!),
      otpFrom(sender.messages[0]!),
    ]);
    expect(after?.value).toBe(before?.value);
    expect(new Date(after!.expiresAt).getTime())
      .toBeGreaterThan(new Date(before!.expiresAt).getTime());
  });

  it("enforces cooldown, hourly email limits, and the shared IP limit", async () => {
    const first = await consumeEmailOTPEmailLimit(
      db,
      "limited@example.com",
      secret,
      0,
    );
    expect(first.allowed).toBe(true);
    const cooldown = await consumeEmailOTPEmailLimit(
      db,
      "LIMITED@example.com",
      secret,
      30_000,
    );
    expect(cooldown).toMatchObject({ allowed: false, retryAfter: 30 });
    for (let count = 1; count < 5; count += 1) {
      await expect(consumeEmailOTPEmailLimit(
        db,
        "limited@example.com",
        secret,
        count * 61_000,
      )).resolves.toMatchObject({ allowed: true });
    }
    await expect(consumeEmailOTPEmailLimit(
      db,
      "limited@example.com",
      secret,
      5 * 61_000,
    )).resolves.toMatchObject({ allowed: false, retryAfter: 3_295 });

    for (let count = 0; count < 20; count += 1) {
      const response = await sendCode(
        `ip-${count}@example.com`,
        "198.51.100.20",
      );
      expect(response.status).toBe(200);
    }
    const blocked = await sendCode("ip-blocked@example.com", "198.51.100.20");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("X-Retry-After")).toBeTruthy();
  });

  it("returns retry headers for the per-email cooldown", async () => {
    expect((await sendCode("cooldown@example.com")).status).toBe(200);
    const blocked = await sendCode("COOLDOWN@example.com");
    expect(blocked.status).toBe(429);
    const retryAfter = blocked.headers.get("Retry-After");
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    expect(Number(retryAfter)).toBeLessThanOrEqual(60);
    expect(blocked.headers.get("X-Retry-After")).toBe(retryAfter);
  });

  it("hides unused OTP paths and non-sign-in send types", async () => {
    const passwordReset = await post(
      "/api/auth/email-otp/request-password-reset",
      { email: "hidden@example.com" },
    );
    expect(passwordReset.status).toBe(404);
    const wrongType = await post(
      "/api/auth/email-otp/send-verification-otp",
      { email: "hidden@example.com", type: "forget-password" },
    );
    expect(wrongType.status).toBe(400);
  });

  it("logs only a correlation ID and safe error code when delivery fails", async () => {
    sender.failure = Object.assign(
      new Error("failure for private.person@example.com and code 123456"),
      { code: "E_TEST_DELIVERY" },
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await sendCode("private.person@example.com");
    expect(response.status).toBe(200);
    const output = consoleError.mock.calls.flat().join(" ");
    expect(output).toContain("Authentication email delivery failed");
    expect(output).toContain("E_TEST_DELIVERY");
    expect(output).not.toContain("private.person@example.com");
    expect(output).not.toContain(otpFrom(sender.messages[0]!));
  });
});

describe("email OTP availability", () => {
  it("does not expose email OTP routes when no mail sender is configured", async () => {
    const handler = vi.fn();
    const selfHostedAuth = { handler } as unknown as ReturnType<typeof createAuth>;
    const response = await handleAuthRequest(
      new Request(`${apiOrigin}/api/auth/email-otp/send-verification-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "self-hosted@example.com",
          type: "sign-in",
        }),
      }),
      selfHostedAuth,
      {} as D1Database,
      secret,
      false,
    );
    expect(response.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
});
