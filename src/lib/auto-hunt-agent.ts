import type { HuntRun } from "../types";

export const maxAutoHuntSessionIssues = 3;
export const autoHuntAppServerEventName = "auto-hunt-app-server-event";

export type AutoHuntAppServerEvent = {
  sessionId: string;
  sequence: number;
  occurredAtMs: number;
  direction: "client" | "server";
  message: Record<string, unknown>;
};

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
  sessionId: string,
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
      sessionId,
      issues: issues.map((issue) => ({
        runId: issue.id,
        runNumber: issue.runNumber,
        sourceKey: issue.sourceKey,
        title: issue.title,
      })),
    },
  });
}

export async function loadAutoHuntAppServerEvents(
  sessionId: string,
): Promise<AutoHuntAppServerEvent[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AutoHuntAppServerEvent[]>(
    "load_auto_hunt_app_server_events",
    { sessionId },
  );
}

export async function listenToAutoHuntAppServerEvents(
  onEvent: (event: AutoHuntAppServerEvent) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<AutoHuntAppServerEvent>(
    autoHuntAppServerEventName,
    (event) => onEvent(event.payload),
  );
}

export function mergeAutoHuntAppServerEvents(
  current: AutoHuntAppServerEvent[],
  incoming: AutoHuntAppServerEvent | AutoHuntAppServerEvent[],
): AutoHuntAppServerEvent[] {
  const merged = new Map(
    current.map((event) => [`${event.sessionId}:${event.sequence}`, event]),
  );
  for (const event of Array.isArray(incoming) ? incoming : [incoming]) {
    merged.set(`${event.sessionId}:${event.sequence}`, event);
  }
  return [...merged.values()].sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId) ||
    left.sequence - right.sequence
  );
}
