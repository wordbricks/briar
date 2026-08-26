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

export type AutoHuntCheckpointPolicy = {
  projectMandatory: AutoHuntWorkflowCheckpoint[];
  userDefaults: AutoHuntWorkflowCheckpoint[];
  effective: AutoHuntWorkflowCheckpoint[];
};

const checkpointBoundaryId = (
  checkpoint: Pick<AutoHuntWorkflowCheckpoint, "stage" | "position">,
) => `${checkpoint.stage}:${checkpoint.position}`;

export const checkpointKeyForBoundary = (
  owner: "project" | "user" | "issue",
  checkpoint: Pick<AutoHuntWorkflowCheckpoint, "stage" | "position">,
) => `${owner}-${checkpoint.position}-${checkpoint.stage}`;

function orderedCheckpointSet(
  workflow: AutoHuntWorkflow,
  checkpoints: AutoHuntWorkflowCheckpoint[],
) {
  const normalized = normalizeAutoHuntWorkflow(workflow);
  const stageOrder = new Map(
    normalized.stages.map((stage, index) => [stage.id, index]),
  );
  const boundaries = new Set<string>();
  const keys = new Set<string>();
  const result = checkpoints.map((checkpoint) => {
    if (!stageOrder.has(checkpoint.stage)) {
      throw new AutoHuntWorkflowValidationError([
        `checkpoint '${checkpoint.key}' references unknown stage '${checkpoint.stage}'`,
      ]);
    }
    if (!autoHuntWorkflowCheckpointPositions.includes(checkpoint.position)) {
      throw new AutoHuntWorkflowValidationError([
        `checkpoint '${checkpoint.key}' has invalid position '${checkpoint.position}'`,
      ]);
    }
    const boundary = checkpointBoundaryId(checkpoint);
    if (boundaries.has(boundary)) {
      throw new AutoHuntWorkflowValidationError([
        `checkpoint boundary '${boundary}' is duplicated`,
      ]);
    }
    boundaries.add(boundary);
    const key = checkpoint.key.trim();
    if (!autoHuntWorkflowCheckpointKeyPattern.test(key) || keys.has(key)) {
      throw new AutoHuntWorkflowValidationError([
        `checkpoint key '${key}' is invalid or duplicated`,
      ]);
    }
    keys.add(key);
    return { key, stage: checkpoint.stage, position: checkpoint.position };
  });
  return result.sort((left, right) => {
    const stageComparison =
      (stageOrder.get(left.stage) ?? 0) - (stageOrder.get(right.stage) ?? 0);
    if (stageComparison !== 0) return stageComparison;
    return left.position === right.position
      ? left.key.localeCompare(right.key)
      : left.position === "before"
        ? -1
        : 1;
  });
}

export function canonicalizeCheckpointSet(
  workflow: AutoHuntWorkflow,
  checkpoints: AutoHuntWorkflowCheckpoint[],
  owner: "project" | "user" | "issue",
) {
  return orderedCheckpointSet(
    workflow,
    checkpoints.map((checkpoint) => ({
      ...checkpoint,
      key: checkpointKeyForBoundary(owner, checkpoint),
    })),
  );
}

export function resolveCheckpointPolicy(
  workflow: AutoHuntWorkflow,
  projectMandatory: AutoHuntWorkflowCheckpoint[],
  userDefaults: AutoHuntWorkflowCheckpoint[],
): AutoHuntCheckpointPolicy {
  const mandatory = canonicalizeCheckpointSet(
    workflow,
    projectMandatory,
    "project",
  );
  const defaults = canonicalizeCheckpointSet(workflow, userDefaults, "user");
  const mandatoryBoundaries = new Set(mandatory.map(checkpointBoundaryId));
  const effective = orderedCheckpointSet(
    workflow,
    [
      ...mandatory,
      ...defaults.filter(
        (checkpoint) => !mandatoryBoundaries.has(checkpointBoundaryId(checkpoint)),
      ),
    ],
  );
  return { projectMandatory: mandatory, userDefaults: defaults, effective };
}

