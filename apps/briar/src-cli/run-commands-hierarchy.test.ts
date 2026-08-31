import { describe, expect, it } from "vitest";
import { HttpRequestError } from "./execution-metrics-upload";
import { resolveIssueCreationProjectId } from "./run-commands";

describe("CLI hierarchy issue creation", () => {
  const teamId = "11111111-1111-4111-8111-111111111111";
  const generalId = "22222222-2222-4222-8222-222222222222";
  const releaseId = "33333333-3333-4333-8333-333333333333";

  it("uses and validates an explicitly selected Project", async () => {
    await expect(resolveIssueCreationProjectId({
      configuredProjectId: releaseId,
      teamId,
      loadProjects: async () => [
        { id: generalId, isDefault: true },
        { id: releaseId, isDefault: false },
      ],
    })).resolves.toBe(releaseId);
    await expect(resolveIssueCreationProjectId({
      configuredProjectId: "44444444-4444-4444-8444-444444444444",
      teamId,
      loadProjects: async () => [{ id: generalId, isDefault: true }],
    })).rejects.toThrow("현재 Team에 속하지 않습니다");
  });

  it("uses General when no Project was specified", async () => {
    await expect(resolveIssueCreationProjectId({
      teamId,
      loadProjects: async () => [
        { id: generalId, isDefault: true },
        { id: releaseId, isDefault: false },
      ],
    })).resolves.toBe(generalId);
  });

  it("keeps the legacy Team endpoint only for an unconfigured old Worker", async () => {
    const unavailable = async () => {
      throw new HttpRequestError("Not found", 404, null);
    };
    await expect(resolveIssueCreationProjectId({
      teamId,
      loadProjects: unavailable,
    })).resolves.toBe(teamId);
    await expect(resolveIssueCreationProjectId({
      configuredProjectId: releaseId,
      teamId,
      loadProjects: unavailable,
    })).rejects.toBeInstanceOf(HttpRequestError);
  });
});
