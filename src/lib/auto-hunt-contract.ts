export const autoHuntSources = ["issue", "error", "feedback"] as const;

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

export const autoHuntQaStatuses = ["pending", "passed", "skipped"] as const;
export const autoHuntQaEnvironments = ["staging", "production"] as const;

export type AutoHuntSource = (typeof autoHuntSources)[number];
export type AutoHuntStage = (typeof autoHuntStages)[number];
export type AutoHuntQaStatus = (typeof autoHuntQaStatuses)[number];
export type AutoHuntQaEnvironment = (typeof autoHuntQaEnvironments)[number];

export const progressForAutoHuntStage: Record<AutoHuntStage, number> = {
  queued: 10,
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