export function workflowWithEffectiveCheckpoints(
  workflow: AutoHuntWorkflow,
  projectMandatory: AutoHuntWorkflowCheckpoint[],
  userDefaults: AutoHuntWorkflowCheckpoint[],
) {
  const normalized = normalizeAutoHuntWorkflow(workflow);
  const policy = resolveCheckpointPolicy(
    normalized,
    projectMandatory,
    userDefaults,
  );
  return normalizeAutoHuntWorkflow({
    ...normalized,
    version: 2,
    execution: { checkpoints: policy.effective },
  });
}

export function workflowWithAdditionalCheckpoints(
  workflow: AutoHuntWorkflow,
  checkpoints: AutoHuntWorkflowCheckpoint[],
) {
  const normalized = normalizeAutoHuntWorkflow(workflow);
  const additional = additionalWorkflowCheckpoints(normalized, checkpoints);
  return normalizeAutoHuntWorkflow({
    ...normalized,
    execution: {
      checkpoints: orderedCheckpointSet(
        normalized,
        [...normalized.execution.checkpoints, ...additional],
      ),
    },
  });
}

export function additionalWorkflowCheckpoints(
  workflow: AutoHuntWorkflow,
  checkpoints: AutoHuntWorkflowCheckpoint[],
) {
  const normalized = normalizeAutoHuntWorkflow(workflow);
  const additional = canonicalizeCheckpointSet(
    normalized,
    checkpoints,
    "issue",
  );
  const existingBoundaries = new Set(
    normalized.execution.checkpoints.map(checkpointBoundaryId),
  );
  return additional.filter(
    (checkpoint) => !existingBoundaries.has(checkpointBoundaryId(checkpoint)),
  );
}

export const autoHuntRequirementKinds = [
  "executable",
  "xcode",
  "ios_simulator",
  "android_sdk",
  "android_emulator",
] as const;

export type AutoHuntRequirementKind =
  (typeof autoHuntRequirementKinds)[number];

export const autoHuntSpecializedRequirementTools = {
  xcode: "xcodebuild",
  ios_simulator: "xcrun",
  android_sdk: "adb",
  android_emulator: "emulator",
} satisfies Record<Exclude<AutoHuntRequirementKind, "executable">, string>;

export type AutoHuntWorkflowRequirement = {
  id: string;
  label: string;
  kind: AutoHuntRequirementKind;
  /** Executable name for generic requirements. Specialized probes ignore it. */
  tool: string;
  reason: string;
};

export type AutoHuntWorkflowV2 = {
  version: 2;
  requirements: AutoHuntWorkflowRequirement[];
  stages: AutoHuntWorkflowStage[];
  execution: {
    checkpoints: AutoHuntWorkflowCheckpoint[];
  };
  completion: {
    requiredStages: AutoHuntWorkflowStageId[];
  };
};

export type AutoHuntWorkflow = AutoHuntWorkflowV2;

export type AutoHuntWorkflowInput = {
  version?: number;
  requirements?: AutoHuntWorkflowRequirement[];
  stages?: AutoHuntWorkflowStage[];
  completion?: { requiredStages?: AutoHuntWorkflowStageId[] };
  execution?: {
    checkpoints?: AutoHuntWorkflowCheckpoint[];
  };
};

const catalogById: Map<string, (typeof autoHuntWorkflowStageCatalog)[number]> = new Map(
  autoHuntWorkflowStageCatalog.map((stage) => [stage.id, stage]),
);

