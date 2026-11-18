import { describe, expect, it } from "vitest";
import {
  decodeWorkspaceAgentContextRequestTurn,
} from "./workspace-agent-context-contract";

describe("workspace Agent context contract", () => {
  it("requires the complete model-selected lookup union", () => {
    expect(decodeWorkspaceAgentContextRequestTurn({
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
    expect(() => decodeWorkspaceAgentContextRequestTurn({
      contextRequests: [{
        resource: "issues",
        projectId: "project-1",
        detail: "summary",
      }],
    })).toThrow();
    expect(() => decodeWorkspaceAgentContextRequestTurn({
      contextRequests: [{
        resource: "issues",
        projectId: "project-1",
        detail: "summary",
        ids: ["detail-only"],
      }],
    })).toThrow();
    expect(() => decodeWorkspaceAgentContextRequestTurn({
      contextRequests: Array.from({ length: 13 }, () => ({
        resource: "project-settings",
        projectId: "project-1",
      })),
    })).toThrow();
  });
});
