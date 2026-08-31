import { describe, expect, it } from "vitest";
import {
  decodeOrganizationAgentContextRequestTurn,
} from "./organization-agent-context-contract";

describe("organization Agent context contract", () => {
  it("validates the model-selected lookup union and applies safe defaults", () => {
    expect(decodeOrganizationAgentContextRequestTurn({
      contextRequests: [{
        resource: "issues",
        projectId: "project-1",
        detail: "summary",
      }],
    })).toEqual({
      contextRequests: [{
        resource: "issues",
        projectId: "project-1",
        detail: "summary",
        limit: 25,
        cursor: null,
      }],
    });
    expect(() => decodeOrganizationAgentContextRequestTurn({
      contextRequests: [{
        resource: "issues",
        projectId: "project-1",
        detail: "summary",
        ids: ["detail-only"],
      }],
    })).toThrow();
    expect(() => decodeOrganizationAgentContextRequestTurn({
      contextRequests: Array.from({ length: 13 }, () => ({
        resource: "project-settings",
        projectId: "project-1",
      })),
    })).toThrow();
  });
});
