export const autoHuntSources = ["issue", "error", "feedback"] as const;

/**
 * Universal execution states. Project-specific progress belongs to a workflow
 * stage instead of being encoded in this state machine.
 */
export const autoHuntRunStatuses = [
  "backlog",
  "queued",
  "running",
  "blocked",
  "failed",
  "completed",
  "cancelled",
] as const;

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

export const autoHuntWorkflowPresets = [
  "local",
  "review",
  "release",
  "research",
  "custom",
] as const;

export type AutoHuntSource = (typeof autoHuntSources)[number];
export type AutoHuntRunStatus = (typeof autoHuntRunStatuses)[number];
export type AutoHuntWorkflowStageId = string;
export type AutoHuntWorkflowPreset =
  (typeof autoHuntWorkflowPresets)[number];

export type AutoHuntWorkflowStage = {
  id: AutoHuntWorkflowStageId;
  label: string;
  required: boolean;
  evidence?: string[];
  checks?: string[];
};

export type AutoHuntWorkflow = {
  version: 1;
  preset: AutoHuntWorkflowPreset;
  stages: AutoHuntWorkflowStage[];
  completion: {
    requiredStages: AutoHuntWorkflowStageId[];
  };
  release: {
    enabled: boolean;
  };
};

type AutoHuntWorkflowInput = Omit<AutoHuntWorkflow, "preset" | "completion" | "release"> & {
  preset?: AutoHuntWorkflowPreset;
  completion?: AutoHuntWorkflow["completion"];
  release?: AutoHuntWorkflow["release"];
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

const catalogById: Map<string, (typeof autoHuntWorkflowStageCatalog)[number]> = new Map(
  autoHuntWorkflowStageCatalog.map((stage) => [stage.id, stage]),
);

export function workflowForPreset(
  preset: Exclude<AutoHuntWorkflowPreset, "custom">,
): AutoHuntWorkflow {
  const stages = stageIdsForPreset[preset].map((id) => {
    const stage = catalogById.get(id)!;
    return {
      id,
      label: stage.label,
      required: true,
      ...(stage.evidence ? { evidence: [...stage.evidence] } : {}),
      ...(stage.checks ? { checks: [...stage.checks] } : {}),
    };
  });
  return {
    version: 1,
    preset,
    stages,
    completion: { requiredStages: stages.map((stage) => stage.id) },
    release: {
      enabled: stages.some((stage) =>
        ["staging_qa", "production_qa"].includes(stage.id),
      ),
    },
  };
}

export const defaultAutoHuntWorkflow = workflowForPreset("local");
export const legacyAutoHuntWorkflow = workflowForPreset("release");

export function normalizeAutoHuntWorkflow(
  workflow: AutoHuntWorkflowInput | null | undefined,
): AutoHuntWorkflow {
  if (!workflow || workflow.version !== 1 || workflow.stages.length === 0) {
    return structuredClone(defaultAutoHuntWorkflow);
  }
  const seen = new Set<AutoHuntWorkflowStageId>();
  const stages = workflow.stages.flatMap((stage) => {
    const id = stage.id.trim();
    const catalog = catalogById.get(id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const cleanList = (values: string[] | undefined) =>
      values?.map((value) => value.trim()).filter(Boolean);
    const evidence = cleanList(stage.evidence) ??
      (catalog?.evidence ? [...catalog.evidence] : undefined);
    const checks = cleanList(stage.checks) ??
      (catalog?.checks ? [...catalog.checks] : undefined);
    return [{
      id,
      label: stage.label.trim() || catalog?.label || id,
      required: stage.required,
      ...(evidence?.length ? { evidence } : {}),
      ...(checks?.length ? { checks } : {}),
    }];
  });
  if (stages.length === 0) return structuredClone(defaultAutoHuntWorkflow);
  const stageIds = new Set(stages.map((stage) => stage.id));
  const configuredRequiredStages = workflow.completion?.requiredStages.filter(
    (id) => stageIds.has(id),
  );
  const requiredStages = workflow.completion
    ? (configuredRequiredStages ?? [])
    : stages.filter((stage) => stage.required).map((stage) => stage.id);
  return {
    version: 1,
    preset: workflow.preset ?? "custom",
    stages,
    completion: { requiredStages },
    release: {
      enabled: workflow.release?.enabled ?? stages.some((stage) =>
        ["staging_qa", "production_qa"].includes(stage.id),
      ),
    },
  };
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
