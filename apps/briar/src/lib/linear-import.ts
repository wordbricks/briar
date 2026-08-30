import {
  type AutoHuntPersistedRunStatus,
  type AutoHuntWorkflowStageId,
} from "./auto-hunt-contract";

export type LinearTeamSummary = {
  id: string;
  name: string;
  key: string;
};

export type LinearWorkflowStateSummary = {
  id: string;
  name: string;
  type: string;
  color: string;
  position: number;
  teamId: string;
  teamKey: string;
  teamName: string;
};

export type LinearImportPlacement = {
  status: AutoHuntPersistedRunStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
};

export interface LinearStatusMapping {
  [stateId: string]: LinearImportPlacement;
}

export type LinearImportConnectResult = {
  viewer: {
    name: string;
    email: string | null;
    organizationName: string;
  };
  teams: LinearTeamSummary[];
};

export type LinearImportStatesResult = {
  states: LinearWorkflowStateSummary[];
};

export type LinearImportResult = {
  imported: number;
  skipped: number;
  failed: number;
  total: number;
  truncated: boolean;
};

export function placementKey(placement: LinearImportPlacement): string {
  if (placement.status === "running" && placement.workflowStage) {
    return `stage:${placement.workflowStage}`;
  }
  return `status:${placement.status}`;
}

/** Map Linear workflow state types to Briar run placements. */
export function defaultPlacementForLinearType(
  type: string,
  firstWorkflowStageId: string | null,
): LinearImportPlacement {
  switch (type) {
    case "started":
      return firstWorkflowStageId
        ? { status: "running", workflowStage: firstWorkflowStageId }
        : { status: "queued", workflowStage: null };
    case "completed":
      return { status: "completed", workflowStage: null };
    case "canceled":
      return { status: "cancelled", workflowStage: null };
    case "triage":
    case "backlog":
      return { status: "backlog", workflowStage: null };
    case "unstarted":
    default:
      return { status: "queued", workflowStage: null };
  }
}

export function buildDefaultStatusMapping(
  states: LinearWorkflowStateSummary[],
  firstWorkflowStageId: string | null,
): LinearStatusMapping {
  const mapping: LinearStatusMapping = {};
  for (const state of states) {
    mapping[state.id] = defaultPlacementForLinearType(
      state.type,
      firstWorkflowStageId,
    );
  }
  return mapping;
}

export function linearSourceKey(issueId: string): string {
  return `linear:${issueId}`;
}

export function mapLinearPriority(priority: number | null | undefined): number | null {
  if (priority == null || priority <= 0) return null;
  if (priority >= 1 && priority <= 4) return priority;
  return null;
}

export function isCompleteStatusMapping(
  states: LinearWorkflowStateSummary[],
  mapping: LinearStatusMapping,
): boolean {
  return states.every((state) => {
    const placement = mapping[state.id];
    if (!placement) return false;
    if (placement.status === "running" && !placement.workflowStage) return false;
    return true;
  });
}

/**
 * Linear status mapping targets project board statuses, which only exist after a
 * repository is connected and the project workflow is available.
 */
export function canImportLinearIssues(input: {
  repositoryConnected: boolean;
  workflowStageCount: number;
}): boolean {
  return input.repositoryConnected && input.workflowStageCount > 0;
}

/**
 * Detect whether this project has a connected repository for status mapping.
 *
 * - Desktop: local connection list is authoritative.
 * - Cloud/web (unknown local list): require a project-level repository identity.
 */
export function isRepositoryConnectedForImport(input: {
  projectId: string;
  connectedProjectIds: string[] | null;
  githubRepository: string | null | undefined;
  repositoryPath: string | null | undefined;
}): boolean {
  if (input.githubRepository?.trim()) return true;
  if (input.repositoryPath?.trim()) return true;
  if (input.connectedProjectIds === null) return false;
  return input.connectedProjectIds.includes(input.projectId);
}
