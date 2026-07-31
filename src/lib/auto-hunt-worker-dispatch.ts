import type { HuntRun, ProjectAgent } from "../types";
import {
  defaultAutoHuntMaxIssues,
  selectAutoHuntCandidates,
} from "./auto-hunt-automation";

export type AutoHuntWorkerDispatchDependencies = {
  dispatch: (
    run: HuntRun,
    input: {
      agentId: string;
      provider: ProjectAgent["provider"];
      workerId: null;
      reassign: boolean;
    },
  ) => Promise<unknown>;
  retry: (run: HuntRun, reason: string) => Promise<unknown>;
};

export async function dispatchAutoHuntToWorkers(
  dependencies: AutoHuntWorkerDispatchDependencies,
  input: {
    agent: Pick<ProjectAgent, "id" | "provider">;
    runs: HuntRun[];
    maxIssues?: number;
    targetRunIds?: string[];
    retryReason?: string | null;
  },
) {
  const targetRunIds = input.targetRunIds ?? [];
  let candidates: HuntRun[];

  if (targetRunIds.length > 0) {
    const targets = new Set(targetRunIds);
    candidates = input.runs.filter((run) => targets.has(run.id));
    if (candidates.length !== targets.size) {
      throw new Error(
        "재시도할 Auto Hunt 이슈를 현재 프로젝트에서 찾지 못했습니다.",
      );
    }
    for (const run of candidates) {
      await dependencies.retry(
        run,
        input.retryReason ??
          "저장된 Agent가 블로킹 해소를 확인하여 재시도를 요청했습니다.",
      );
    }
  } else {
    candidates = selectAutoHuntCandidates(
      input.runs,
      input.maxIssues ?? defaultAutoHuntMaxIssues,
    );
  }

  if (candidates.length === 0) {
    throw new Error("대기 상태인 이슈가 없습니다.");
  }

  for (const run of candidates) {
    await dependencies.dispatch(run, {
      agentId: input.agent.id,
      provider: input.agent.provider,
      workerId: null,
      reassign: Boolean(run.dispatchedAt || run.workerId),
    });
  }

  return {
    dispatchId: crypto.randomUUID(),
    runIds: candidates.map((run) => run.id),
  };
}
