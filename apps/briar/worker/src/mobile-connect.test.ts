import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import { HttpError } from "./http-response";
import {
  handleMobileConnectRequest,
  type MobileConnectServices,
} from "./mobile-connect";
import type { ProjectRow } from "./project-repository";

const listProjectsUrl =
  "https://api.example.test/briar.mobile.v1.ProjectService/ListProjects";

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

describe("mobile Connect adapter", () => {
  it("serves an authenticated ListProjects RPC and maps auth failures", async () => {
    const auth = {} as BriarAuth;
    const db = {} as D1Database;
    const env = {
      DB: db,
      ARCHIVES: {} as R2Bucket,
      ATTACHMENTS: {} as R2Bucket,
    } as Env;
    const requireSession = vi.fn<MobileConnectServices["requireSession"]>(
      async () => ({
        user: { id: "user-1" },
      }) as Awaited<ReturnType<MobileConnectServices["requireSession"]>>,
    );
    const listProjects = vi.fn<MobileConnectServices["listProjects"]>(
      async () => [projectRow],
    );
    const services = { requireSession, listProjects };
    const request = connectRequest();

    const response = await handleMobileConnectRequest(
      { request, auth, env },
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
    const unauthorized = await handleMobileConnectRequest(
      { request: connectRequest(), auth, env },
      services,
    );

    expect(unauthorized?.status).toBe(401);
    expect(await unauthorized?.json()).toEqual({
      code: "unauthenticated",
      message: "Unauthorized",
    });
  });
});
