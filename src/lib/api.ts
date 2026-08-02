import { z } from "zod";
import { structuredAgentResultSchema } from "./agent-result";
import { validateIssueAttachments } from "./issue-attachments";
import {
  normalizeAutoHuntWorkflow,
  type AutoHuntWorkflow,
} from "./auto-hunt-contract";
import {
  defaultProjectAgentCalendarColor,
  type ProjectAgentLocale,
} from "./project-agent";
import type { AgentProvider, ModelEffort } from "./project-llm";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type {
  LinearImportConnectResult,
  LinearImportResult,
  LinearImportStatesResult,
} from "./linear-import";
import type {
  CreateIssueInput,
  CreateProjectAgentInput,
  CreateProjectAgentScheduleInput,
  DashboardPayload,
  DashboardDeltaPayload,
  ExecutionWorker,
  OrganizationExecutionWorker,
  ProjectExecutionWorkerPolicy,
  HuntRunPlacement,
  HuntEvent,
  IssueAttachment,
  IssueMessage,
  IssueExecutionPreferences,
  IssueResultReview,
  ClaimedProjectAgentScheduleRun,
  Project,
  ProjectAgent,
  ProjectAgentSchedule,
  ProjectAgentScheduleRun,
  Organization,
  OrganizationMember,
  ProjectSettings,
  RunEvidence,
  RunEvidenceImage,
  SessionUser,
  UpdateProjectAgentInput,
  UpdateProjectAgentScheduleInput,
  UpdateIssueInput,
  WorkerIcon,
} from "../types";

const configuredApiUrl = import.meta.env.VITE_BRIAR_API_URL?.trim();
const webAppOrigin =
  import.meta.env.VITE_BRIAR_WEB === "true" &&
  typeof window !== "undefined" &&
  /^https?:$/u.test(window.location.protocol)
    ? window.location.origin
    : "";
const apiUrl = (configuredApiUrl || webAppOrigin).replace(/\/$/u, "");

export const briarApiUrl = apiUrl;

const sessionUserSchema = z.object({
  id: z.string(),
  username: z.string().nullable().optional(),
  name: z.string(),
  email: z.string().email(),
  image: z.string().nullable().optional(),
});

const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  icon: z
    .string()
    .max(400_000)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,/u)
    .nullable()
    .default(null),
  organizationId: z.string().uuid(),
  organizationName: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  createdAt: z.string(),
});
const projectAgentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  avatar: z
    .string()
    .max(400_000)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,/u)
    .nullable()
    .default(null),
  codexPet: z
    .object({
      slug: z.string(),
      name: z.string(),
      author: z.string(),
      license: z.string(),
      spriteVersion: z.union([z.literal(1), z.literal(2)]),
      spriteSheetUrl: z.string().nullable(),
    })
    .nullable()
    .default(null),
  provider: z.enum(["codex", "claude", "grok", "opencode"]),
  model: z.string().nullable(),
  responsibility: z.string(),
  skill: z.string(),
  calendarColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/iu)
    .default(defaultProjectAgentCalendarColor),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const projectAgentSessionSchema = z.object({
  id: z.string(),
  projectId: z.string().uuid(),
  dispatchGroupId: z.string(),
  agentId: z.string().uuid().nullable(),
  sessionType: z.enum(["task", "dispatch"]),
  trigger: z.enum(["manual", "scheduled"]).nullable(),
  scheduleId: z.string().nullable(),
  scheduleRunId: z.string().nullable(),
  parentSessionId: z.string().nullable(),
  request: z.string().nullable(),
  status: z.enum(["running", "completed", "failed", "skipped", "interrupted"]),
  issues: z.array(z.object({
    runId: z.string(),
    runNumber: z.number().int(),
    sourceKey: z.string(),
    title: z.string(),
    outcome: z.enum([
      "pending",
      "completed",
      "blocked",
      "failed",
      "skipped",
    ]),
    summary: z.string().nullable(),
  })),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  conversationId: z.string().nullable(),
  workspaceRoot: z.null(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  events: z.array(z.object({
    id: z.string(),
    type: z.enum([
      "started",
      "completed",
      "failed",
      "skipped",
      "interrupted",
      "stopped",
    ]),
    occurredAt: z.string(),
  })),
  dispatchEvents: z.array(z.never()),
  workers: z.array(z.never()),
  updatedAt: z.string(),
});
const projectAgentScheduleSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  agentId: z.string().uuid(),
  agentName: z.string(),
  agentProvider: z.enum(["codex", "claude", "grok", "opencode"]),
  name: z.string(),
  recurrence: z.enum([
    "interval",
    "daily",
    "weekdays",
    "weekly",
    "custom",
  ]),
  timeOfDay: z.string(),
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  intervalValue: z.number().int().min(1).max(999).optional(),
  intervalUnit: z.enum(["minute", "hour", "day", "week"]).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  notificationLevel: z.enum(["important_updates", "none"]).optional(),
  timeZone: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const autoHuntWorkflowSchema: z.ZodType<AutoHuntWorkflow> = z
  .object({
    version: z.literal(1),
    stages: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        required: z.boolean(),
        evidence: z.array(z.string()).optional(),
        checks: z.array(z.string()).optional(),
      }),
    ),
    execution: z.object({ stopAfterStage: z.string() }).optional(),
    completion: z.object({ requiredStages: z.array(z.string()) }).optional(),
    release: z.object({ enabled: z.boolean() }).optional(),
  })
  .transform(normalizeAutoHuntWorkflow);
const projectAgentScheduleRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  scheduleName: z.string(),
  agent: projectAgentSchema.pick({
    id: true,
    name: true,
    provider: true,
    model: true,
    responsibility: true,
    skill: true,
  }),
  workflow: autoHuntWorkflowSchema,
  status: z.enum(["running", "completed", "failed"]),
  scheduledFor: z.string(),
  leaseExpiresAt: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  resultSummary: z.string().nullable(),
  structuredResult: structuredAgentResultSchema.nullable(),
  error: z.string().nullable(),
});
const claimedProjectAgentScheduleRunSchema =
  projectAgentScheduleRunSchema.extend({
    status: z.literal("running"),
    claimToken: z.string().regex(/^briar_schedule_claim_[0-9a-f]{64}$/u),
  });
const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  handle: z.string(),
  logo: z
    .string()
    .max(400_000)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,/u)
    .nullable()
    .default(null),
  role: z.enum(["owner", "admin", "member"]),
  createdAt: z.string(),
});

export const isApiConfigured = Boolean(apiUrl);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiErrorStatus(error: unknown, status: number) {
  return error instanceof ApiError && error.status === status;
}

async function request<T>(
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  if (!apiUrl) throw new Error("Briar API URL이 설정되지 않았습니다.");
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.message ??
        body?.error_description ??
        body?.error ??
        `Briar API 요청 실패 (${response.status})`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
};

export type DeviceClientId =
  | "briar-mobile"
  | "briar-android"
  | "briar-desktop"
  | "briar-web";

export async function beginDeviceAuthorization(
  clientId: DeviceClientId = "briar-desktop",
): Promise<DeviceAuthorization> {
  const response = await request<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    interval?: number;
  }>("/api/auth/device/code", null, {
    method: "POST",
    body: JSON.stringify({
      client_id: clientId,
      scope: "openid profile email",
    }),
  });
  const verificationUrl =
    response.verification_uri_complete ?? response.verification_uri;
  const clientVerificationUrl = new URL(verificationUrl);
  if (clientId === "briar-mobile" || clientId === "briar-android") {
    clientVerificationUrl.searchParams.set("client", "mobile");
  } else if (clientId === "briar-web") {
    clientVerificationUrl.searchParams.set("client", "web");
  }
  return {
    deviceCode: response.device_code,
    userCode: response.user_code,
    verificationUrl: clientVerificationUrl.toString(),
    interval: response.interval ?? 5,
  };
}

type DeviceTokenResponse = {
  access_token?: string;
  error?:
    "authorization_pending" | "slow_down" | "access_denied" | "expired_token";
  error_description?: string;
};

export async function pollDeviceToken(
  deviceCode: string,
  clientId: DeviceClientId = "briar-desktop",
): Promise<DeviceTokenResponse> {
  try {
    return await request<DeviceTokenResponse>("/api/auth/device/token", null, {
      method: "POST",
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: clientId,
      }),
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const message = error.message.toLowerCase();
    if (message.includes("pending")) return { error: "authorization_pending" };
    if (message.includes("slow")) return { error: "slow_down" };
    throw error;
  }
}

