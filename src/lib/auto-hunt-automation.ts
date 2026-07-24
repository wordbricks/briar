export const defaultAutoHuntMaxIssues = 3;
export const maxAutoHuntIssuesLimit = 10;
export const autoHuntAutomationCooldownMs = 5 * 60_000;

export type AutoHuntAutomation = {
  enabled: boolean;
  maxIssuesPerSession: number;
  schedule: {
    enabled: boolean;
    intervalHours: number;
  };
  queueThreshold: {
    enabled: boolean;
    minimumIssues: number;
  };
  urgentIssue: {
    enabled: boolean;
  };
};

export type AutoHuntAutomaticTrigger =
  | "schedule"
  | "queue_threshold"
  | "urgent_issue";

export type AutoHuntQueueCandidate = {
  status: string;
  priority: number | null;
  sourceCreatedAt?: string | null;
  startedAt?: string;
  runNumber: number;
};

export const defaultAutoHuntAutomation: AutoHuntAutomation = {
  enabled: false,
  maxIssuesPerSession: defaultAutoHuntMaxIssues,
  schedule: {
    enabled: false,
    intervalHours: 3,
  },
  queueThreshold: {
    enabled: false,
    minimumIssues: 3,
  },
  urgentIssue: {
    enabled: false,
  },
};

const boundedInteger = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
};

export function normalizeAutoHuntAutomation(
  automation: Partial<AutoHuntAutomation> | null | undefined,
): AutoHuntAutomation {
  return {
    enabled: automation?.enabled === true,
    maxIssuesPerSession: boundedInteger(
      automation?.maxIssuesPerSession,
      defaultAutoHuntAutomation.maxIssuesPerSession,
      1,
      maxAutoHuntIssuesLimit,
    ),
    schedule: {
      enabled: automation?.schedule?.enabled === true,
      intervalHours: boundedInteger(
        automation?.schedule?.intervalHours,
        defaultAutoHuntAutomation.schedule.intervalHours,
        1,
        168,
      ),
    },
    queueThreshold: {
      enabled: automation?.queueThreshold?.enabled === true,
      minimumIssues: boundedInteger(
        automation?.queueThreshold?.minimumIssues,
        defaultAutoHuntAutomation.queueThreshold.minimumIssues,
        1,
        100,
      ),
    },
    urgentIssue: {
      enabled: automation?.urgentIssue?.enabled === true,
    },
  };
}

export function selectAutoHuntCandidates<T extends AutoHuntQueueCandidate>(
  runs: T[],
  maximum: number,
) {
  const limit = boundedInteger(maximum, defaultAutoHuntMaxIssues, 1, maxAutoHuntIssuesLimit);
  return runs
    .filter((run) => run.status === "queued")
    .sort((left, right) => {
      const leftPriority = left.priority ?? Number.POSITIVE_INFINITY;
      const rightPriority = right.priority ?? Number.POSITIVE_INFINITY;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      const leftCreatedAt = left.sourceCreatedAt ?? left.startedAt ?? "";
      const rightCreatedAt = right.sourceCreatedAt ?? right.startedAt ?? "";
      return leftCreatedAt.localeCompare(rightCreatedAt) ||
        left.runNumber - right.runNumber;
    })
    .slice(0, limit);
}

export function automaticTriggersFor(
  automation: AutoHuntAutomation,
  runs: AutoHuntQueueCandidate[],
  nowMs: number,
  lastAutomaticStartAt: string | null,
): AutoHuntAutomaticTrigger[] {
  if (!automation.enabled) return [];
  const queued = runs.filter((run) => run.status === "queued");
  if (queued.length === 0) return [];
  const lastStartedMs = lastAutomaticStartAt
    ? Date.parse(lastAutomaticStartAt)
    : Number.NaN;
  if (
    Number.isFinite(lastStartedMs) &&
    nowMs - lastStartedMs < autoHuntAutomationCooldownMs
  ) {
    return [];
  }

  const triggers: AutoHuntAutomaticTrigger[] = [];
  if (
    automation.schedule.enabled &&
    (!Number.isFinite(lastStartedMs) ||
      nowMs - lastStartedMs >= automation.schedule.intervalHours * 60 * 60_000)
  ) {
    triggers.push("schedule");
  }
  if (
    automation.queueThreshold.enabled &&
    queued.length >= automation.queueThreshold.minimumIssues
  ) {
    triggers.push("queue_threshold");
  }
  if (
    automation.urgentIssue.enabled &&
    queued.some((run) => run.priority === 1)
  ) {
    triggers.push("urgent_issue");
  }
  return triggers;
}
