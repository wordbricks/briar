import type { HuntRun, ProjectAgent } from "../types";
import type { ModelEffort } from "./project-llm";
import {
  defaultAutoHuntMaxIssues,
  isAutoHuntCandidateReady,
  selectAutoHuntCandidates,
} from "./auto-hunt-automation";

export type AutoHuntWorkerDispatchDependencies = {
  dispatch: (
    run: HuntRun,
    input: {
      agentId: string;
      provider: ProjectAgent["provider"];
      model: string | null;
      effort: ModelEffort | null;
      workerId: null;
      reassign: boolean;
    },
  ) => Promise<unknown>;
  retry: (run: HuntRun, reason: string) => Promise<unknown>;
};

export async function dispatchAutoHuntToWorkers(
  dependencies: AutoHuntWorkerDispatchDependencies,
  input: {
    agent: Pick<ProjectAgent, "id" | "provider" | "model">;
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
    if (candidates.some((run) => !isAutoHuntCandidateReady(run))) {
      throw new Error(
        "선행 이슈가 완료되지 않아 Auto Hunt를 시작할 수 없습니다.",
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
    const provider = run.preferredProvider ?? input.agent.provider;
    const model =
      run.preferredModel ??
      (run.preferredProvider ? null : (input.agent.model ?? null));
    await dependencies.dispatch(run, {
      agentId: input.agent.id,
      provider,
      model,
      effort: run.preferredModel ? (run.preferredEffort ?? null) : null,
      workerId: null,
      reassign: Boolean(run.dispatchedAt || run.workerId),
    });
  }

  return {
    dispatchId: crypto.randomUUID(),
    runIds: candidates.map((run) => run.id),
  };
}
