import { describe, expect, it, vi } from "vitest";
import {
  deleteTeamApplication,
  TeamApplicationError,
  type TeamApplicationServices,
} from "./team-application";
import type { TeamRow } from "./team-repository";

const projectId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";

const project = {
  id: projectId,
  name: "Briar",
  issue_key_prefix: "AH",
  schedule_tab_enabled: 1,
  icon: null,
  icon_name: null,
  icon_color: null,
  organization_id: "33333333-3333-4333-8333-333333333333",
  organization_name: "Wordbricks",
  member_role: "owner",
  created_at: "2026-08-31T00:00:00.000Z",
} satisfies TeamRow;

const setup = () => {
  const getTeam = vi.fn<TeamApplicationServices["getTeam"]>(
    async () => project,
  );
  const deleteTeam = vi.fn<TeamApplicationServices["deleteTeam"]>(
    async () => true,
  );
  const getTeamRunChildMismatch =
    vi.fn<TeamApplicationServices["getTeamRunChildMismatch"]>(
      async () => null,
    );
  const services = {
    createOrganization:
      vi.fn<TeamApplicationServices["createOrganization"]>(),
    createTeam: vi.fn<TeamApplicationServices["createTeam"]>(),
    deleteTeam,
    getTeam,
    getTeamRunChildMismatch,
    issueProjectAgentToken:
      vi.fn<TeamApplicationServices["issueProjectAgentToken"]>(),
    listOrganizations:
      vi.fn<TeamApplicationServices["listOrganizations"]>(),
    updateTeamIcon:
      vi.fn<TeamApplicationServices["updateTeamIcon"]>(),
    updateTeamIssueKeyPrefix:
      vi.fn<TeamApplicationServices["updateTeamIssueKeyPrefix"]>(),
    updateTeamScheduleTabEnabled:
      vi.fn<TeamApplicationServices["updateTeamScheduleTabEnabled"]>(),
  } satisfies TeamApplicationServices;
  return {
    deleteTeam,
    getTeamRunChildMismatch,
    services,
  };
};

describe("project application", () => {
  it("blocks inconsistent project deletion before returning a cleanup boundary", async () => {
    const {
      deleteTeam,
      getTeamRunChildMismatch,
      services,
    } = setup();
    getTeamRunChildMismatch.mockResolvedValueOnce({
      stale_project_id: projectId,
      current_project_id: "44444444-4444-4444-8444-444444444444",
      run_id: "55555555-5555-4555-8555-555555555555",
      entity_kind: "issue",
      entity_id: "66666666-6666-4666-8666-666666666666",
    });

    const blocked = await deleteTeamApplication(
      { db: {} as D1Database, projectId, userId },
      services,
    ).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(TeamApplicationError);
    expect((blocked as TeamApplicationError).reason).toBe(
      "transfer_reconciliation_required",
    );
    expect(deleteTeam).not.toHaveBeenCalled();

    const result = await deleteTeamApplication(
      { db: {} as D1Database, projectId, userId },
      services,
    );
    expect(result.projectId).toBe(projectId);
    expect(Number.isNaN(Date.parse(result.observedAt))).toBe(false);
    expect(deleteTeam).toHaveBeenCalledWith(
      {},
      projectId,
      userId,
      result.observedAt,
    );
  });
});