export async function loadSession(token: string): Promise<SessionUser> {
  const result = await request<{ user: unknown }>("/me", token);
  return sessionUserSchema.parse(result.user);
}

export async function updateAccountProfile(
  token: string,
  input: { username: string; name: string; image: string | null },
): Promise<SessionUser> {
  const result = await request<{ user: unknown }>("/me", token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return sessionUserSchema.parse(result.user);
}

export async function deleteAccount(
  token: string,
  confirmation: string,
): Promise<void> {
  await request<void>("/me", token, {
    method: "DELETE",
    body: JSON.stringify({ confirmation }),
  });
}

export async function loadProjects(token: string): Promise<Project[]> {
  const result = await request<{ projects: unknown[] }>("/projects", token);
  return z.array(projectSchema).parse(result.projects);
}

export async function loadOrganizations(
  token: string,
): Promise<Organization[]> {
  const result = await request<{ organizations: unknown[] }>(
    "/organizations",
    token,
  );
  return z.array(organizationSchema).parse(result.organizations);
}

export async function createOrganization(
  token: string,
  input: { name: string; handle: string },
) {
  const result = await request<{ organization: unknown }>(
    "/organizations",
    token,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return { organization: organizationSchema.parse(result.organization) };
}

export async function isOrganizationHandleAvailable(
  token: string,
  handle: string,
) {
  const result = await request<{ available: boolean }>(
    `/organizations/handle-availability?handle=${encodeURIComponent(handle)}`,
    token,
  );
  return result.available;
}

export async function updateOrganization(
  token: string,
  organizationId: string,
  name: string,
) {
  return request<{ organization: Organization }>(
    `/organizations/${organizationId}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ name }),
    },
  );
}

export async function updateOrganizationLogo(
  token: string,
  organizationId: string,
  logo: string | null,
) {
  const result = await request<{ organization: unknown }>(
    `/organizations/${organizationId}/logo`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ logo }),
    },
  );
  return { organization: organizationSchema.parse(result.organization) };
}

export async function loadOrganizationMembers(
  token: string,
  organizationId: string,
) {
  const result = await request<{ members: OrganizationMember[] }>(
    `/organizations/${organizationId}/members`,
    token,
  );
  return result.members;
}

export async function loadOrganizationExecutionWorkers(
  token: string,
  organizationId: string,
) {
  return request<{
    workers: OrganizationExecutionWorker[];
    canManage: boolean;
    generatedAt: string;
  }>(`/organizations/${organizationId}/workers`, token);
}

export async function disableOrganizationExecutionWorker(
  token: string,
  organizationId: string,
  deviceId: string,
) {
  return request<void>(
    `/organizations/${organizationId}/workers/${encodeURIComponent(deviceId)}`,
    token,
    { method: "DELETE" },
  );
}

export async function updateOrganizationExecutionWorkerConcurrency(
  token: string,
  organizationId: string,
  deviceId: string,
  maxConcurrentSessions: number,
) {
  return request<{ deviceId: string; maxConcurrentSessions: number }>(
    `/organizations/${organizationId}/workers/${encodeURIComponent(deviceId)}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ maxConcurrentSessions }),
    },
  );
}

export async function updateOrganizationExecutionWorkerIcon(
  token: string,
  organizationId: string,
  deviceId: string,
  icon: WorkerIcon | null,
) {
  return request<{ deviceId: string; icon: WorkerIcon | null }>(
    `/organizations/${organizationId}/workers/${encodeURIComponent(deviceId)}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ icon }),
    },
  );
}

export async function addOrganizationMember(
  token: string,
  organizationId: string,
  input: { email: string; role: "admin" | "member" },
) {
  return request<{ members: OrganizationMember[] }>(
    `/organizations/${organizationId}/members`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function updateOrganizationMemberRole(
  token: string,
  organizationId: string,
  userId: string,
  role: "admin" | "member",
) {
  return request<{ members: OrganizationMember[] }>(
    `/organizations/${organizationId}/members/${encodeURIComponent(userId)}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ role }),
    },
  );
}

export async function removeOrganizationMember(
  token: string,
  organizationId: string,
  userId: string,
) {
  return request<void>(
    `/organizations/${organizationId}/members/${encodeURIComponent(userId)}`,
    token,
    { method: "DELETE" },
  );
}

