import { describe, expect, it, vi } from "vitest";
import { navigateToIssueLink } from "./issue-link-navigation";

const target = {
  projectId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
};
const otherProjectId = "33333333-3333-4333-8333-333333333333";

describe("issue link navigation", () => {
  it("opens an issue in the current project without reselecting it", async () => {
    const ensureProjectSelected = vi.fn(async () => undefined);
    const openIssue = vi.fn();

    await expect(navigateToIssueLink({
      target,
      activeProjectId: target.projectId,
      availableProjectIds: [target.projectId],
      lockedProjectId: null,
      ensureProjectSelected,
      openIssue,
    })).resolves.toEqual({ status: "opened", projectChanged: false });
    expect(ensureProjectSelected).not.toHaveBeenCalled();
    expect(openIssue).toHaveBeenCalledWith(target);
  });

  it("selects an accessible project before opening its issue", async () => {
    const ensureProjectSelected = vi.fn(async () => undefined);
    const openIssue = vi.fn();

    await expect(navigateToIssueLink({
      target,
      activeProjectId: otherProjectId,
      availableProjectIds: [otherProjectId, target.projectId],
      lockedProjectId: null,
      ensureProjectSelected,
      openIssue,
    })).resolves.toEqual({ status: "opened", projectChanged: true });
    expect(ensureProjectSelected).toHaveBeenCalledWith(target.projectId);
    expect(ensureProjectSelected.mock.invocationCallOrder[0]).toBeLessThan(
      openIssue.mock.invocationCallOrder[0],
    );
  });

  it("reports an inaccessible or missing project without opening the issue", async () => {
    const ensureProjectSelected = vi.fn(async () => {
      throw new Error("not found");
    });
    const openIssue = vi.fn();

    await expect(navigateToIssueLink({
      target,
      activeProjectId: otherProjectId,
      availableProjectIds: [otherProjectId],
      lockedProjectId: null,
      ensureProjectSelected,
      openIssue,
    })).resolves.toEqual({
      status: "rejected",
      reason: "project-unavailable",
    });
    expect(openIssue).not.toHaveBeenCalled();
  });

  it("keeps a project window locked to its own project", async () => {
    const ensureProjectSelected = vi.fn(async () => undefined);
    const openIssue = vi.fn();

    await expect(navigateToIssueLink({
      target,
      activeProjectId: otherProjectId,
      availableProjectIds: [otherProjectId, target.projectId],
      lockedProjectId: otherProjectId,
      ensureProjectSelected,
      openIssue,
    })).resolves.toEqual({
      status: "rejected",
      reason: "project-window-locked",
    });
    expect(ensureProjectSelected).not.toHaveBeenCalled();
    expect(openIssue).not.toHaveBeenCalled();
  });
});
