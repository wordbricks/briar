import { executionWorkerRuntime, workerStateAt } from "./workers";

export const workerJson = (
  worker: {
    id: string;
    device_id?: string;
    owner_user_id?: string;
    label: string;
    runtime_proto_json: string;
    state: string;
    accepting_work?: number;
    readiness_state?: string;
    readiness_detail?: string | null;
    max_concurrent_sessions?: number;
    active_sessions?: number;
    icon_type?: "emoji" | "image" | null;
    icon_value?: string | null;
    last_heartbeat_at: string;
    created_at: string;
  },
  observedAt: string,
) => {
  const runtime = executionWorkerRuntime(worker);
  const maximum = worker.max_concurrent_sessions ?? 1;
  const active = worker.active_sessions ?? 0;
  const state = workerStateAt(
    worker.last_heartbeat_at,
    observedAt,
    worker.state as never,
  );
  return {
    maxConcurrentSessions: maximum,
    activeSessions: active,
    availableSessions: Math.max(0, maximum - active),
    id: worker.id,
    ...(worker.device_id ? { deviceId: worker.device_id } : {}),
    ...(worker.owner_user_id ? { ownerUserId: worker.owner_user_id } : {}),
    label: worker.label,
    icon:
      worker.icon_type && worker.icon_value
        ? { type: worker.icon_type, value: worker.icon_value }
        : null,
    runtime,
    state,
    acceptingWork: worker.accepting_work !== 0,
    readiness:
      worker.state === "disabled"
        ? "disabled"
        : state === "stale"
          ? "offline"
          : worker.readiness_state === "needs_attention"
            ? "needs_attention"
            : (worker.active_sessions ?? 0) >=
                (worker.max_concurrent_sessions ?? 1)
              ? "busy"
              : "available",
    readinessDetail: worker.readiness_detail ?? null,
    lastHeartbeatAt: worker.last_heartbeat_at,
    createdAt: worker.created_at,
  };
};