export type SlackInstallation = {
  teamId: string;
  teamName: string;
  botUserId: string;
  defaultProjectId: string | null;
  defaultProjectName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SlackIntegration = {
  configured: boolean;
  canManage: boolean;
  projects: Array<{ id: string; name: string }>;
  installations: SlackInstallation[];
};

export async function loadSlackIntegration(
  token: string,
  organizationId: string,
) {
  return request<SlackIntegration>(
    `/organizations/${organizationId}/slack`,
    token,
  );
}

export async function createSlackInstallUrl(
  token: string,
  organizationId: string,
  defaultProjectId: string,
) {
  return request<{ installUrl: string }>(
    `/organizations/${organizationId}/slack`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ defaultProjectId }),
    },
  );
}

export async function updateSlackInstallation(
  token: string,
  organizationId: string,
  teamId: string,
  defaultProjectId: string,
) {
  return request<{ installation: SlackInstallation }>(
    `/organizations/${organizationId}/slack/installations/${encodeURIComponent(teamId)}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ defaultProjectId }),
    },
  );
}

export async function disconnectSlackInstallation(
  token: string,
  organizationId: string,
  teamId: string,
) {
  return request<void>(
    `/organizations/${organizationId}/slack/installations/${encodeURIComponent(teamId)}`,
    token,
    { method: "DELETE" },
  );
}

const normalizeDashboardRuns = (runs: DashboardPayload["runs"]) =>
  runs.map((run) => ({
    ...run,
    resultReviews: run.resultReviews ?? [],
    currentRevision:
      Number.isInteger(run.currentRevision) && run.currentRevision >= 1
        ? run.currentRevision
        : 1,
  }));

export async function loadDashboard(
  token: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<DashboardPayload> {
  const dashboard = await request<DashboardPayload>(
    `/projects/${projectId}/dashboard`,
    token,
    { signal },
  );
  return {
    ...dashboard,
    runs: normalizeDashboardRuns(dashboard.runs),
  };
}

export async function loadDashboardDelta(
  token: string,
  projectId: string,
  cursor: number,
  signal?: AbortSignal,
): Promise<DashboardDeltaPayload> {
  const delta = await request<DashboardDeltaPayload>(
    `/projects/${projectId}/dashboard/delta?cursor=${cursor}`,
    token,
    { signal },
  );
  return { ...delta, runs: normalizeDashboardRuns(delta.runs) };
}

export async function loadRunEvents(
  token: string,
  projectId: string,
  runId: string,
): Promise<HuntEvent[]> {
  const result = await request<{ events: HuntEvent[] }>(
    `/projects/${projectId}/runs/${runId}/events`,
    token,
  );
  return result.events.map((event) => ({
    ...event,
    revision:
      Number.isInteger(event.revision) && event.revision >= 1
        ? event.revision
        : 1,
  }));
}

export type ProjectAgentTranscript = {
  session: {
    sessionId: string;
    runId: string | null;
    workerId: string | null;
    agentProvider: AgentProvider;
    startedAt: string;
    lastEventAt: string;
    eventCount: number;
  };
  events: Array<{
    sequence: number;
    direction: "client" | "server";
    message: unknown;
    recordedAt: string;
  }>;
};

export async function loadProjectAgentTranscript(
  token: string,
  projectId: string,
  sessionId: string,
  afterSequence = 0,
): Promise<ProjectAgentTranscript> {
  return request<ProjectAgentTranscript>(
    `/projects/${projectId}/sessions/${encodeURIComponent(sessionId)}/transcript?afterSequence=${afterSequence}`,
    token,
  );
}

export async function createProject(
  token: string,
  input: { name: string; organizationId?: string },
) {
  return request<{ project: Project; agentToken: string }>("/projects", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteProject(token: string, projectId: string) {
  return request<void>(`/projects/${projectId}`, token, { method: "DELETE" });
}

export async function updateProjectIcon(
  token: string,
  projectId: string,
  icon: string | null,
) {
  const result = await request<{ project: unknown }>(
    `/projects/${projectId}/icon`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ icon }),
    },
  );
  return { project: projectSchema.parse(result.project) };
}

export async function loadProjectAgents(
  token: string,
  projectId: string,
  locale: ProjectAgentLocale,
): Promise<ProjectAgent[]> {
  const result = await request<{ agents: unknown[] }>(
    `/projects/${projectId}/agents?locale=${encodeURIComponent(locale)}`,
    token,
  );
  return z.array(projectAgentSchema).parse(result.agents);
}

export async function loadProjectAgentSessions(
  token: string,
  projectId: string,
): Promise<AutoHuntSession[]> {
  const result = await request<{ sessions: unknown[] }>(
    `/projects/${projectId}/agent-sessions`,
    token,
  );
  return z.array(projectAgentSessionSchema).parse(result.sessions).map(
    (session) => ({
      ...session,
      localOwner: false,
    } as AutoHuntSession),
  );
}

export async function upsertProjectAgentSession(
  token: string,
  session: AutoHuntSession,
): Promise<AutoHuntSession> {
  const result = await request<{ session: unknown }>(
    `/projects/${session.projectId}/agent-sessions/${encodeURIComponent(session.id)}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({
        dispatchGroupId: session.dispatchGroupId,
        agentId: session.agentId ?? null,
        sessionType: session.sessionType ?? "dispatch",
        trigger: session.trigger ?? null,
        scheduleId: session.scheduleId ?? null,
        scheduleRunId: session.scheduleRunId ?? null,
        parentSessionId: session.parentSessionId ?? null,
        request: session.request ?? null,
        status: session.status,
        issues: session.issues,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        conversationId: session.conversationId,
        summary: session.summary,
        error: session.error,
        events: session.events,
        updatedAt:
          session.updatedAt ?? session.completedAt ?? session.startedAt,
      }),
    },
  );
  return {
    ...projectAgentSessionSchema.parse(result.session),
    localOwner: session.localOwner,
    workspaceRoot: session.workspaceRoot,
    dispatchEvents: session.dispatchEvents,
    workers: session.workers,
  } as AutoHuntSession;
}

