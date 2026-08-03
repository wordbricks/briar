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
  version: 1;
  /** Optional only for read compatibility with workflows created before tool probes. */
  requirements?: AutoHuntWorkflowRequirement[];
  stages: AutoHuntWorkflowStage[];
  execution: {
    pauseAfterStage: AutoHuntWorkflowStageId;
  };
  completion: {
    requiredStages: AutoHuntWorkflowStageId[];
  };
};

type AutoHuntWorkflowInput = Omit<
  AutoHuntWorkflow,
  "completion" | "execution" | "requirements"
> & {
  requirements?: AutoHuntWorkflowRequirement[];
  completion?: AutoHuntWorkflow["completion"];
  execution?: {
    pauseAfterStage?: AutoHuntWorkflowStageId;
    stopAfterStage?: AutoHuntWorkflowStageId;
  };
  /** Read compatibility for workflows stored before an explicit pause stage. */
  release?: { enabled: boolean };
};

const catalogById: Map<string, (typeof autoHuntWorkflowStageCatalog)[number]> = new Map(
  autoHuntWorkflowStageCatalog.map((stage) => [stage.id, stage]),
);

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

export const isRepositoryWorkflowPending = (workflow: AutoHuntWorkflow) =>
  workflow.stages.some((stage) => stage.id === repositoryWorkflowPendingStageId);

export function normalizeAutoHuntWorkflow(
  workflow: AutoHuntWorkflowInput | null | undefined,
): AutoHuntWorkflow {
  if (!workflow || workflow.version !== 1 || workflow.stages.length === 0) {
    return structuredClone(repositoryWorkflowBootstrap);
  }
  const seen = new Set<AutoHuntWorkflowStageId>();
  const seenRequirements = new Set<string>();
  const requirements = (workflow.requirements ?? []).flatMap((requirement) => {
    const id = requirement.id.trim();
    const label = requirement.label.trim();
    const tool = requirement.tool.trim();
    const reason = requirement.reason.trim();
    if (!id || !label || !tool || !reason || seenRequirements.has(id)) return [];
    if (!autoHuntRequirementKinds.includes(requirement.kind)) return [];
    seenRequirements.add(id);
    return [{ id, label, kind: requirement.kind, tool, reason }];
  });
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
  if (stages.length === 0) return structuredClone(repositoryWorkflowBootstrap);
  const stageIds = new Set(stages.map((stage) => stage.id));
  const configuredRequiredStages = workflow.completion?.requiredStages.filter(
    (id) => stageIds.has(id),
  );
  const requiredStages = workflow.completion
    ? (configuredRequiredStages ?? [])
    : stages.filter((stage) => stage.required).map((stage) => stage.id);
  const configuredPauseAfterStage =
    workflow.execution?.pauseAfterStage?.trim() ||
    workflow.execution?.stopAfterStage?.trim();
  const pauseAfterStage =
    configuredPauseAfterStage && stageIds.has(configuredPauseAfterStage)
      ? configuredPauseAfterStage
      : requiredStages.at(-1) ?? stages.at(-1)!.id;
  return {
    version: 1,
    requirements,
    stages,
    execution: { pauseAfterStage },
    completion: { requiredStages },
  };
}

export function workflowPauseIndex(workflow: AutoHuntWorkflow) {
  const index = workflow.stages.findIndex(
    (stage) => stage.id === workflow.execution.pauseAfterStage,
  );
  return index < 0 ? workflow.stages.length - 1 : index;
}

/** @deprecated Use workflowPauseIndex. */
export const workflowStopIndex = workflowPauseIndex;

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
