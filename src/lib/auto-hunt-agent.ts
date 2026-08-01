import type { HuntRun, ProjectAgent } from "../types";
import { briarApiUrl } from "./api";
import { maxAutoHuntIssuesLimit } from "./auto-hunt-automation";

export const autoHuntAppServerEventName = "auto-hunt-app-server-event";
export const autoHuntDispatchEventName = "auto-hunt-dispatch-event";

export type AutoHuntAppServerEvent = {
  sessionId: string;
  sequence: number;
  occurredAtMs: number;
  direction: "client" | "server";
  message: Record<string, unknown>;
  provider?: "codex" | "claude" | "grok";
  event?: AutoHuntAgentEvent;
};

export type AutoHuntAgentEvent =
  | {
      type: "messageStarted" | "messageCompleted";
      id: string;
      phase: string | null;
      text: string;
    }
  | {
      type: "messageDelta";
      id: string;
      delta: string;
    }
  | {
      type: "turnCompleted";
      status: string;
    };

export type AutoHuntAgentMessage = {
  id: string;
  phase: string | null;
  text: string;
  startedAtMs: number;
  updatedAtMs: number;
  isComplete: boolean;
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

export type AutoHuntWorkerResult = {
  sessionId: string;
  runId: string;
  sourceKey: string;
  conversationId: string | null;
  workspaceRoot: string | null;
  outcome: AutoHuntAgentIssueResult["outcome"] | "pending" | "cancelled";
  summary: string;
  evidence: Array<Record<string, unknown>>;
};

export type AutoHuntDispatchWorkerStatus =
  | "allocating"
  | "running"
  | "needs_input"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type AutoHuntDispatchEvent = {
  dispatchGroupId: string;
  cursor: number;
  type: string;
  workerSessionId: string | null;
  runId: string | null;
  status: string;
  message: string;
  data?: Record<string, unknown>;
  occurredAt: string;
};

export type AutoHuntDispatchGroup = {
  version: number;
  dispatchGroupId: string;
  projectId: string;
  agentId: string;
  coordinatorSessionId: string;
  coordinatorConversationId: string | null;
  status: "running" | "completed" | "failed" | "interrupted";
  maxIssues: number;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  nextCursor: number;
  workers: Array<{
    sessionId: string;
    runId: string;
    sourceKey: string;
    title: string;
    workspaceRoot: string | null;
    conversationId: string | null;
    status: AutoHuntDispatchWorkerStatus;
    summary: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
  events: AutoHuntDispatchEvent[];
};

export type AutoHuntAgentResponse = {
  dispatchGroupId: string;
  conversationId: string;
  workspaceRoot: string;
  workers: AutoHuntWorkerResult[];
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
  agent: Pick<
    ProjectAgent,
    "id" | "name" | "provider" | "model" | "responsibility" | "skill"
  >,
  options: {
    coordinatorConversationId?: string | null;
  } = {},
): Promise<AutoHuntAgentResponse> {
  if (!isTauri()) {
    throw new Error("자동사냥은 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  if (!briarApiUrl) {
    throw new Error("자동사냥을 실행하려면 Briar API URL이 필요합니다.");
  }
  if (issues.length === 0) {
    throw new Error("대기 상태인 이슈가 없습니다.");
  }
  if (issues.length > maxAutoHuntIssuesLimit) {
    throw new Error(
      `한 번의 자동사냥 세션에서는 최대 ${maxAutoHuntIssuesLimit}개의 이슈만 처리할 수 있습니다.`,
    );
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AutoHuntAgentResponse>("start_project_auto_hunt", {
    projectId,
    request: {
      sessionId,
      apiUrl: briarApiUrl,
      agentId: agent.id,
      coordinatorConversationId: options.coordinatorConversationId ?? null,
      agentName: agent.name,
      agentProvider: agent.provider,
      agentModel: agent.model,
      responsibility: agent.responsibility,
      skill: agent.skill,
      issues: issues.map((issue) => ({
        runId: issue.id,
        runNumber: issue.runNumber,
        sourceKey: issue.sourceKey,
        title: issue.title,
      })),
    },
  });
}

export async function retryProjectAutoHuntRun(
  projectId: string,
  runId: string,
  reason: string,
) {
  if (!isTauri()) {
    throw new Error("Auto Hunt 재시도는 Briar 데스크톱 앱에서 사용할 수 있습니다.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<{
    runId: string;
    outcome: string;
    attempt: number;
    stage: string;
  }>("retry_project_auto_hunt_run", {
    projectId,
    runId,
    requestId: crypto.randomUUID(),
    reason,
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

export async function loadAutoHuntDispatch(
  dispatchGroupId: string,
  afterCursor = 0,
): Promise<AutoHuntDispatchGroup | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AutoHuntDispatchGroup | null>("load_auto_hunt_dispatch", {
    dispatchGroupId,
    afterCursor,
  });
}

export async function listenToAutoHuntDispatchEvents(
  onEvent: (event: AutoHuntDispatchEvent) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<AutoHuntDispatchEvent>(
    autoHuntDispatchEventName,
    (event) => onEvent(event.payload),
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

export function agentMessagesFromAppServerEvents(
  events: AutoHuntAppServerEvent[],
): AutoHuntAgentMessage[] {
  const messages = new Map<string, AutoHuntAgentMessage>();
  const order: string[] = [];

  for (const event of events) {
    const normalized = event.event;
    if (normalized?.type === "messageStarted" || normalized?.type === "messageCompleted") {
      const existing = messages.get(normalized.id);
      if (!existing) order.push(normalized.id);
      messages.set(normalized.id, {
        id: normalized.id,
        phase: normalized.phase ?? existing?.phase ?? null,
        text: normalized.text || existing?.text || "",
        startedAtMs: existing?.startedAtMs ?? event.occurredAtMs,
        updatedAtMs: event.occurredAtMs,
        isComplete: normalized.type === "messageCompleted",
      });
      continue;
    }
    if (normalized?.type === "messageDelta") {
      const existing = messages.get(normalized.id);
      if (!existing) order.push(normalized.id);
      messages.set(normalized.id, {
        id: normalized.id,
        phase: existing?.phase ?? null,
        text: `${existing?.text ?? ""}${normalized.delta}`,
        startedAtMs: existing?.startedAtMs ?? event.occurredAtMs,
        updatedAtMs: event.occurredAtMs,
        isComplete: false,
      });
      continue;
    }

    // Detached Codex workers stream JSONL directly from `codex exec` rather
    // than through the App Server RPC envelope used by saved-Agent turns.
    const directType = string(event.message.type);
    const directItem = record(event.message.item);
    if (
      (directType === "item.started" || directType === "item.completed") &&
      directItem?.type === "agent_message"
    ) {
      const id = `${event.sessionId}:${
        string(directItem.id) ?? `agent-message:${event.sequence}`
      }`;
      const existing = messages.get(id);
      if (!existing) order.push(id);
      messages.set(id, {
        id,
        phase: string(directItem.phase) ?? existing?.phase ??
          (directType === "item.completed" ? "final_answer" : null),
        text: string(directItem.text) ?? existing?.text ?? "",
        startedAtMs: existing?.startedAtMs ?? event.occurredAtMs,
        updatedAtMs: event.occurredAtMs,
        isComplete: directType === "item.completed",
      });
      continue;
    }

    // Legacy Codex logs did not include a normalized event. Keep decoding
    // their raw App Server message so existing session history still renders.
    if (event.direction !== "server") continue;
    const method = event.message.method;
    const params = record(event.message.params);
    if (!params) continue;

    if (method === "item/started" || method === "item/completed") {
      const item = record(params.item);
      if (!item || item.type !== "agentMessage") continue;
      const id = string(item.id) ?? `agent-message-${event.sequence}`;
      const existing = messages.get(id);
      if (!existing) order.push(id);
      messages.set(id, {
        id,
        phase: string(item.phase) ?? existing?.phase ?? null,
        text: string(item.text) ?? existing?.text ?? "",
        startedAtMs: existing?.startedAtMs ?? event.occurredAtMs,
        updatedAtMs: event.occurredAtMs,
        isComplete: method === "item/completed",
      });
      continue;
    }

    if (method !== "item/agentMessage/delta") continue;
    const id = string(params.itemId);
    const delta = string(params.delta);
    if (!id || delta === null) continue;
    const existing = messages.get(id);
    if (!existing) order.push(id);
    messages.set(id, {
      id,
      phase: existing?.phase ?? null,
      text: `${existing?.text ?? ""}${delta}`,
      startedAtMs: existing?.startedAtMs ?? event.occurredAtMs,
      updatedAtMs: event.occurredAtMs,
      isComplete: false,
    });
  }

  return order
    .map((id) => messages.get(id))
    .filter((message): message is AutoHuntAgentMessage => Boolean(message));
}

export function naturalLanguageFromAgentMessage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const withoutPhase = trimmed.replace(
    /^\[(?:commentary|final_answer|final|analysis)\]\s*/i,
    "",
  );
  const jsonText = withoutPhase.match(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/i,
  )?.[1] ?? withoutPhase;

  try {
    const payload = JSON.parse(jsonText) as unknown;
    const payloadRecord = record(payload);
    const naturalLanguage =
      string(payloadRecord?.message)?.trim() ||
      string(payloadRecord?.summary)?.trim();
    return naturalLanguage || withoutPhase;
  } catch {
    return withoutPhase;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
