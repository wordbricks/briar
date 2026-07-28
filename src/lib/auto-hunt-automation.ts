export const defaultAutoHuntMaxIssues = 3;
export const maxAutoHuntIssuesLimit = 10;

export type AutoHuntQueueCandidate = {
  status: string;
  priority: number | null;
  sourceCreatedAt?: string | null;
  startedAt?: string;
  runNumber: number;
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
