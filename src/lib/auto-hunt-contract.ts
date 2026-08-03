export const autoHuntSources = ["issue", "error", "feedback"] as const;

/**
 * Universal execution states. Project-specific progress belongs to a workflow
 * stage instead of being encoded in this state machine.
 */
export const autoHuntRunStatuses = [
  "backlog",
  "queued",
  "running",
  "paused",
  "blocked",
  "failed",
  "completed",
  "cancelled",
] as const;

export const autoHuntPersistedRunStatuses = [
  "backlog",
  "queued",
  "running",
  "blocked",
  "failed",
  "completed",
  "cancelled",
] as const;

export const autoHuntEvidenceTypeMaxLength = 120;
export const autoHuntEvidenceTypePattern = /^[^\u0000-\u001f\u007f]+$/u;
export const autoHuntWorkflowCheckpointKeyPattern =
  /^[a-z][a-z0-9_-]{0,63}$/u;
export const autoHuntWorkflowStageIdPattern = /^[a-z][a-z0-9_-]{0,63}$/u;
export const autoHuntWorkflowCheckpointPositions = ["before", "after"] as const;

export type AutoHuntWorkflowCheckpointPosition =
  (typeof autoHuntWorkflowCheckpointPositions)[number];

export const autoHuntWorkflowStageCatalog = [
  { id: "analyzing", label: "분석", tone: "blue", evidence: ["repository"], checks: undefined },
  { id: "planning", label: "계획", tone: "cyan", evidence: ["repository"], checks: undefined },
  { id: "implementing", label: "구현", tone: "violet", evidence: ["diff"], checks: undefined },
  { id: "reviewing", label: "리뷰", tone: "indigo", evidence: ["diff"], checks: undefined },
  { id: "pr_open", label: "PR 검증", tone: "indigo", evidence: ["pull_request"], checks: undefined },
  { id: "local_qa", label: "로컬 검증", tone: "amber", evidence: ["test"], checks: ["bun run test", "bun run build"] },
  { id: "ci_qa", label: "CI 검증", tone: "amber", evidence: ["ci"], checks: undefined },
  { id: "staging_qa", label: "Stage QA", tone: "orange", evidence: ["staging"], checks: undefined },
  { id: "production_qa", label: "Production QA", tone: "orange", evidence: ["production"], checks: undefined },
  { id: "monitoring", label: "모니터링", tone: "emerald", evidence: ["monitoring"], checks: undefined },
] as const;

export type AutoHuntSource = (typeof autoHuntSources)[number];
export type AutoHuntRunStatus = (typeof autoHuntRunStatuses)[number];
export type AutoHuntPersistedRunStatus =
  (typeof autoHuntPersistedRunStatuses)[number];
export type AutoHuntWorkflowStageId = string;

export type AutoHuntWorkflowStage = {
  id: AutoHuntWorkflowStageId;
  label: string;
  required: boolean;
  evidence?: string[];
  checks?: string[];
};

export type AutoHuntWorkflowCheckpoint = {
  key: string;
  stage: AutoHuntWorkflowStageId;
  position: AutoHuntWorkflowCheckpointPosition;
};

export const autoHuntRequirementKinds = [
  "executable",
  "xcode",
  "ios_simulator",
  "android_sdk",
  "android_emulator",
] as const;

export type AutoHuntRequirementKind =
  (typeof autoHuntRequirementKinds)[number];

export type AutoHuntWorkflowRequirement = {
  id: string;
  label: string;
  kind: AutoHuntRequirementKind;
  /** Executable name for generic requirements. Specialized probes ignore it. */
  tool: string;
  reason: string;
};

export type AutoHuntWorkflow = {
  /** Raw v1 snapshots remain representable for read compatibility. */
  version: 1 | 2;
  requirements?: AutoHuntWorkflowRequirement[];
  stages: AutoHuntWorkflowStage[];
  execution: {
    checkpoints?: AutoHuntWorkflowCheckpoint[];
    /** @deprecated Read-only compatibility projection for pre-v2 callers. */
    pauseAfterStage?: AutoHuntWorkflowStageId;
    /** @deprecated Read-only compatibility projection for pre-v2 callers. */
    stopAfterStage?: AutoHuntWorkflowStageId;
  };
  completion: {
    requiredStages: AutoHuntWorkflowStageId[];
  };
};

