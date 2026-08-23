import type { HuntRun } from "../types";

export function issueExecutionApprovalUnavailable(
  run: HuntRun | null,
  targetRunId: string,
) {
  if (!run || run.id !== targetRunId) return "target_unavailable" as const;
  if (run.executionReadiness === "waiting") return "prerequisites" as const;
  if (
    run.status !== "backlog" ||
    run.claimedBy ||
    run.claimedAt ||
    run.workerId ||
    run.dispatchedAt ||
    run.requestedByUserId ||
    run.dispatchMode
  ) {
    return "state_changed" as const;
  }
  return null;
}