export async function createProjectAgent(
  token: string,
  projectId: string,
  input: CreateProjectAgentInput,
): Promise<ProjectAgent> {
  const result = await request<{ agent: unknown }>(
    `/projects/${projectId}/agents`,
    token,
    {
      method: "POST",
      body: JSON.stringify(projectAgentInputJson(input)),
    },
  );
  return projectAgentSchema.parse(result.agent);
}

export async function loadProjectAgentSchedules(
  token: string,
  projectId: string,
): Promise<ProjectAgentSchedule[]> {
  const result = await request<{ schedules: unknown[] }>(
    `/projects/${projectId}/agent-schedules`,
    token,
  );
  return z.array(projectAgentScheduleSchema).parse(result.schedules);
}

export async function createProjectAgentSchedule(
  token: string,
  projectId: string,
  input: CreateProjectAgentScheduleInput,
): Promise<ProjectAgentSchedule> {
  const result = await request<{ schedule: unknown }>(
    `/projects/${projectId}/agent-schedules`,
    token,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return projectAgentScheduleSchema.parse(result.schedule);
}

export async function updateProjectAgentSchedule(
  token: string,
  projectId: string,
  scheduleId: string,
  input: UpdateProjectAgentScheduleInput,
): Promise<ProjectAgentSchedule> {
  const result = await request<{ schedule: unknown }>(
    `/projects/${projectId}/agent-schedules/${scheduleId}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return projectAgentScheduleSchema.parse(result.schedule);
}

export async function deleteProjectAgentSchedule(
  token: string,
  projectId: string,
  scheduleId: string,
) {
  return request<void>(
    `/projects/${projectId}/agent-schedules/${scheduleId}`,
    token,
    { method: "DELETE" },
  );
}

export async function loadProjectAgentScheduleRuns(
  token: string,
  projectId: string,
): Promise<ProjectAgentScheduleRun[]> {
  const result = await request<{ runs: unknown[] }>(
    `/projects/${projectId}/agent-schedule-runs`,
    token,
  );
  return z.array(projectAgentScheduleRunSchema).parse(result.runs);
}

export async function claimProjectAgentScheduleRun(
  token: string,
  projectId: string,
): Promise<ClaimedProjectAgentScheduleRun | null> {
  const result = await request<{ run: unknown }>(
    `/projects/${projectId}/agent-schedule-runs/claim`,
    token,
    { method: "POST" },
  );
  return result.run === null
    ? null
    : claimedProjectAgentScheduleRunSchema.parse(result.run);
}

export async function completeProjectAgentScheduleRun(
  token: string,
  projectId: string,
  runId: string,
  input:
    | {
        claimToken: string;
        status: "completed";
        resultSummary: string;
        structuredResult: z.infer<typeof structuredAgentResultSchema>;
      }
    | {
        claimToken: string;
        status: "failed";
        error: string;
        structuredResult: z.infer<typeof structuredAgentResultSchema>;
      },
): Promise<ProjectAgentScheduleRun> {
  const result = await request<{ run: unknown }>(
    `/projects/${projectId}/agent-schedule-runs/${runId}/complete`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        claimToken: input.claimToken,
        status: input.status,
        resultSummary:
          input.status === "completed" ? input.resultSummary : null,
        structuredResult: input.structuredResult,
        error: input.status === "failed" ? input.error : null,
      }),
    },
  );
  return projectAgentScheduleRunSchema.parse(result.run);
}

export async function renewProjectAgentScheduleRun(
  token: string,
  projectId: string,
  runId: string,
  claimToken: string,
) {
  const result = await request<{ leaseExpiresAt: unknown }>(
    `/projects/${projectId}/agent-schedule-runs/${runId}/renew`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ claimToken }),
    },
  );
  return z.string().parse(result.leaseExpiresAt);
}

export async function updateProjectAgent(
  token: string,
  projectId: string,
  agentId: string,
  input: UpdateProjectAgentInput,
): Promise<ProjectAgent> {
  const result = await request<{ agent: unknown }>(
    `/projects/${projectId}/agents/${agentId}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify(projectAgentInputJson(input)),
    },
  );
  return projectAgentSchema.parse(result.agent);
}

