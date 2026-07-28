import type {
  ClaimedProjectAgentScheduleRun,
  ProjectAgentScheduleRun,
} from "../types";
import type { ProjectLlmChatResponse } from "./project-llm";
import { isDesktopTauri } from "./platform";

export const PROJECT_AGENT_SCHEDULE_POLL_INTERVAL_MS = 15_000;
export const PROJECT_AGENT_SCHEDULE_RENEW_INTERVAL_MS = 5 * 60_000;
export const PROJECT_AGENT_SCHEDULE_POLL_EVENT =
  "project-agent-schedule-poll";

export type ProjectAgentScheduleRunnerDependencies = {
  claim: (
    projectId: string,
  ) => Promise<ClaimedProjectAgentScheduleRun | null>;
  complete: (
    projectId: string,
    runId: string,
    input:
      | { claimToken: string; status: "completed"; resultSummary: string }
      | { claimToken: string; status: "failed"; error: string },
  ) => Promise<ProjectAgentScheduleRun>;
  renew: (
    projectId: string,
    runId: string,
    claimToken: string,
  ) => Promise<unknown>;
  execute: (
    run: ClaimedProjectAgentScheduleRun,
  ) => Promise<ProjectLlmChatResponse>;
  log: (message: string, error?: unknown) => void;
};

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const bounded = (value: string, maximum: number) =>
  value.length <= maximum ? value : value.slice(0, maximum);

export async function executeClaimedProjectAgentSchedule(
  dependencies: ProjectAgentScheduleRunnerDependencies,
  run: ClaimedProjectAgentScheduleRun,
) {
  const renewal = window.setInterval(() => {
    void dependencies
      .renew(run.projectId, run.id, run.claimToken)
      .catch((error) =>
        dependencies.log(
          `예약 실행 lease 갱신 실패 (${run.scheduleName})`,
          error,
        ),
      );
  }, PROJECT_AGENT_SCHEDULE_RENEW_INTERVAL_MS);
  try {
    const response = await dependencies.execute(run);
    const resultSummary =
      response.message.trim() || `${run.agent.name} 실행이 완료되었습니다.`;
    return await dependencies.complete(run.projectId, run.id, {
      claimToken: run.claimToken,
      status: "completed",
      resultSummary: bounded(resultSummary, 100_000),
    });
  } catch (error) {
    const message = bounded(describe(error).trim() || "Unknown provider error", 4_000);
    try {
      return await dependencies.complete(run.projectId, run.id, {
        claimToken: run.claimToken,
        status: "failed",
        error: message,
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

export async function pollProjectAgentSchedulesOnce(
  dependencies: ProjectAgentScheduleRunnerDependencies,
  projectIds: readonly string[],
) {
  for (const projectId of projectIds) {
    let run: ClaimedProjectAgentScheduleRun | null;
    try {
      run = await dependencies.claim(projectId);
    } catch (error) {
      dependencies.log(`예약 실행 claim 실패 (${projectId})`, error);
      continue;
    }
    if (!run) continue;
    try {
      await executeClaimedProjectAgentSchedule(dependencies, run);
    } catch (error) {
      dependencies.log(`예약 에이전트 실행 실패 (${run.scheduleName})`, error);
    }
  }
}

export function startProjectAgentSchedulePolling(
  dependencies: ProjectAgentScheduleRunnerDependencies,
  projectIds: readonly string[],
  intervalMs = PROJECT_AGENT_SCHEDULE_POLL_INTERVAL_MS,
) {
  let running = false;
  let stopped = false;
  let unlistenNativeTick: (() => void) | null = null;
  const poll = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await pollProjectAgentSchedulesOnce(dependencies, projectIds);
    } finally {
      running = false;
    }
  };
  void poll();
  const timer = window.setInterval(() => void poll(), intervalMs);
  const pollAfterResume = () => void poll();
  window.addEventListener("focus", pollAfterResume);
  window.addEventListener("online", pollAfterResume);
  document.addEventListener("visibilitychange", pollAfterResume);
  if (isDesktopTauri()) {
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen(PROJECT_AGENT_SCHEDULE_POLL_EVENT, pollAfterResume),
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
    window.clearInterval(timer);
    window.removeEventListener("focus", pollAfterResume);
    window.removeEventListener("online", pollAfterResume);
    document.removeEventListener("visibilitychange", pollAfterResume);
    unlistenNativeTick?.();
  };
}
