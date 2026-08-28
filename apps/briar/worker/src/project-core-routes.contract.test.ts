import { listProjectsOperation } from "@briar/mobile-contracts";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import { authenticateMobileOperation } from "./mobile-contract-auth";
import {
  handleProjectCoreRoute,
  type ProjectListRouteServices,
} from "./project-core-routes";
import type { ProjectRow } from "./project-repository";

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

const db = {} as D1Database;
const auth = {} as BriarAuth;

const routeInput = () => ({
  request: new Request(`https://api.example.test${listProjectsOperation.path}`, {
    method: listProjectsOperation.method,
  }),
  url: new URL(`https://api.example.test${listProjectsOperation.path}`),
  auth,
  db,
  attachmentsBucket: {} as R2Bucket,
  env: {} as Env,
});

describe("project route mobile contract", () => {
  it("applies public authentication metadata without calling the authenticator", async () => {
    const authenticate = vi.fn<ProjectListRouteServices["requireSession"]>();

    await expect(authenticateMobileOperation(
      { security: "public" },
      auth,
      routeInput().request,
      authenticate,
    )).resolves.toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("routes listProjects through the canonical response validator", async () => {
    const listProjects = vi.fn<ProjectListRouteServices["listProjects"]>(
      async () => [projectRow],
    );
    const services: ProjectListRouteServices = {
      requireSession: vi.fn(async () => ({
        user: { id: "user-1" },
      }) as Awaited<ReturnType<ProjectListRouteServices["requireSession"]>>),
      listProjects,
    };

    const response = await handleProjectCoreRoute(routeInput(), services);

    expect(services.requireSession).toHaveBeenCalledOnce();
    expect(listProjects).toHaveBeenCalledWith(
      db,
      "user-1",
    );
    expect(response?.status).toBe(listProjectsOperation.response.status);
    expect(await response?.json()).toEqual({
      projects: [{
        id: projectRow.id,
        name: projectRow.name,
        issueKeyPrefix: projectRow.issue_key_prefix,
        scheduleTabEnabled: true,
        icon: projectRow.icon,
        organizationId: projectRow.organization_id,
        organizationName: projectRow.organization_name,
        role: projectRow.member_role,
        createdAt: projectRow.created_at,
      }],
    });

    listProjects.mockResolvedValueOnce([{
      ...projectRow,
      issue_key_prefix: undefined,
    } as unknown as ProjectRow]);
    await expect(handleProjectCoreRoute(routeInput(), services)).rejects
      .toThrow();
  });
});