export async function deleteProjectAgent(
  token: string,
  projectId: string,
  agentId: string,
) {
  return request<void>(`/projects/${projectId}/agents/${agentId}`, token, {
    method: "DELETE",
  });
}

export async function loadProjectAgentSpriteSheet(
  token: string,
  projectId: string,
  agentId: string,
): Promise<Blob> {
  if (!apiUrl) throw new Error("Briar API URL이 설정되지 않았습니다.");
  const response = await fetch(
    `${apiUrl}/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/spritesheet`,
    {
      headers: {
        Accept: "image/webp",
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) {
    throw new ApiError(response.status, "Agent sprite sheet request failed");
  }
  const spriteSheet = await response.blob();
  if (spriteSheet.type !== "image/webp") {
    throw new Error("Invalid agent sprite sheet");
  }
  return spriteSheet;
}

function projectAgentInputJson(input: CreateProjectAgentInput) {
  return {
    ...input,
    codexPet:
      input.codexPet === undefined
        ? undefined
        : input.codexPet === null
          ? null
          : { slug: input.codexPet.slug },
  };
}

export async function createIssue(
  token: string,
  projectId: string,
  input: CreateIssueInput,
) {
  if (input.attachments.length === 0) {
    const {
      attachments: _attachments,
      attachmentReferences: _attachmentReferences,
      ...issue
    } = input;
    return request<{
      runId: string;
      sourceKey: string;
      stage: "queued";
      status: "backlog" | "queued";
      attachments: IssueAttachment[];
    }>(`/projects/${projectId}/issues`, token, {
      method: "POST",
      body: JSON.stringify(issue),
    });
  }
  const attachmentError = validateIssueAttachments(input.attachments);
  if (attachmentError) throw new Error(attachmentError);
  const form = new FormData();
  form.set("title", input.title);
  form.set("description", input.description ?? "");
  form.set("priority", input.priority === null ? "" : String(input.priority));
  form.set("status", input.status);
  if (input.attachmentReferences?.length) {
    form.set(
      "attachmentReferences",
      JSON.stringify(input.attachmentReferences),
    );
  }
  for (const attachment of input.attachments) {
    form.append("attachments", attachment, attachment.name);
  }
  return request<{
    runId: string;
    sourceKey: string;
    stage: "queued";
    status: "backlog" | "queued";
    attachments: IssueAttachment[];
  }>(`/projects/${projectId}/issues`, token, { method: "POST", body: form });
}

export async function updateIssue(
  token: string,
  projectId: string,
  runId: string,
  input: UpdateIssueInput,
) {
  return request<{
    runId: string;
    title: string;
    description: string | null;
    priority: number | null;
  }>(`/projects/${projectId}/runs/${runId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function updateIssueExecutionPreferences(
  token: string,
  projectId: string,
  runId: string,
  input: IssueExecutionPreferences,
) {
  return request<{ runId: string } & IssueExecutionPreferences>(
    `/projects/${projectId}/runs/${runId}/preferences`,
    token,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
}

export async function completeIssueResultReview(
  token: string,
  projectId: string,
  runId: string,
) {
  return request<IssueResultReview>(
    `/projects/${projectId}/runs/${runId}/result-reviews`,
    token,
    { method: "POST" },
  );
}

export async function addIssueDependency(
  token: string,
  projectId: string,
  dependentRunId: string,
  prerequisiteRunId: string,
) {
  return request<{
    prerequisiteRunId: string;
    dependentRunId: string;
    outcome: "created" | "already_exists";
  }>(
    `/projects/${projectId}/runs/${dependentRunId}/dependencies/${prerequisiteRunId}`,
    token,
    { method: "PUT" },
  );
}

export async function removeIssueDependency(
  token: string,
  projectId: string,
  dependentRunId: string,
  prerequisiteRunId: string,
) {
  await request<void>(
    `/projects/${projectId}/runs/${dependentRunId}/dependencies/${prerequisiteRunId}`,
    token,
    { method: "DELETE" },
  );
}

export async function deleteIssue(
  token: string,
  projectId: string,
  runId: string,
) {
  await request<void>(`/projects/${projectId}/runs/${runId}`, token, {
    method: "DELETE",
  });
}

export async function loadIssueAttachment(
  token: string,
  attachment: IssueAttachment,
) {
  if (attachment.url.startsWith("blob:")) {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error("첨부 파일을 열 수 없습니다.");
    return response.blob();
  }
  if (!apiUrl || !attachment.url.startsWith("/")) {
    throw new Error("첨부 파일 경로가 유효하지 않습니다.");
  }
  const response = await fetch(`${apiUrl}${attachment.url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`첨부 파일을 열 수 없습니다. (${response.status})`);
  }
  return response.blob();
}

export async function loadIssueMessages(
  token: string,
  projectId: string,
  runId: string,
) {
  const result = await request<{ messages: IssueMessage[] }>(
    `/projects/${projectId}/runs/${runId}/messages`,
    token,
  );
  return result.messages;
}

export async function loadRunEvidence(
  token: string,
  projectId: string,
  runId: string,
) {
  const result = await request<{
    runId: string;
    attempt: number;
    revision: number;
    evidence: RunEvidence[];
  }>(`/projects/${projectId}/runs/${runId}/evidence`, token);
  return result.evidence;
}

export async function loadRunEvidenceImage(
  token: string,
  image: RunEvidenceImage,
) {
  if (!apiUrl || !image.url.startsWith("/")) {
    throw new Error("증빙 이미지 경로가 유효하지 않습니다.");
  }
  const response = await fetch(`${apiUrl}${image.url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`증빙 이미지를 열 수 없습니다. (${response.status})`);
  }
  return response.blob();
}

export async function createIssueMessage(
  token: string,
  projectId: string,
  runId: string,
  input: {
    body: string;
    parentMessageId: string | null;
    mentionedUserIds?: string[];
    agentConversationId?: string | null;
  },
) {
  const result = await request<{
    message: IssueMessage;
    agentReply: {
      id: string;
      triggerMessageId: string;
      status: "queued" | "running" | "completed" | "failed";
      error: string | null;
    } | null;
  }>(
    `/projects/${projectId}/runs/${runId}/messages`,
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
  return result;
}

export async function waitForIssueAgentReply(
  token: string,
  projectId: string,
  runId: string,
  triggerMessageId: string,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await request<{
      agentReply: {
        status: "queued" | "running" | "completed" | "failed";
        error: string | null;
      };
      message: IssueMessage | null;
    }>(
      `/projects/${projectId}/runs/${runId}/messages/${triggerMessageId}/agent-reply`,
      token,
    );
    if (result.agentReply.status === "completed" && result.message) {
      return result.message;
    }
    if (result.agentReply.status === "failed") {
      throw new Error(
        result.agentReply.error ?? "워커가 Briar 답변을 만들지 못했습니다.",
      );
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(
    "Briar 답변이 아직 대기 중입니다. 사용 가능한 워커가 있는지 확인해 주세요.",
  );
}

export type HuntRecoveryResult = {
  runId: string;
  outcome: "retried" | "cancelled" | "already_retried" | "already_cancelled";
  attempt: number;
  stage: "queued" | "cancelled";
};

async function recoverHuntRun(
  token: string,
  projectId: string,
  runId: string,
  action: "retry" | "cancel",
  reason: string | null,
) {
  return request<HuntRecoveryResult>(
    `/projects/${projectId}/runs/${runId}/${action}`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ requestId: crypto.randomUUID(), reason }),
    },
  );
}

export const retryHuntRun = (
  token: string,
  projectId: string,
  runId: string,
  reason: string | null = null,
) => recoverHuntRun(token, projectId, runId, "retry", reason);

export const cancelHuntRun = (
  token: string,
  projectId: string,
  runId: string,
  reason: string | null = null,
) => recoverHuntRun(token, projectId, runId, "cancel", reason);

export type HuntDispatchResult = {
  runId: string;
  agentId: string | null;
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  requestedWorkerId: string | null;
  requestedByUserId: string;
  dispatchMode: "any" | "specific";
  dispatchedAt: string;
  outcome: "dispatched" | "already_dispatched";
};

export async function dispatchHuntRun(
  token: string,
  projectId: string,
  runId: string,
  input: {
    agentId?: string | null;
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    workerId: string | null;
    reassign?: boolean;
    persistPreferences?: boolean;
  },
) {
  return request<HuntDispatchResult>(
    `/projects/${projectId}/runs/${runId}/${input.reassign ? "reassign" : "dispatch"}`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        ...(input.agentId ? { agentId: input.agentId } : {}),
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        persistPreferences: input.persistPreferences,
        workerId: input.workerId,
        requestId: crypto.randomUUID(),
      }),
    },
  );
}

export async function updateExecutionWorkerConcurrency(
  token: string,
  projectId: string,
  workerId: string,
  maxConcurrentSessions: number,
) {
  return request<ExecutionWorker>(
    `/projects/${projectId}/workers/${workerId}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ maxConcurrentSessions }),
    },
  );
}

