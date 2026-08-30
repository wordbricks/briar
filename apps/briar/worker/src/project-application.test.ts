import { describe, expect, it, vi } from "vitest";
import {
  deleteProjectApplication,
  ProjectApplicationError,
  type ProjectApplicationServices,
} from "./project-application";
import type { ProjectRow } from "./project-repository";

const projectId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";

const project = {
  id: projectId,
  name: "Briar",
  issue_key_prefix: "AH",
  schedule_tab_enabled: 1,
  icon: null,
  organization_id: "33333333-3333-4333-8333-333333333333",
  organization_name: "Wordbricks",
  member_role: "owner",
  created_at: "2026-08-31T00:00:00.000Z",
} satisfies ProjectRow;

const setup = () => {
  const getProject = vi.fn<ProjectApplicationServices["getProject"]>(
    async () => project,
  );
  const deleteProject = vi.fn<ProjectApplicationServices["deleteProject"]>(
    async () => true,
  );
  const getProjectRunChildMismatch =
    vi.fn<ProjectApplicationServices["getProjectRunChildMismatch"]>(
      async () => null,
    );
  const services = {
    createOrganization:
      vi.fn<ProjectApplicationServices["createOrganization"]>(),
    createProject: vi.fn<ProjectApplicationServices["createProject"]>(),
    deleteProject,
    getProject,
    getProjectRunChildMismatch,
    issueProjectAgentToken:
      vi.fn<ProjectApplicationServices["issueProjectAgentToken"]>(),
    listOrganizations:
      vi.fn<ProjectApplicationServices["listOrganizations"]>(),
    updateProjectIcon:
      vi.fn<ProjectApplicationServices["updateProjectIcon"]>(),
    updateProjectIssueKeyPrefix:
      vi.fn<ProjectApplicationServices["updateProjectIssueKeyPrefix"]>(),
    updateProjectScheduleTabEnabled:
      vi.fn<ProjectApplicationServices["updateProjectScheduleTabEnabled"]>(),
  } satisfies ProjectApplicationServices;
  return {
    deleteProject,
    getProjectRunChildMismatch,
    services,
  };
};

describe("project application", () => {
  it("blocks inconsistent project deletion before returning a cleanup boundary", async () => {
    const {
      deleteProject,
      getProjectRunChildMismatch,
      services,
    } = setup();
    getProjectRunChildMismatch.mockResolvedValueOnce({
      stale_project_id: projectId,
      current_project_id: "44444444-4444-4444-8444-444444444444",
      run_id: "55555555-5555-4555-8555-555555555555",
      entity_kind: "issue",
      entity_id: "66666666-6666-4666-8666-666666666666",
    });

    const blocked = await deleteProjectApplication(
      { db: {} as D1Database, projectId, userId },
      services,
    ).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(ProjectApplicationError);
    expect((blocked as ProjectApplicationError).reason).toBe(
      "transfer_reconciliation_required",
    );
    expect(deleteProject).not.toHaveBeenCalled();

    const result = await deleteProjectApplication(
      { db: {} as D1Database, projectId, userId },
      services,
    );
    expect(result.projectId).toBe(projectId);
    expect(Number.isNaN(Date.parse(result.observedAt))).toBe(false);
    expect(deleteProject).toHaveBeenCalledWith(
      {},
      projectId,
      userId,
      result.observedAt,
    );
  });
});
