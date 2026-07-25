import { describe, expect, it } from "vitest";
import {
  buildDefaultStatusMapping,
  canImportLinearIssues,
  defaultPlacementForLinearType,
  isCompleteStatusMapping,
  isRepositoryConnectedForImport,
  linearSourceKey,
  mapLinearPriority,
  parsePlacementKey,
  placementKey,
  type LinearWorkflowStateSummary,
} from "./linear-import";

const sampleStates: LinearWorkflowStateSummary[] = [
  {
    id: "s-backlog",
    name: "Backlog",
    type: "backlog",
    color: "#ccc",
    position: 0,
    teamId: "t1",
    teamKey: "BRI",
    teamName: "Briar",
  },
  {
    id: "s-progress",
    name: "In Progress",
    type: "started",
    color: "#66f",
    position: 1,
    teamId: "t1",
    teamKey: "BRI",
    teamName: "Briar",
  },
  {
    id: "s-done",
    name: "Done",
    type: "completed",
    color: "#0a0",
    position: 2,
    teamId: "t1",
    teamKey: "BRI",
    teamName: "Briar",
  },
  {
    id: "s-cancel",
    name: "Canceled",
    type: "canceled",
    color: "#666",
    position: 3,
    teamId: "t1",
    teamKey: "BRI",
    teamName: "Briar",
  },
];

describe("linear-import", () => {
  it("round-trips placement keys", () => {
    expect(parsePlacementKey("status:backlog")).toEqual({
      status: "backlog",
      workflowStage: null,
    });
    expect(placementKey({ status: "queued", workflowStage: null })).toBe(
      "status:queued",
    );
    expect(
      placementKey({ status: "running", workflowStage: "analyzing" }),
    ).toBe("stage:analyzing");
    expect(parsePlacementKey("status:completed")).toEqual({
      status: "completed",
      workflowStage: null,
    });
    expect(parsePlacementKey("stage:local_qa")).toEqual({
      status: "running",
      workflowStage: "local_qa",
    });
    expect(parsePlacementKey("nope")).toBeNull();
  });

  it("defaults Linear state types to Briar placements", () => {
    expect(defaultPlacementForLinearType("backlog", "analyzing")).toEqual({
      status: "backlog",
      workflowStage: null,
    });
    expect(defaultPlacementForLinearType("triage", "analyzing")).toEqual({
      status: "backlog",
      workflowStage: null,
    });
    expect(defaultPlacementForLinearType("unstarted", "analyzing")).toEqual({
      status: "queued",
      workflowStage: null,
    });
    expect(defaultPlacementForLinearType("started", "analyzing")).toEqual({
      status: "running",
      workflowStage: "analyzing",
    });
    expect(defaultPlacementForLinearType("started", null)).toEqual({
      status: "queued",
      workflowStage: null,
    });
    expect(defaultPlacementForLinearType("completed", "analyzing")).toEqual({
      status: "completed",
      workflowStage: null,
    });
    expect(defaultPlacementForLinearType("canceled", "analyzing")).toEqual({
      status: "cancelled",
      workflowStage: null,
    });
  });

  it("builds a complete default status mapping", () => {
    const mapping = buildDefaultStatusMapping(sampleStates, "analyzing");
    expect(isCompleteStatusMapping(sampleStates, mapping)).toBe(true);
    expect(mapping["s-progress"]).toEqual({
      status: "running",
      workflowStage: "analyzing",
    });
    expect(mapping["s-backlog"]).toEqual({
      status: "backlog",
      workflowStage: null,
    });
  });

  it("maps Linear priorities into Briar's 1-4 range", () => {
    expect(mapLinearPriority(0)).toBeNull();
    expect(mapLinearPriority(1)).toBe(1);
    expect(mapLinearPriority(4)).toBe(4);
    expect(mapLinearPriority(9)).toBeNull();
    expect(linearSourceKey("abc")).toBe("linear:abc");
  });

  it("blocks import until a repository is connected", () => {
    expect(
      canImportLinearIssues({
        repositoryConnected: false,
        workflowStageCount: 3,
      }),
    ).toBe(false);
    expect(
      canImportLinearIssues({
        repositoryConnected: true,
        workflowStageCount: 0,
      }),
    ).toBe(false);
    expect(
      canImportLinearIssues({
        repositoryConnected: true,
        workflowStageCount: 3,
      }),
    ).toBe(true);

    expect(
      isRepositoryConnectedForImport({
        projectId: "p1",
        connectedProjectIds: null,
        githubRepository: null,
        repositoryPath: null,
      }),
    ).toBe(false);
    expect(
      isRepositoryConnectedForImport({
        projectId: "p1",
        connectedProjectIds: [],
        githubRepository: null,
        repositoryPath: null,
      }),
    ).toBe(false);
    expect(
      isRepositoryConnectedForImport({
        projectId: "p1",
        connectedProjectIds: ["p1"],
        githubRepository: null,
        repositoryPath: null,
      }),
    ).toBe(true);
    expect(
      isRepositoryConnectedForImport({
        projectId: "p1",
        connectedProjectIds: null,
        githubRepository: "org/repo",
        repositoryPath: null,
      }),
    ).toBe(true);
  });
});
