import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization, emailOTP } from "better-auth/plugins";
import * as Schema from "effect/Schema";
import { trustedAuthOrigins } from "./auth-origins";
import {
  consumeEmailOTPEmailLimit,
  logAuthEmailFailure,
  normalizeAuthEmail,
  resolveAuthLocale,
  sendAuthOTPEmail,
  type AuthEmailSender,
} from "./auth-email";

const deviceAuthorizationClientIdSchema = Schema.Literals([
  "briar-mobile",
  "briar-android",
  "briar-desktop",
  "briar-cli",
]);
const isDeviceAuthorizationClient = Schema.is(
  deviceAuthorizationClientIdSchema,
);

type AuthExecutionContext = Pick<ExecutionContext, "waitUntil">;

export function authEmailSenderFromEnv(env: Env): AuthEmailSender | undefined {
  return (env as Env & { EMAIL?: AuthEmailSender }).EMAIL;
}

export function createAuth(
  env: Env,
  apiOrigin: string,
  executionContext?: AuthExecutionContext,
  emailSender = authEmailSenderFromEnv(env),
) {
  const advanced = executionContext
    ? {
        backgroundTasks: {
          handler: (promise: Promise<unknown>) =>
            executionContext.waitUntil(promise),
        },
        ipAddress: {
          ipAddressHeaders: ["cf-connecting-ip"],
        },
      }
    : {
        ipAddress: {
          ipAddressHeaders: ["cf-connecting-ip"],
        },
      };
  return betterAuth({
    appName: "Briar",
    baseURL: `${apiOrigin}/api/auth`,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    user: {
      additionalFields: {
        username: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    trustedOrigins: trustedAuthOrigins(apiOrigin),
    advanced,
    account: {
      accountLinking: {
        enabled: true,
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/email-otp/send-verification-otp": {
          window: 10 * 60,
          max: 20,
        },
        // Verification attempts are bound to the stored OTP by the plugin.
        "/sign-in/email-otp": false,
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [
      bearer(),
      ...(emailSender
        ? [emailOTP({
            otpLength: 6,
            expiresIn: 5 * 60,
            allowedAttempts: 3,
            disableSignUp: false,
            storeOTP: "encrypted",
            resendStrategy: "reuse",
            sendVerificationOTP: ({ email, otp, type }, endpointContext) => {
              if (type !== "sign-in") return Promise.resolve();
              const correlationId = crypto.randomUUID();
              return sendAuthOTPEmail(emailSender, {
                email,
                otp,
                locale: resolveAuthLocale(endpointContext?.request),
              }).catch((error) => logAuthEmailFailure(error, correlationId));
            },
          })]
        : []),
      deviceAuthorization({
        verificationUri: `${apiOrigin}/device`,
        validateClient: async (clientId) =>
          isDeviceAuthorizationClient(clientId),
      }),
    ],
  });
}

const emailOTPPaths = new Set([
  "/api/auth/email-otp/send-verification-otp",
  "/api/auth/sign-in/email-otp",
]);

const jsonError = (
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
) => new Response(JSON.stringify({ code, message }), {
  status,
  headers: { "content-type": "application/json", ...headers },
});

const normalizedEmailOTPRequest = async (
  request: Request,
  requireSignInType: boolean,
) => {
  const body = await request.clone().json().catch(() => null) as
    | Record<string, unknown>
    | null;
  if (!body || typeof body.email !== "string") return null;
  if (requireSignInType && body.type !== "sign-in") return null;
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return new Request(request, {
    body: JSON.stringify({ ...body, email: normalizeAuthEmail(body.email) }),
    headers,
  });
};

export async function handleAuthRequest(
  request: Request,
  auth: BriarAuth,
  db: D1Database,
  secret: string,
  emailOTPEnabled: boolean,
) {
  const { pathname } = new URL(request.url);
  const isEmailOTPPath =
    pathname.startsWith("/api/auth/email-otp/") ||
    pathname === "/api/auth/sign-in/email-otp" ||
    pathname === "/api/auth/forget-password/email-otp";
  if (!isEmailOTPPath) return auth.handler(request);
  if (!emailOTPEnabled || !emailOTPPaths.has(pathname)) {
    return jsonError(404, "NOT_FOUND", "Not found");
  }
  if (request.method !== "POST") {
    return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed", {
      Allow: "POST",
    });
  }

  const normalizedRequest = await normalizedEmailOTPRequest(
    request,
    pathname === "/api/auth/email-otp/send-verification-otp",
  );
  if (!normalizedRequest) {
    return jsonError(400, "INVALID_EMAIL_OTP_REQUEST", "Invalid request");
  }
  if (pathname === "/api/auth/email-otp/send-verification-otp") {
    const body = await normalizedRequest.clone().json() as { email: string };
    const rateLimit = await consumeEmailOTPEmailLimit(db, body.email, secret);
    if (!rateLimit.allowed) {
      const retryAfter = String(rateLimit.retryAfter);
      return jsonError(429, "EMAIL_OTP_RATE_LIMITED", "Too many requests", {
        "Retry-After": retryAfter,
        "X-Retry-After": retryAfter,
      });
    }
  }
  return auth.handler(normalizedRequest);
}

export type BriarAuth = ReturnType<typeof createAuth>;