export type AutoHuntWorkflowV2 = {
  version: 2;
  requirements: AutoHuntWorkflowRequirement[];
  stages: AutoHuntWorkflowStage[];
  execution: {
    checkpoints: AutoHuntWorkflowCheckpoint[];
    /** @deprecated Read-only compatibility projection for pre-v2 callers. */
    pauseAfterStage?: AutoHuntWorkflowStageId;
    /** @deprecated Read-only compatibility projection for pre-v2 callers. */
    stopAfterStage?: AutoHuntWorkflowStageId;
  };
  completion: {
    requiredStages: AutoHuntWorkflowStageId[];
  };
};

export type AutoHuntWorkflowInput = {
  version?: number;
  requirements?: AutoHuntWorkflowRequirement[];
  stages?: AutoHuntWorkflowStage[];
  completion?: { requiredStages?: AutoHuntWorkflowStageId[] };
  execution?: {
    checkpoints?: AutoHuntWorkflowCheckpoint[];
    pauseAfterStage?: AutoHuntWorkflowStageId;
    stopAfterStage?: AutoHuntWorkflowStageId;
  };
  /** Read compatibility for workflows stored before an explicit pause stage. */
  release?: { enabled: boolean };
};

const catalogById: Map<string, (typeof autoHuntWorkflowStageCatalog)[number]> = new Map(
  autoHuntWorkflowStageCatalog.map((stage) => [stage.id, stage]),
);

