import { describe, expect, it } from "vitest";
import { resolveIssueCreationProjectId } from "./run-commands";

describe("CLI hierarchy issue creation", () => {
  const generalId = "22222222-2222-4222-8222-222222222222";
  const releaseId = "33333333-3333-4333-8333-333333333333";

  it("uses and validates an explicitly selected Project", async () => {
    await expect(resolveIssueCreationProjectId({
      configuredProjectId: releaseId,
      loadProjects: async () => [
        { id: generalId, isDefault: true },
        { id: releaseId, isDefault: false },
      ],
    })).resolves.toBe(releaseId);
    await expect(resolveIssueCreationProjectId({
      configuredProjectId: "44444444-4444-4444-8444-444444444444",
      loadProjects: async () => [{ id: generalId, isDefault: true }],
    })).rejects.toThrow("현재 Team에 속하지 않습니다");
  });

  it("uses General when no Project was specified", async () => {
    await expect(resolveIssueCreationProjectId({
      loadProjects: async () => [
        { id: generalId, isDefault: true },
        { id: releaseId, isDefault: false },
      ],
    })).resolves.toBe(generalId);
  });

  it("requires an explicit Project when the Team has no default", async () => {
    await expect(resolveIssueCreationProjectId({
      loadProjects: async () => [
        { id: generalId, isDefault: false },
        { id: releaseId, isDefault: false },
      ],
    })).rejects.toThrow("기본 Project");
  });
});
