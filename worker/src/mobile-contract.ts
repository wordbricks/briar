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

export const mobileIssueAttachmentSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().nonnegative(),
  url: z.string().startsWith("/projects/"),
});

export const mobileDashboardRunSchema = z.object({
  id: z.uuid(),
  runNumber: z.number().int().positive(),
  currentAttempt: z.number().int().positive(),
  currentRevision: z.number().int().positive(),
  title: z.string(),
  status: z.enum([
    "backlog",
    "queued",
    "running",
    "blocked",
    "failed",
    "completed",
    "cancelled",
  ]),
  workflowStage: z.string().nullable(),
  detail: z.string().nullable().optional(),
  issueDescription: z.string().nullable(),
  attachments: z.array(mobileIssueAttachmentSchema),
  resultSummary: z.string().nullable(),
  structuredResult: z.object({
    summary: z.string(),
    outcome: z.string(),
    humanActionRequired: z.boolean(),
    nextAction: z.string().nullable(),
  }).nullable(),
  resultReviews: z.array(z.object({
    userId: z.string(),
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    completedAt: z.iso.datetime(),
  })),
  pullRequestUrls: z.array(z.url()),
  updatedAt: z.iso.datetime(),
});

const mobileDashboardProjectSchema = mobileProjectsResponseSchema.shape.projects.element;

export const mobileDashboardSnapshotSchema = z.object({
  project: mobileDashboardProjectSchema,
  runs: z.array(mobileDashboardRunSchema),
  cursor: z.number().int().nonnegative().optional(),
  generatedAt: z.iso.datetime(),
});

export const mobileDashboardDeltaSchema = z.object({
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  runs: z.array(mobileDashboardRunSchema),
  deletedRunIds: z.array(z.uuid()),
  project: mobileDashboardProjectSchema.optional(),
  generatedAt: z.iso.datetime(),
});

export const mobileDashboardCursorExpiredSchema = z.object({
  code: z.literal("dashboard_cursor_expired"),
  message: z.string(),
});

export const mobileRunEventsResponseSchema = z.object({
  runId: z.uuid(),
  eventCount: z.number().int().nonnegative(),
  events: z.array(z.object({
    id: z.uuid(),
    attempt: z.number().int().positive(),
    revision: z.number().int().positive(),
    status: mobileDashboardRunSchema.shape.status,
    workflowStage: z.string().nullable(),
    detail: z.string().nullable(),
    actor: z.string(),
    occurredAt: z.iso.datetime(),
  })),
});

export const mobileRunEvidenceResponseSchema = z.object({
  runId: z.uuid(),
  attempt: z.number().int().positive(),
  revision: z.number().int().positive(),
  evidence: z.array(z.object({
    key: z.string(),
    attempt: z.number().int().positive(),
    revision: z.number().int().positive(),
    stage: z.string(),
    type: z.string(),
    status: z.enum(["pending", "passed", "failed", "skipped"]),
    detail: z.string().nullable(),
    command: z.string().nullable(),
    url: z.url().nullable(),
    actor: z.string(),
    observedAt: z.iso.datetime(),
    images: z.array(z.object({
      id: z.uuid(),
      filename: z.string(),
      contentType: z.string(),
      byteSize: z.number().int().nonnegative(),
      url: z.string().startsWith("/projects/"),
    })),
    requiredRevision: z.number().int().positive(),
    canonical: z.boolean(),
  })),
});

export const mobileIssueMessagesResponseSchema = z.object({
  messages: z.array(z.object({
    id: z.uuid(),
    runId: z.uuid(),
    parentMessageId: z.uuid().nullable(),
    body: z.string(),
    author: z.object({
      id: z.string().nullable(),
      name: z.string(),
      image: z.string().nullable(),
      provider: z.string().nullable(),
    }),
    replyCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
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
  getDashboardSnapshot: { response: mobileDashboardSnapshotSchema },
  getDashboardDelta: {
    response: mobileDashboardDeltaSchema,
    errorResponse: mobileDashboardCursorExpiredSchema,
  },
  listRunEvents: { response: mobileRunEventsResponseSchema },
  listRunEvidence: { response: mobileRunEvidenceResponseSchema },
  listIssueMessages: { response: mobileIssueMessagesResponseSchema },
} as const;

export function isMobileClientId(value: string) {
  return mobileClientIdSchema.safeParse(value).success;
}
