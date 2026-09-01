import { describe, expect, it } from "vitest";
import {
  decodeOrganizationAgentContextRequestTurn,
} from "./organization-agent-context-contract";

describe("organization Agent context contract", () => {
  it("requires the complete model-selected lookup union", () => {
    expect(decodeOrganizationAgentContextRequestTurn({
      contextRequests: [{
        resource: "issues",
        projectId: "project-1",
        detail: "summary",
        limit: 25,
        cursor: null,
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
      }],
    })).toThrow();
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
