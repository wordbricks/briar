import type { HuntRun } from "../types";

export const maxAutoHuntSessionIssues = 3;

export type AutoHuntAgentIssue = Pick<
  HuntRun,
  "id" | "runNumber" | "sourceKey" | "title"
>;

export type AutoHuntAgentIssueResult = {
  sourceKey: string;
  title: string;
  outcome: "completed" | "blocked" | "failed" | "skipped";
  summary: string;
};

export type AutoHuntAgentResponse = {
  conversationId: string;
  workspaceRoot: string;
  result: {
    summary: string;
    issues: AutoHuntAgentIssueResult[];
  };
};

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function startProjectAutoHunt(
  projectId: string,
  issues: AutoHuntAgentIssue[],
): Promise<AutoHuntAgentResponse> {
  if (!isTauri()) {
    throw new Error("자동사냥은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  if (issues.length === 0) {
    throw new Error("대기 상태인 이슈가 없습니다.");
  }
  if (issues.length > maxAutoHuntSessionIssues) {
    throw new Error(
      `한 번의 자동사냥 세션에서는 최대 ${maxAutoHuntSessionIssues}개의 이슈만 처리할 수 있습니다.`,
    );
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AutoHuntAgentResponse>("start_project_auto_hunt", {
    projectId,
    request: {
      issues: issues.map((issue) => ({
        runId: issue.id,
        runNumber: issue.runNumber,
        sourceKey: issue.sourceKey,
        title: issue.title,
      })),
    },
  });
}
