import type { AgentProvider } from "./agent-provider-contract";

export const autoHuntAppServerEventName = "auto-hunt-app-server-event";
export const autoHuntDispatchEventName = "auto-hunt-dispatch-event";

export type AutoHuntAppServerEvent = {
  sessionId: string;
  sequence: number;
  occurredAtMs: number;
  direction: "client" | "server";
  message: Record<string, unknown>;
  provider?: AgentProvider;
  event?: AutoHuntAgentEvent;
};

export type AutoHuntAgentEvent =
  | {
      type: "conversationStarted";
      conversationId: string;
    }
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
      type: "activityStarted";
      id: string;
      kind: "command" | "fileChange" | "webSearch" | "tool";
      title: string;
      text: string;
    }
  | {
      type: "activityDelta";
      id: string;
      delta: string;
    }
  | {
      type: "activityCompleted";
      id: string;
      kind: "command" | "fileChange" | "webSearch" | "tool";
      title: string;
      text: string;
      status: "completed" | "failed" | "cancelled";
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

export type AutoHuntWorkerResult = {
  sessionId: string;
  runId: string;
  sourceKey: string;
  conversationId: string | null;
  workspaceRoot: string | null;
  outcome:
    | "pending"
    | "completed"
    | "blocked"
    | "failed"
    | "skipped"
    | "cancelled";
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

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
  let turnSequence = 0;

  for (const event of events) {
    if (
      event.direction === "client" &&
      (event.message.method === "turn/start" || event.message.type === "run")
    ) {
      turnSequence += 1;
    }
    const normalized = event.event;
    if (normalized?.type === "messageStarted" || normalized?.type === "messageCompleted") {
      const id = turnSequence > 1
        ? `turn:${turnSequence}:${normalized.id}`
        : normalized.id;
      const existing = messages.get(id);
      if (!existing) order.push(id);
      messages.set(id, {
        id,
        phase: normalized.phase ?? existing?.phase ?? null,
        text: normalized.text || existing?.text || "",
        startedAtMs: existing?.startedAtMs ?? event.occurredAtMs,
        updatedAtMs: event.occurredAtMs,
        isComplete: normalized.type === "messageCompleted",
      });
      continue;
    }
    if (normalized?.type === "messageDelta") {
      const id = turnSequence > 1
        ? `turn:${turnSequence}:${normalized.id}`
        : normalized.id;
      const existing = messages.get(id);
      if (!existing) order.push(id);
      messages.set(id, {
        id,
        phase: existing?.phase ?? null,
        text: `${existing?.text ?? ""}${normalized.delta}`,
        startedAtMs: existing?.startedAtMs ?? event.occurredAtMs,
        updatedAtMs: event.occurredAtMs,
        isComplete: false,
      });
      continue;
    }

    // Keep decoding the legacy detached Codex JSONL shape for transcripts
    // written before detached workers moved to the shared App Server runner.
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
    .filter((message): message is AutoHuntAgentMessage => Boolean(message))
    // Empty bodies only produce the "writing…" placeholder. Hide them so
    // providers that stream via ephemeral deltas cannot flood the work log
    // with blank incomplete rows.
    .filter((message) => message.text.trim().length > 0);
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