export class AutoHuntWorkflowValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid issue processing workflow: ${issues.join("; ")}`);
    this.name = "AutoHuntWorkflowValidationError";
    this.issues = issues;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const trimString = (value: unknown) =>
  typeof value === "string" ? value.trim() : null;

const cloneCanonicalWorkflow = (workflow: AutoHuntWorkflow): AutoHuntWorkflowV2 => {
  const normalized = normalizeAutoHuntWorkflow({
    version: workflow.version,
    requirements: workflow.requirements?.map((requirement) => ({
      ...requirement,
    })),
    stages: workflow.stages.map((stage) => ({
      ...stage,
      ...(stage.evidence ? { evidence: [...stage.evidence] } : {}),
      ...(stage.checks ? { checks: [...stage.checks] } : {}),
    })),
    execution: {
      checkpoints: workflow.execution.checkpoints.map((checkpoint) => ({
        ...checkpoint,
      })),
    },
    completion: {
      requiredStages: [...workflow.completion.requiredStages],
    },
  });
  return {
    version: 2,
    requirements: normalized.requirements.map((requirement) => ({
      ...requirement,
    })),
    stages: normalized.stages.map((stage) => ({
      ...stage,
      ...(stage.evidence ? { evidence: [...stage.evidence] } : {}),
      ...(stage.checks ? { checks: [...stage.checks] } : {}),
    })),
    execution: {
      checkpoints: normalized.execution.checkpoints.map((checkpoint) => ({
        ...checkpoint,
      })),
    },
    completion: {
      requiredStages: [...normalized.completion.requiredStages],
    },
  };
};

/**
 * Temporary contract used only before a repository has been connected and
 * analyzed. Connected projects replace it before onboarding completes.
 */
export const repositoryWorkflowPendingStageId = "repository_workflow_pending";
export const repositoryWorkflowBootstrap: AutoHuntWorkflow = {
  version: 2,
  requirements: [],
  stages: [
    {
      id: repositoryWorkflowPendingStageId,
      label: "Repository workflow pending",
      required: true,
    },
  ],
  execution: {
    checkpoints: [{
      key: "project-after-repository_workflow_pending",
      stage: repositoryWorkflowPendingStageId,
      position: "after",
    }],
  },
  completion: { requiredStages: [repositoryWorkflowPendingStageId] },
};

/** Clone through the canonical validation boundary. */
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
  if (version !== 2) {
    throw new AutoHuntWorkflowValidationError(["version must be 2"]);
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
  const checkpoints: AutoHuntWorkflowCheckpoint[] = [];
  if (!execution || execution.checkpoints === undefined) {
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
    execution: { checkpoints },
    completion: { requiredStages },
  };
}

/** Canonical persisted form for a project's own workflow policy. */
export function canonicalizeProjectWorkflow(
  workflow: AutoHuntWorkflowInput | null | undefined,
): AutoHuntWorkflowV2 {
  const normalized = normalizeAutoHuntWorkflow(workflow);
  const withCanonicalRequirements: AutoHuntWorkflowV2 = {
    ...normalized,
    requirements: normalized.requirements.map((requirement) => ({
      ...requirement,
      tool: requirement.kind === "executable"
        ? requirement.tool
        : autoHuntSpecializedRequirementTools[requirement.kind],
    })),
  };
  return {
    ...withCanonicalRequirements,
    execution: {
      checkpoints: canonicalizeCheckpointSet(
        withCanonicalRequirements,
        withCanonicalRequirements.execution.checkpoints,
        "project",
      ),
    },
  };
}

export function workflowCheckpointAt(
  workflow: AutoHuntWorkflow,
  stage: AutoHuntWorkflowStageId,
  position: AutoHuntWorkflowCheckpointPosition,
) {
  return workflow.execution.checkpoints.find(
    (checkpoint) =>
      checkpoint.stage === stage && checkpoint.position === position,
  ) ?? null;
}

export function requiredWorkflowStages(workflow: AutoHuntWorkflow) {
  return [...new Set(workflow.completion.requiredStages)];
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
export type AutoHuntQaStatus = (typeof autoHuntQaStatuses)[number];

export const terminalTrackerStates = new Set([
  "canceled",
  "cancelled",
  "completed",
  "done",
  "duplicate",
]);

export const isTerminalTrackerState = (state: string | null | undefined) =>
  state ? terminalTrackerStates.has(state.trim().toLowerCase()) : false;