export class AutoHuntWorkflowValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid Auto Hunt workflow: ${issues.join("; ")}`);
    this.name = "AutoHuntWorkflowValidationError";
    this.issues = issues;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const trimString = (value: unknown) =>
  typeof value === "string" ? value.trim() : null;

const legacyCheckpointKey = (stage: string) => {
  const key = `legacy-after-${stage}`;
  if (!autoHuntWorkflowCheckpointKeyPattern.test(key)) {
    throw new AutoHuntWorkflowValidationError([
      `legacy checkpoint key for stage '${stage}' exceeds 64 characters`,
    ]);
  }
  return key;
};

const createExecution = (
  checkpoints: AutoHuntWorkflowCheckpoint[],
  legacyPauseAfterStage?: AutoHuntWorkflowStageId,
): AutoHuntWorkflowV2["execution"] => {
  const execution = legacyPauseAfterStage
    ? ({} as AutoHuntWorkflowV2["execution"])
    : { checkpoints };
  if (legacyPauseAfterStage) {
    Object.defineProperty(execution, "checkpoints", {
      configurable: true,
      enumerable: false,
      value: checkpoints,
      writable: false,
    });
  }
  if (legacyPauseAfterStage) {
    // Keep the old desktop/UI projection available to code that has not moved
    // to checkpoint rendering yet. `toJSON` is the canonical write boundary:
    // v2 writers never persist either legacy field.
    Object.defineProperty(execution, "pauseAfterStage", {
      configurable: true,
      enumerable: true,
      value: legacyPauseAfterStage,
      writable: false,
    });
  }
  Object.defineProperty(execution, "toJSON", {
    configurable: true,
    enumerable: false,
    value: () => ({ checkpoints: execution.checkpoints }),
  });
  return execution;
};

const cloneCanonicalWorkflow = (workflow: AutoHuntWorkflow): AutoHuntWorkflowV2 => {
  const normalized = normalizeAutoHuntWorkflow(
    JSON.parse(JSON.stringify(workflow)) as AutoHuntWorkflowInput,
  );
  // Normalizing a v1 snapshot intentionally exposes a non-enumerable legacy
  // projection to old readers. Clone once more through JSON so this helper's
  // contract is always a plain, canonical v2 object.
  return JSON.parse(JSON.stringify(normalized)) as AutoHuntWorkflowV2;
};

/**
 * Temporary contract used only before a repository has been connected and
 * analyzed. Connected projects replace it before onboarding completes.
 */
export const repositoryWorkflowPendingStageId = "repository_workflow_pending";
export const repositoryWorkflowBootstrap: AutoHuntWorkflow = {
  version: 1,
  requirements: [],
  stages: [
    {
      id: repositoryWorkflowPendingStageId,
      label: "Repository workflow pending",
      required: true,
    },
  ],
  execution: { pauseAfterStage: repositoryWorkflowPendingStageId },
  completion: { requiredStages: [repositoryWorkflowPendingStageId] },
};

/** Clone through the canonical JSON boundary so compatibility projections and
 * non-enumerable read helpers cannot leak into a persisted v2 snapshot. */
export const cloneAutoHuntWorkflow = (
  workflow: AutoHuntWorkflow = repositoryWorkflowBootstrap,
): AutoHuntWorkflowV2 => cloneCanonicalWorkflow(workflow);

export const isRepositoryWorkflowPending = (workflow: AutoHuntWorkflow) =>
  workflow.stages.some((stage) => stage.id === repositoryWorkflowPendingStageId);

export function normalizeAutoHuntWorkflow(
  workflow: AutoHuntWorkflowInput | null | undefined,
): AutoHuntWorkflowV2 {
  if (workflow === null || workflow === undefined) {
    return cloneCanonicalWorkflow(repositoryWorkflowBootstrap);
  }
  if (!isRecord(workflow)) {
    throw new AutoHuntWorkflowValidationError(["workflow must be an object"]);
  }
  const version = workflow.version;
  if (version !== 1 && version !== 2) {
    throw new AutoHuntWorkflowValidationError([
      "version must be 1 (read compatibility) or 2",
    ]);
  }
  if (!Array.isArray(workflow.stages) || workflow.stages.length === 0) {
    throw new AutoHuntWorkflowValidationError(["stages must contain at least one stage"]);
  }
  if (workflow.stages.length > 30) {
    throw new AutoHuntWorkflowValidationError(["stages may contain at most 30 stages"]);
  }

  const issues: string[] = [];
  const seen = new Set<AutoHuntWorkflowStageId>();
  const seenRequirements = new Set<string>();
  if (workflow.requirements !== undefined && !Array.isArray(workflow.requirements)) {
    issues.push("requirements must be an array");
  }
  const requirements = (Array.isArray(workflow.requirements)
    ? workflow.requirements
    : []).flatMap((requirement, index) => {
    if (!isRecord(requirement)) {
      issues.push(`requirements[${index}] must be an object`);
      return [];
    }
    const id = trimString(requirement.id);
    const label = trimString(requirement.label);
    const tool = trimString(requirement.tool);
    const reason = trimString(requirement.reason);
    if (!id || !/^[a-z][a-z0-9_]{0,63}$/u.test(id)) {
      issues.push(`requirements[${index}].id is invalid`);
      return [];
    }
    if (!label || !tool || !reason) {
      issues.push(`requirements[${index}] has an empty field`);
      return [];
    }
    if (seenRequirements.has(id)) {
      issues.push(`duplicate requirement key '${id}'`);
      return [];
    }
    if (!autoHuntRequirementKinds.includes(
      requirement.kind as AutoHuntRequirementKind,
    )) {
      issues.push(`requirements[${index}].kind is invalid`);
      return [];
    }
    seenRequirements.add(id);
    return [{
      id,
      label,
      kind: requirement.kind as AutoHuntRequirementKind,
      tool,
      reason,
    }];
  });

  const stages = workflow.stages.flatMap((stage, index) => {
    if (!isRecord(stage)) {
      issues.push(`stages[${index}] must be an object`);
      return [];
    }
    const id = trimString(stage.id);
    if (!id || !autoHuntWorkflowStageIdPattern.test(id)) {
      issues.push(`stages[${index}].id is invalid`);
      return [];
    }
    const catalog = catalogById.get(id);
    if (seen.has(id)) {
      issues.push(`duplicate stage id '${id}'`);
      return [];
    }
    const label = trimString(stage.label);
    if (!label) {
      issues.push(`stages[${index}].label is empty`);
      return [];
    }
    if (typeof stage.required !== "boolean") {
      issues.push(`stages[${index}].required must be boolean`);
      return [];
    }
    seen.add(id);
    const cleanList = (value: unknown, field: string, max: number) => {
      if (value === undefined) return undefined;
      if (!Array.isArray(value) || value.length > max) {
        issues.push(`stages[${index}].${field} is invalid`);
        return undefined;
      }
      const values = value.map((item) => trimString(item));
      if (values.some((item) => !item)) {
        issues.push(`stages[${index}].${field} contains an empty value`);
        return undefined;
      }
      return values as string[];
    };
    const evidence = cleanList(stage.evidence, "evidence", 20) ??
      (catalog?.evidence ? [...catalog.evidence] : undefined);
    const checks = cleanList(stage.checks, "checks", 20) ??
      (catalog?.checks ? [...catalog.checks] : undefined);
    if (evidence?.some((value) =>
      value.length > autoHuntEvidenceTypeMaxLength ||
      !autoHuntEvidenceTypePattern.test(value),
    )) {
      issues.push(`stages[${index}].evidence contains an invalid value`);
    }
    if (checks?.some((value) => value.length > 500)) {
      issues.push(`stages[${index}].checks contains an invalid value`);
    }
    return [{
      id,
      label,
      required: stage.required as boolean,
      ...(evidence !== undefined ? { evidence } : {}),
      ...(checks !== undefined ? { checks } : {}),
    }];
  });
  if (issues.length > 0) throw new AutoHuntWorkflowValidationError(issues);
  const stageIds = new Set(stages.map((stage) => stage.id));

  if (workflow.completion !== undefined && !isRecord(workflow.completion)) {
    issues.push("completion must be an object");
  }
  const rawRequiredStages = isRecord(workflow.completion) &&
    workflow.completion.requiredStages !== undefined
    ? workflow.completion.requiredStages
    : undefined;
  const requiredStages = rawRequiredStages === undefined
    ? stages.filter((stage) => stage.required).map((stage) => stage.id)
    : (() => {
        if (!Array.isArray(rawRequiredStages) || rawRequiredStages.length > 30) {
          issues.push("completion.requiredStages is invalid");
          return [];
        }
        const requiredSet = new Set<string>();
        for (const [index, value] of rawRequiredStages.entries()) {
          const id = trimString(value);
          if (!id || !stageIds.has(id)) {
            issues.push(`completion.requiredStages[${index}] references an unknown stage`);
          } else if (requiredSet.has(id)) {
            issues.push(`duplicate completion stage '${id}'`);
          } else {
            requiredSet.add(id);
          }
        }
        return stages
          .filter((stage) => requiredSet.has(stage.id))
          .map((stage) => stage.id);
      })();
  const expectedRequiredStages = stages
    .filter((stage) => stage.required)
    .map((stage) => stage.id);
  if (
    rawRequiredStages !== undefined &&
    (requiredStages.length !== expectedRequiredStages.length ||
      requiredStages.some((id) => !expectedRequiredStages.includes(id)))
  ) {
    issues.push("completion.requiredStages must match stages marked required");
  }

  if (workflow.execution !== undefined && !isRecord(workflow.execution)) {
    issues.push("execution must be an object");
  }
  const execution = isRecord(workflow.execution) ? workflow.execution : null;
  let checkpoints: AutoHuntWorkflowCheckpoint[] = [];
  let legacyPauseAfterStage: AutoHuntWorkflowStageId | undefined;
  if (version === 1) {
    const pauseAfterStage = trimString(execution?.pauseAfterStage);
    const stopAfterStage = trimString(execution?.stopAfterStage);
    if (pauseAfterStage && stopAfterStage && pauseAfterStage !== stopAfterStage) {
      issues.push(
        "execution.pauseAfterStage and execution.stopAfterStage conflict",
      );
    }
    const configuredStage = pauseAfterStage || stopAfterStage ||
      requiredStages.at(-1) || stages.at(-1)!.id;
    if (!stageIds.has(configuredStage)) {
      issues.push(`legacy execution stage '${configuredStage}' is unknown`);
    } else {
      legacyPauseAfterStage = configuredStage;
      checkpoints = [{
        key: legacyCheckpointKey(configuredStage),
        stage: configuredStage,
        position: "after",
      }];
    }
  } else if (
    (execution?.pauseAfterStage !== undefined || execution?.stopAfterStage !== undefined) &&
    typeof (execution as Record<string, unknown> | null)?.toJSON !== "function"
  ) {
    issues.push("version 2 execution must use checkpoints");
  } else if (!execution || execution.checkpoints === undefined) {
    issues.push("version 2 execution.checkpoints is required");
  } else if (execution?.checkpoints !== undefined) {
    if (!Array.isArray(execution.checkpoints) || execution.checkpoints.length > 100) {
      issues.push("execution.checkpoints is invalid");
    } else {
      const checkpointKeys = new Set<string>();
      const checkpointBoundaries = new Set<string>();
      for (const [index, value] of execution.checkpoints.entries()) {
        if (!isRecord(value)) {
          issues.push(`execution.checkpoints[${index}] must be an object`);
          continue;
        }
        const key = trimString(value.key);
        const stage = trimString(value.stage);
        const position = trimString(value.position);
        if (!key || !autoHuntWorkflowCheckpointKeyPattern.test(key)) {
          issues.push(`execution.checkpoints[${index}].key is invalid`);
          continue;
        }
        if (!stage || !stageIds.has(stage)) {
          issues.push(`execution.checkpoints[${index}].stage references an unknown stage`);
          continue;
        }
        if (!autoHuntWorkflowCheckpointPositions.includes(
          position as AutoHuntWorkflowCheckpointPosition,
        )) {
          issues.push(`execution.checkpoints[${index}].position is invalid`);
          continue;
        }
        const boundary = `${stage}:${position}`;
        if (checkpointKeys.has(key)) {
          issues.push(`duplicate checkpoint key '${key}'`);
          continue;
        }
        if (checkpointBoundaries.has(boundary)) {
          issues.push(`duplicate checkpoint boundary '${boundary}'`);
          continue;
        }
        checkpointKeys.add(key);
        checkpointBoundaries.add(boundary);
        checkpoints.push({
          key,
          stage,
          position: position as AutoHuntWorkflowCheckpointPosition,
        });
      }
    }
  } else {
    // Snapshots created before execution was introduced paused after the last
    // required stage. Preserve that behavior without rewriting the snapshot.
    const fallbackStage = requiredStages.at(-1) ?? stages.at(-1)!.id;
    legacyPauseAfterStage = fallbackStage;
    checkpoints = [{
      key: legacyCheckpointKey(fallbackStage),
      stage: fallbackStage,
      position: "after",
    }];
  }
  if (issues.length > 0) throw new AutoHuntWorkflowValidationError(issues);

  const stageOrder = new Map(stages.map((stage, index) => [stage.id, index]));
  checkpoints.sort((left, right) =>
    (stageOrder.get(left.stage) ?? 0) - (stageOrder.get(right.stage) ?? 0) ||
    (left.position === "before" ? 0 : 1) - (right.position === "before" ? 0 : 1),
  );
  return {
    version: 2,
    requirements,
    stages,
    execution: createExecution(checkpoints, legacyPauseAfterStage),
    completion: { requiredStages },
  };
}

export function workflowPauseIndex(workflow: AutoHuntWorkflow) {
  const legacyPauseStage = workflow.execution.pauseAfterStage ??
    workflow.execution.stopAfterStage;
  const checkpoint = [...(workflow.execution.checkpoints ?? [])]
    .reverse()
    .find((candidate) =>
      candidate.position === "after" &&
      (!legacyPauseStage || candidate.stage === legacyPauseStage),
    );
  // The old event lifecycle only understands one after-stage pause. v2
  // checkpoint orchestration is deliberately opt-in through the progress API;
  // keep this compatibility helper inert for canonical v2 keys.
  if (!checkpoint || !legacyPauseStage || !checkpoint.key.startsWith("legacy-after-")) {
    return workflow.stages.length;
  }
  return workflow.stages.findIndex((stage) => stage.id === legacyPauseStage);
}

/** @deprecated Use workflowPauseIndex. */
export const workflowStopIndex = workflowPauseIndex;

export function workflowPauseStage(workflow: AutoHuntWorkflow) {
  const index = workflowPauseIndex(workflow);
  return workflow.stages[index]?.id ?? workflow.execution.pauseAfterStage ?? null;
}

export function orderedWorkflowCheckpoints(workflow: AutoHuntWorkflow) {
  return [...(workflow.execution.checkpoints ?? [])];
}

export function workflowCheckpointAt(
  workflow: AutoHuntWorkflow,
  stage: AutoHuntWorkflowStageId,
  position: AutoHuntWorkflowCheckpointPosition,
) {
  return workflow.execution.checkpoints?.find(
    (checkpoint) =>
      checkpoint.stage === stage && checkpoint.position === position,
  ) ?? null;
}

export function terminalWorkflowStage(workflow: AutoHuntWorkflow) {
  return workflow.stages.at(-1) ?? null;
}

export function executableWorkflowStages(workflow: AutoHuntWorkflow) {
  return [...workflow.stages];
}

export function requiredWorkflowStages(workflow: AutoHuntWorkflow) {
  return [...new Set(workflow.completion.requiredStages)];
}

/** @deprecated Use requiredWorkflowStages. */
export function requiredExecutableWorkflowStages(workflow: AutoHuntWorkflow) {
  return requiredWorkflowStages(workflow);
}

export function progressForAutoHuntRun(
  status: AutoHuntRunStatus,
  workflowStage: AutoHuntWorkflowStageId | null,
  workflow: AutoHuntWorkflow,
) {
  if (status === "completed") return 100;
  if (status === "cancelled") return 0;
  if (status === "backlog") return 0;
  if (status === "queued") return 5;
  const index = workflow.stages.findIndex((stage) => stage.id === workflowStage);
  if (index < 0) return status === "blocked" || status === "failed" ? 50 : 10;
  return Math.round(((index + 1) / (workflow.stages.length + 1)) * 100);
}

/** Compact stage projection used by the dashboard and persisted run rows. */
export const dashboardStages = [
  "queued",
  "analyzing",
  "implementing",
  "pr_open",
  "staging_qa",
  "production_qa",
  "completed",
  "blocked",
  "failed",
  "cancelled",
] as const;

export type DashboardStage = (typeof dashboardStages)[number];

export const autoHuntQaStatuses = ["pending", "passed", "skipped"] as const;
export const autoHuntQaEnvironments = ["staging", "production"] as const;
export type AutoHuntQaStatus = (typeof autoHuntQaStatuses)[number];
export type AutoHuntQaEnvironment = (typeof autoHuntQaEnvironments)[number];

export const dashboardStageProgress: Record<DashboardStage, number> = {
  queued: 5,
  analyzing: 25,
  implementing: 45,
  pr_open: 65,
  staging_qa: 80,
  production_qa: 92,
  completed: 100,
  blocked: 50,
  failed: 50,
  cancelled: 0,
};

export const terminalTrackerStates = new Set([
  "canceled",
  "cancelled",
  "completed",
  "done",
  "duplicate",
]);

export const isTerminalTrackerState = (state: string | null | undefined) =>
  state ? terminalTrackerStates.has(state.trim().toLowerCase()) : false;