export async function loadProjectExecutionWorkerPolicy(
  token: string,
  projectId: string,
) {
  return request<{ policy: ProjectExecutionWorkerPolicy }>(
    `/projects/${projectId}/execution-policy`,
    token,
  );
}

export async function updateProjectExecutionWorkerPolicy(
  token: string,
  projectId: string,
  policy: Pick<
    ProjectExecutionWorkerPolicy,
    "selectionMode" | "defaultWorkerId" | "allowedWorkerIds"
  >,
) {
  return request<{ policy: ProjectExecutionWorkerPolicy }>(
    `/projects/${projectId}/execution-policy`,
    token,
    { method: "PUT", body: JSON.stringify(policy) },
  );
}

export type HuntMoveResult = {
  runId: string;
  outcome: "moved" | "unchanged" | "already_moved";
  status: HuntRunPlacement["status"];
  workflowStage: string | null;
};

export async function moveHuntRun(
  token: string,
  projectId: string,
  runId: string,
  placement: HuntRunPlacement,
) {
  return request<HuntMoveResult>(
    `/projects/${projectId}/runs/${runId}/status`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        ...placement,
      }),
    },
  );
}

export async function createAgentToken(token: string, projectId: string) {
  return request<{ agentToken: string }>(
    `/projects/${projectId}/agent-token`,
    token,
    {
      method: "POST",
    },
  );
}

export async function updateProjectSettings(
  token: string,
  projectId: string,
  settings: ProjectSettings,
) {
  return request<{ settings: ProjectSettings }>(
    `/projects/${projectId}/settings`,
    token,
    { method: "PUT", body: JSON.stringify(settings) },
  );
}

export async function connectLinearImport(
  token: string,
  projectId: string,
  apiKey: string,
) {
  return request<LinearImportConnectResult>(
    `/projects/${projectId}/linear/connect`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    },
  );
}

export async function loadLinearImportStates(
  token: string,
  projectId: string,
  input: { apiKey: string; teamIds: string[] },
) {
  return request<LinearImportStatesResult>(
    `/projects/${projectId}/linear/states`,
    token,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function importLinearIssues(
  token: string,
  projectId: string,
  input: {
    apiKey: string;
    teamIds: string[];
    statusMapping: Record<string, string>;
  },
) {
  return request<LinearImportResult>(
    `/projects/${projectId}/linear/import`,
    token,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}
