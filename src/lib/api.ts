import { z } from "zod";
import { validateIssueAttachments } from "./issue-attachments";
import type {
  CreateIssueInput,
  DashboardPayload,
  IssueAttachment,
  Project,
  ProjectSettings,
  SessionUser,
} from "../types";

const apiUrl = import.meta.env.VITE_BRIAR_API_URL?.replace(/\/$/u, "") ?? "";

export const briarApiUrl = apiUrl;

const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  image: z.string().nullable().optional(),
});

const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string(),
});

export const isApiConfigured = Boolean(apiUrl);

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
    throw new Error(
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

export async function beginDeviceAuthorization(): Promise<DeviceAuthorization> {
  const response = await request<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    interval?: number;
  }>("/api/auth/device/code", null, {
    method: "POST",
    body: JSON.stringify({
      client_id: "briar-desktop",
      scope: "openid profile email",
    }),
  });
  return {
    deviceCode: response.device_code,
    userCode: response.user_code,
    verificationUrl:
      response.verification_uri_complete ?? response.verification_uri,
    interval: response.interval ?? 5,
  };
}

type DeviceTokenResponse = {
  access_token?: string;
  error?: "authorization_pending" | "slow_down" | "access_denied" | "expired_token";
  error_description?: string;
};

export async function pollDeviceToken(
  deviceCode: string,
): Promise<DeviceTokenResponse> {
  try {
    return await request<DeviceTokenResponse>("/api/auth/device/token", null, {
      method: "POST",
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: "briar-desktop",
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

export async function loadProjects(token: string): Promise<Project[]> {
  const result = await request<{ projects: unknown[] }>("/projects", token);
  return z.array(projectSchema).parse(result.projects);
}

export async function loadDashboard(
  token: string,
  projectId: string,
): Promise<DashboardPayload> {
  return request<DashboardPayload>(`/projects/${projectId}/dashboard`, token);
}

export async function createProject(
  token: string,
  input: { name: string },
) {
  return request<{ project: Project; agentToken: string }>("/projects", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteProject(token: string, projectId: string) {
  return request<void>(`/projects/${projectId}`, token, { method: "DELETE" });
}

export async function createIssue(
  token: string,
  projectId: string,
  input: CreateIssueInput,
) {
  if (input.attachments.length === 0) {
    const { attachments: _attachments, ...issue } = input;
    return request<{
      runId: string;
      sourceKey: string;
      stage: "queued";
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
  for (const attachment of input.attachments) {
    form.append("attachments", attachment, attachment.name);
  }
  return request<{
    runId: string;
    sourceKey: string;
    stage: "queued";
    attachments: IssueAttachment[];
  }>(
    `/projects/${projectId}/issues`,
    token,
    { method: "POST", body: form },
  );
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

export type HuntRecoveryResult = {
  runId: string;
  outcome:
    | "retried"
    | "cancelled"
    | "already_retried"
    | "already_cancelled";
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

export async function createAgentToken(token: string, projectId: string) {
  return request<{ agentToken: string }>(`/projects/${projectId}/agent-token`, token, {
    method: "POST",
  });
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
