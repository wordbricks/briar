export const autoHuntSources = ["issue", "error", "feedback"] as const;

/**
 * Universal execution states. Project-specific progress belongs to a workflow
 * stage instead of being encoded in this state machine.
 */
export const autoHuntRunStatuses = [
  "queued",
  "running",
  "blocked",
  "failed",
  "completed",
  "cancelled",
] as const;

export const autoHuntWorkflowStageCatalog = [
  { id: "analyzing", label: "분석", tone: "blue" },
  { id: "planning", label: "계획", tone: "cyan" },
  { id: "implementing", label: "구현", tone: "violet" },
  { id: "reviewing", label: "리뷰", tone: "indigo" },
  { id: "pr_open", label: "PR 검증", tone: "indigo" },
  { id: "local_qa", label: "로컬 검증", tone: "amber" },
  { id: "ci_qa", label: "CI 검증", tone: "amber" },
  { id: "staging_qa", label: "Stage QA", tone: "orange" },
  { id: "production_qa", label: "Production QA", tone: "orange" },
  { id: "monitoring", label: "모니터링", tone: "emerald" },
] as const;

export const autoHuntWorkflowPresets = [
  "local",
  "review",
  "release",
  "research",
  "custom",
] as const;

export type AutoHuntSource = (typeof autoHuntSources)[number];
export type AutoHuntRunStatus = (typeof autoHuntRunStatuses)[number];
export type AutoHuntWorkflowStageId =
  (typeof autoHuntWorkflowStageCatalog)[number]["id"];
export type AutoHuntWorkflowPreset =
  (typeof autoHuntWorkflowPresets)[number];

export type AutoHuntWorkflowStage = {
  id: AutoHuntWorkflowStageId;
  label: string;
  required: boolean;
};

export type AutoHuntWorkflow = {
  version: 1;
  preset: AutoHuntWorkflowPreset;
  stages: AutoHuntWorkflowStage[];
};

const stageIdsForPreset: Record<
  Exclude<AutoHuntWorkflowPreset, "custom">,
  AutoHuntWorkflowStageId[]
> = {
  local: ["analyzing", "implementing", "local_qa"],
  review: ["analyzing", "implementing", "pr_open", "ci_qa"],
  release: [
    "analyzing",
    "implementing",
    "pr_open",
    "staging_qa",
    "production_qa",
  ],
  research: ["analyzing", "planning", "reviewing"],
};

const catalogById = new Map(
  autoHuntWorkflowStageCatalog.map((stage) => [stage.id, stage]),
);

export function workflowForPreset(
  preset: Exclude<AutoHuntWorkflowPreset, "custom">,
): AutoHuntWorkflow {
  return {
    version: 1,
    preset,
    stages: stageIdsForPreset[preset].map((id) => ({
      id,
      label: catalogById.get(id)?.label ?? id,
      required: true,
    })),
  };
}

export const defaultAutoHuntWorkflow = workflowForPreset("local");
export const legacyAutoHuntWorkflow = workflowForPreset("release");

export function normalizeAutoHuntWorkflow(
  workflow: AutoHuntWorkflow | null | undefined,
): AutoHuntWorkflow {
  if (!workflow || workflow.version !== 1 || workflow.stages.length === 0) {
    return structuredClone(defaultAutoHuntWorkflow);
  }
  const seen = new Set<AutoHuntWorkflowStageId>();
  const stages = workflow.stages.flatMap((stage) => {
    const catalog = catalogById.get(stage.id);
    if (!catalog || seen.has(stage.id)) return [];
    seen.add(stage.id);
    return [{
      id: stage.id,
      label: stage.label.trim() || catalog.label,
      required: stage.required,
    }];
  });
  return stages.length > 0
    ? { version: 1, preset: workflow.preset, stages }
    : structuredClone(defaultAutoHuntWorkflow);
}

export function progressForAutoHuntRun(
  status: AutoHuntRunStatus,
  workflowStage: AutoHuntWorkflowStageId | null,
  workflow: AutoHuntWorkflow,
) {
  if (status === "completed") return 100;
  if (status === "cancelled") return 0;
  if (status === "queued") return 5;
  const index = workflow.stages.findIndex((stage) => stage.id === workflowStage);
  if (index < 0) return status === "blocked" || status === "failed" ? 50 : 10;
  return Math.round(((index + 1) / (workflow.stages.length + 1)) * 100);
}

/** @deprecated Compatibility contract for installed pre-workflow CLIs. */
export const autoHuntStages = [
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

export type AutoHuntStage = (typeof autoHuntStages)[number];

export const autoHuntQaStatuses = ["pending", "passed", "skipped"] as const;
export const autoHuntQaEnvironments = ["staging", "production"] as const;
export type AutoHuntQaStatus = (typeof autoHuntQaStatuses)[number];
export type AutoHuntQaEnvironment = (typeof autoHuntQaEnvironments)[number];

/** @deprecated Use progressForAutoHuntRun with the run workflow snapshot. */
export const progressForAutoHuntStage: Record<AutoHuntStage, number> = {
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
