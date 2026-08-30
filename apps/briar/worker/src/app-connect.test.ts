import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import { HttpError } from "./http-response";
import {
  appConnectReadMaxBytes,
  handleAppConnectRequest,
  type AppConnectServices,
} from "./app-connect";
import { appConnectProjectServices } from "./app-connect-project";
import type { ProjectRow } from "./project-repository";

const listProjectsUrl =
  "https://api.example.test/briar.app.v1.ProjectService/ListProjects";

const projectRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Briar",
  issue_key_prefix: "BR",
  schedule_tab_enabled: 1,
  icon: null,
  organization_id: "22222222-2222-4222-8222-222222222222",
  organization_name: "Wordbricks",
  member_role: "owner",
  created_at: "2026-08-20T00:00:00.000Z",
} satisfies ProjectRow;

const connectRequest = () => new Request(listProjectsUrl, {
  method: "POST",
  headers: {
    authorization: "Bearer session-token",
    "connect-protocol-version": "1",
    "content-type": "application/json",
  },
  body: "{}",
});

describe("app Connect adapter", () => {
  it("serves an authenticated ListProjects RPC and maps auth failures", async () => {
    const auth = {} as BriarAuth;
    const db = {} as D1Database;
    const env = {
      DB: db,
      ARCHIVES: {} as R2Bucket,
      ATTACHMENTS: {} as R2Bucket,
    } as Env;
    const requireSession = vi.fn<AppConnectServices["requireSession"]>(
      async () => ({
        user: { id: "user-1" },
      }) as Awaited<ReturnType<AppConnectServices["requireSession"]>>,
    );
    const listProjects = vi.fn<AppConnectServices["listProjects"]>(
      async () => [projectRow],
    );
    const services = {
      ...appConnectProjectServices,
      requireSession,
      listProjects,
    } satisfies AppConnectServices;
    const request = connectRequest();
    const requireRunExecutionProject = vi.fn(async () => projectRow.id);

    const response = await handleAppConnectRequest(
      {
        request,
        auth,
        env,
        requireRunExecutionProject,
      },
      services,
    );

    expect(requireSession).toHaveBeenCalledWith(auth, request);
    expect(listProjects).toHaveBeenCalledWith(db, "user-1");
    expect(response?.status).toBe(200);
    expect(response?.headers.get("access-control-allow-origin")).toBe("*");
    expect(response?.headers.get("access-control-allow-headers"))
      .toContain("connect-protocol-version");
    expect(await response?.json()).toEqual({
      projects: [{
        id: projectRow.id,
        name: projectRow.name,
        issueKeyPrefix: projectRow.issue_key_prefix,
        scheduleTabEnabled: true,
        organizationId: projectRow.organization_id,
        organizationName: projectRow.organization_name,
        role: "PROJECT_ROLE_OWNER",
        createdAt: "2026-08-20T00:00:00Z",
      }],
    });

    requireSession.mockRejectedValueOnce(new HttpError(401, "Unauthorized"));
    const unauthorized = await handleAppConnectRequest(
      {
        request: connectRequest(),
        auth,
        env,
        requireRunExecutionProject,
      },
      services,
    );

    expect(unauthorized?.status).toBe(401);
    expect(await unauthorized?.json()).toEqual({
      code: "unauthenticated",
      message: "Unauthorized",
    });
  });

  it("rejects oversized Connect messages before application code", async () => {
    const db = {} as D1Database;
    const env = {
      DB: db,
      ARCHIVES: {} as R2Bucket,
      ATTACHMENTS: {} as R2Bucket,
    } as Env;
    const services = {
      ...appConnectProjectServices,
      requireSession: vi.fn<AppConnectServices["requireSession"]>(),
      listProjects: vi.fn<AppConnectServices["listProjects"]>(),
    } satisfies AppConnectServices;
    const request = new Request(listProjectsUrl, {
      method: "POST",
      headers: {
        "connect-protocol-version": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ padding: "x".repeat(appConnectReadMaxBytes) }),
    });

    const response = await handleAppConnectRequest({
      request,
      auth: {} as BriarAuth,
      env,
      requireRunExecutionProject: vi.fn(),
    }, services);

    expect(response?.status).toBe(429);
    expect(await response?.json()).toMatchObject({
      code: "resource_exhausted",
    });
    expect(services.requireSession).not.toHaveBeenCalled();
    expect(services.listProjects).not.toHaveBeenCalled();
  });
});
