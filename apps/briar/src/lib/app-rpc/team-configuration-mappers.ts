import { create } from "@bufbuild/protobuf";
import {
  TeamExecutionWorkerPolicy_SelectionMode,
  type TeamExecutionWorkerPolicy as TeamExecutionWorkerPolicyMessage,
  type TeamSettings as TeamSettingsMessage,
} from "@briar/contracts/gen/briar/app/v1/team_pb";
import {
  AutoHuntWorkflowSchema,
  WorkflowCheckpoint_Position,
  WorkflowCheckpointSpecSchema,
  type AutoHuntWorkflow as AutoHuntWorkflowMessage,
  type CheckpointPolicy as CheckpointPolicyMessage,
  type WorkflowCheckpointSpec,
} from "@briar/contracts/gen/briar/types/v1/workflow_pb";
import {
  autoHuntRequirementKinds,
  normalizeAutoHuntWorkflow,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowCheckpoint,
  type AutoHuntWorkflowRequirement,
} from "../auto-hunt-contract";
import type {
  ProjectExecutionWorkerPolicy,
  ProjectSettings,
} from "../../types";
import {
  optionalTimestamp,
  requiredMessage,
  safeNumber,
} from "./mappers";

export const checkpointPositionFromProto = (
  value: WorkflowCheckpoint_Position,
): AutoHuntWorkflowCheckpoint["position"] => {
  switch (value) {
    case WorkflowCheckpoint_Position.BEFORE:
      return "before";
    case WorkflowCheckpoint_Position.AFTER:
      return "after";
    default:
      throw new Error(`Unknown checkpoint position: ${value}`);
  }
};

export const checkpointPositionToProto = (
  value: AutoHuntWorkflowCheckpoint["position"],
) => value === "before"
  ? WorkflowCheckpoint_Position.BEFORE
  : WorkflowCheckpoint_Position.AFTER;

export const workflowCheckpointFromProto = (
  value: WorkflowCheckpointSpec,
): AutoHuntWorkflowCheckpoint => ({
  key: value.key,
  stage: value.stage,
  position: checkpointPositionFromProto(value.position),
});

export const workflowCheckpointToProto = (
  value: AutoHuntWorkflowCheckpoint,
): WorkflowCheckpointSpec => create(WorkflowCheckpointSpecSchema, {
  key: value.key,
  stage: value.stage,
  position: checkpointPositionToProto(value.position),
});

const workflowRequirementFromProto = (
  value: AutoHuntWorkflowMessage["requirements"][number],
): AutoHuntWorkflowRequirement => {
  if (!autoHuntRequirementKinds.includes(
    value.kind as AutoHuntWorkflowRequirement["kind"],
  )) {
    throw new Error(`Unknown workflow requirement kind: ${value.kind}`);
  }
  return {
    id: value.id,
    label: value.label,
    kind: value.kind as AutoHuntWorkflowRequirement["kind"],
    tool: value.tool,
    reason: value.reason,
  };
};

export const workflowFromProto = (
  value: AutoHuntWorkflowMessage,
): AutoHuntWorkflow => {
  if (value.version !== 2) {
    throw new Error(`Unsupported workflow version: ${value.version}`);
  }
  const execution = requiredMessage(value.execution, "workflow.execution");
  const completion = requiredMessage(value.completion, "workflow.completion");
  return normalizeAutoHuntWorkflow({
    version: 2,
    requirements: value.requirements.map(workflowRequirementFromProto),
    stages: value.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      required: stage.required,
      evidence: stage.evidence.length === 0 ? undefined : stage.evidence,
      checks: stage.checks.length === 0 ? undefined : stage.checks,
    })),
    execution: {
      checkpoints: execution.checkpoints.map(workflowCheckpointFromProto),
    },
    completion: { requiredStages: completion.requiredStages },
  });
};

export const workflowToProto = (
  value: AutoHuntWorkflow,
): AutoHuntWorkflowMessage => create(AutoHuntWorkflowSchema, {
  version: value.version,
  requirements: value.requirements.map((requirement) => ({ ...requirement })),
  stages: value.stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    required: stage.required,
    evidence: [...(stage.evidence ?? [])],
    checks: [...(stage.checks ?? [])],
  })),
  execution: {
    checkpoints: value.execution.checkpoints.map(workflowCheckpointToProto),
  },
  completion: { requiredStages: [...value.completion.requiredStages] },
});

export const teamSettingsFromProto = (
  value: TeamSettingsMessage,
): ProjectSettings => {
  const linear = requiredMessage(value.linear, "projectSettings.linear");
  return {
    velenOrg: value.velenOrg ?? null,
    dataSource: value.dataSource ?? null,
    linear: {
      enabled: linear.enabled,
      source: linear.source ?? null,
      teamKey: linear.teamKey ?? null,
    },
    githubRepositoryId: value.githubRepositoryId === undefined
      ? null
      : safeNumber(value.githubRepositoryId, "settings.githubRepositoryId"),
    githubRepository: value.githubRepository ?? null,
    workflow: workflowFromProto(
      requiredMessage(value.workflow, "projectSettings.workflow"),
    ),
    checkpointPolicy: value.checkpointPolicy === undefined
      ? undefined
      : checkpointPolicyFromProto(value.checkpointPolicy),
  };
};

export const checkpointPolicyFromProto = (
  value: CheckpointPolicyMessage,
): NonNullable<ProjectSettings["checkpointPolicy"]> => ({
  availableBoundaries: value.availableBoundaries.map((boundary) => ({
    stage: boundary.stage,
    stageLabel: boundary.stageLabel,
    position: checkpointPositionFromProto(boundary.position),
  })),
  teamMandatory: value.projectMandatory.map(workflowCheckpointFromProto),
  userDefaults: value.userDefaults.map(workflowCheckpointFromProto),
  effective: value.effective.map(workflowCheckpointFromProto),
  teamRevision: safeNumber(
    value.projectRevision,
    "checkpointPolicy.projectRevision",
  ),
  userRevision: safeNumber(
    value.userRevision,
    "checkpointPolicy.userRevision",
  ),
});

export const executionPolicyFromProto = (
  value: TeamExecutionWorkerPolicyMessage | undefined,
): ProjectExecutionWorkerPolicy | undefined => {
  if (value === undefined) return undefined;
  const selectionMode = (() => {
    switch (value.selectionMode) {
      case TeamExecutionWorkerPolicy_SelectionMode.ANY:
        return "any" as const;
      case TeamExecutionWorkerPolicy_SelectionMode.ALLOWLIST:
        return "allowlist" as const;
      default:
        throw new Error(`Unknown worker selection mode: ${value.selectionMode}`);
    }
  })();
  return {
    selectionMode,
    defaultWorkerId: value.defaultWorkerId ?? null,
    allowedWorkerIds: value.allowedWorkerIds,
    updatedAt: optionalTimestamp(value.updatedAt),
  };
};

export const executionSelectionModeToProto = (
  value: ProjectExecutionWorkerPolicy["selectionMode"],
) => value === "any"
  ? TeamExecutionWorkerPolicy_SelectionMode.ANY
  : TeamExecutionWorkerPolicy_SelectionMode.ALLOWLIST;
