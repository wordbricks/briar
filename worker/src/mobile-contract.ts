import { z } from "zod";

export const mobileClientIds = ["briar-mobile", "briar-android"] as const;
export const mobileClientIdSchema = z.enum(mobileClientIds);

export const mobileHealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("briar-api"),
  database: z.string(),
  updates: z.string(),
});

export const mobileDeviceCodeRequestSchema = z.object({
  client_id: mobileClientIdSchema,
  scope: z.literal("openid profile email"),
}).strict();

export const mobileDeviceCodeResponseSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.url(),
  verification_uri_complete: z.url().optional(),
  expires_in: z.number().int().positive().optional(),
  interval: z.number().int().positive().optional(),
});

export const mobileDeviceTokenRequestSchema = z.object({
  grant_type: z.literal("urn:ietf:params:oauth:grant-type:device_code"),
  device_code: z.string().min(1),
  client_id: mobileClientIdSchema,
}).strict();

export const mobileDeviceTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
});

export const mobileDeviceTokenErrorSchema = z.object({
  error: z.enum([
    "authorization_pending",
    "slow_down",
    "access_denied",
    "expired_token",
  ]),
  error_description: z.string().optional(),
});

export const mobileCurrentUserResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    username: z.string().nullable().optional(),
    name: z.string(),
    email: z.email(),
    image: z.string().nullable().optional(),
  }),
});

export const mobileProjectsResponseSchema = z.object({
  projects: z.array(z.object({
    id: z.uuid(),
    name: z.string(),
    icon: z.string().nullable(),
    organizationId: z.uuid(),
    organizationName: z.string(),
    role: z.enum(["owner", "admin", "member"]),
    createdAt: z.iso.datetime(),
  })),
});

export const mobileOperationSchemas = {
  getHealth: { response: mobileHealthResponseSchema },
  beginDeviceAuthorization: {
    request: mobileDeviceCodeRequestSchema,
    response: mobileDeviceCodeResponseSchema,
  },
  pollDeviceToken: {
    request: mobileDeviceTokenRequestSchema,
    response: mobileDeviceTokenResponseSchema,
    errorResponse: mobileDeviceTokenErrorSchema,
  },
  getCurrentUser: { response: mobileCurrentUserResponseSchema },
  listProjects: { response: mobileProjectsResponseSchema },
} as const;

export function isMobileClientId(value: string) {
  return mobileClientIdSchema.safeParse(value).success;
}
