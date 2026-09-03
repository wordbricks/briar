import type {
  ClaimedProjectAgentScheduleRun,
  ProjectAgentScheduleRun,
} from "../types";
import { events, type ProjectLlmResponse } from "../generated/tauri";
import type { StructuredAgentResult } from "./agent-result";
import { isDesktopTauri } from "./platform";

export const PROJECT_AGENT_SCHEDULE_POLL_INTERVAL_MS = 60_000;
export const PROJECT_AGENT_SCHEDULE_RENEW_INTERVAL_MS = 5 * 60_000;
export type TeamAgentScheduleRunnerDependencies = {
  claim: (
    projectIds: readonly string[],
  ) => Promise<ClaimedProjectAgentScheduleRun | null>;
  complete: (
    projectId: string,
    runId: string,
    input:
      | {
          claimToken: string;
          status: "completed";
          resultSummary: string;
          structuredResult: StructuredAgentResult;
        }
      | {
          claimToken: string;
          status: "failed";
          error: string;
          structuredResult: StructuredAgentResult;
        },
  ) => Promise<ProjectAgentScheduleRun>;
  renew: (
    projectId: string,
    runId: string,
    claimToken: string,
  ) => Promise<unknown>;
  execute: (
    run: ClaimedProjectAgentScheduleRun,
  ) => Promise<
    ProjectLlmResponse & { structuredResult: StructuredAgentResult }
  >;
  log: (message: string, error?: unknown) => void;
  listenForNativePoll?: (poll: () => void) => Promise<() => void>;
};

const listenForNativePoll = async (poll: () => void) =>
  events.projectAgentSchedulePoll.listen(poll);

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const bounded = (value: string, maximum: number) =>
  value.length <= maximum ? value : value.slice(0, maximum);

export async function executeClaimedTeamAgentSchedule(
  dependencies: TeamAgentScheduleRunnerDependencies,
  run: ClaimedProjectAgentScheduleRun,
) {
  const renewal = window.setInterval(() => {
    void dependencies
      .renew(run.teamId, run.id, run.claimToken)
      .catch((error) =>
        dependencies.log(
          `예약 실행 lease 갱신 실패 (${run.scheduleName})`,
          error,
        ),
      );
  }, PROJECT_AGENT_SCHEDULE_RENEW_INTERVAL_MS);
  try {
    const response = await dependencies.execute(run);
    const resultSummary = response.structuredResult.summary;
    return await dependencies.complete(run.teamId, run.id, {
      claimToken: run.claimToken,
      status: "completed",
      resultSummary: bounded(resultSummary, 100_000),
      structuredResult: response.structuredResult,
    });
  } catch (error) {
    const message = bounded(describe(error).trim() || "Unknown provider error", 4_000);
    try {
      return await dependencies.complete(run.teamId, run.id, {
        claimToken: run.claimToken,
        status: "failed",
        error: message,
        structuredResult: {
          summary: message,
          outcome: "failed",
          importance: "important",
          urgency: "time_sensitive",
          impact: "issue",
          humanActionRequired: true,
          nextAction: "실패 원인을 확인하고 예약 작업을 다시 실행하세요.",
          dueAt: null,
        },
      });
    } catch (completionError) {
      dependencies.log(
        `예약 실행 실패 결과 기록 실패 (${run.scheduleName})`,
        completionError,
      );
      throw error;
    }
  } finally {
    window.clearInterval(renewal);
  }
}

export async function pollTeamAgentSchedulesOnce(
  dependencies: TeamAgentScheduleRunnerDependencies,
  projectIds: readonly string[],
) {
  for (let attempt = 0; attempt < projectIds.length; attempt += 1) {
    let run: ClaimedProjectAgentScheduleRun | null;
    try {
      run = await dependencies.claim(projectIds);
    } catch (error) {
      dependencies.log("예약 실행 batch claim 실패", error);
      return;
    }
    if (!run) return;
    try {
      await executeClaimedTeamAgentSchedule(dependencies, run);
    } catch (error) {
      dependencies.log(`예약 에이전트 실행 실패 (${run.scheduleName})`, error);
    }
  }
}

export function startTeamAgentSchedulePolling(
  dependencies: TeamAgentScheduleRunnerDependencies,
  projectIds: readonly string[],
  intervalMs = PROJECT_AGENT_SCHEDULE_POLL_INTERVAL_MS,
) {
  let running = false;
  let stopped = false;
  let unlistenNativeTick: (() => void) | null = null;
  const poll = async (allowBackground = false) => {
    if (running || stopped) return;
    if (!allowBackground && document.hidden) return;
    running = true;
    try {
      await pollTeamAgentSchedulesOnce(dependencies, projectIds);
    } finally {
      running = false;
    }
  };
  void poll(true);
  const desktop = isDesktopTauri();
  const timer = desktop
    ? null
    : window.setInterval(() => void poll(), intervalMs);
  const pollAfterResume = () => void poll();
  window.addEventListener("focus", pollAfterResume);
  window.addEventListener("online", pollAfterResume);
  document.addEventListener("visibilitychange", pollAfterResume);
  if (desktop) {
    void (dependencies.listenForNativePoll ?? listenForNativePoll)(
      () => void poll(true),
    )
      .then((unlisten) => {
        if (stopped) {
          unlisten();
        } else {
          unlistenNativeTick = unlisten;
        }
      })
      .catch((error) =>
        dependencies.log("네이티브 예약 실행 타이머 연결 실패", error),
      );
  }
  return () => {
    stopped = true;
    if (timer !== null) window.clearInterval(timer);
    window.removeEventListener("focus", pollAfterResume);
    window.removeEventListener("online", pollAfterResume);
    document.removeEventListener("visibilitychange", pollAfterResume);
    unlistenNativeTick?.();
  };
}
