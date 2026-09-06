import * as Schema from "effect/Schema";

/**
 * Push channel that tells connected execution Workers to claim now.
 *
 * The socket carries no work and no authority: D1 remains the only source of
 * claimable jobs. A wake frame collapses the poll interval, nothing more, so a
 * Worker whose socket is down keeps its polling cadence and loses latency
 * rather than work.
 */
export const workerWakeSubprotocolPrefix = "briar-worker-wake-v1.";
export const workerWakeHeartbeatRequest = "briar.worker-wake.heartbeat.v1";
export const workerWakeHeartbeatResponse = "briar.worker-wake.heartbeat-ack.v1";
export const workerWakeHeartbeatIntervalMs = 20_000;
export const workerWakeHeartbeatTimeoutMs = 60_000;
export const workerWakeReconnectDelayMs = 1_000;
export const workerWakeMaxReconnectDelayMs = 30_000;
/** Header the Worker-facing route uses to hand the DO the negotiated protocol. */
export const workerWakeProtocolHeader = "X-Briar-Worker-Wake-Protocol";

export const WorkerWakeReason = Schema.Literals([
  "channel_reply_enqueued",
  "issue_reply_enqueued",
  "channel_reply_completed",
  "issue_reply_completed",
]);
export type WorkerWakeReason = typeof WorkerWakeReason.Type;

const WorkerWakeReadyFrame = Schema.Struct({
  type: Schema.Literal("ready"),
});
const WorkerWakeWakeFrame = Schema.Struct({
  type: Schema.Literal("wake"),
  reason: WorkerWakeReason,
});

/** The JSON control plane shared by the wake hub and the Worker CLI. */
export const WorkerWakeFrame = Schema.Union([
  WorkerWakeReadyFrame,
  WorkerWakeWakeFrame,
]);
export type WorkerWakeFrame = typeof WorkerWakeFrame.Type;

const strictFrameOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;
const WorkerWakeFrameJson = Schema.fromJsonString(WorkerWakeFrame);

export const decodeWorkerWakeFrame = Schema.decodeUnknownSync(
  WorkerWakeFrameJson,
  strictFrameOptions,
);
export const encodeWorkerWakeFrame = Schema.encodeSync(
  WorkerWakeFrameJson,
  strictFrameOptions,
);

export const workerWakeSubprotocol = (credential: string) =>
  `${workerWakeSubprotocolPrefix}${credential}`;

/**
 * Worker credentials travel in the WebSocket subprotocol rather than a query
 * string so they never reach an access log or a browser history entry. This
 * mirrors the managed-computer remote agent socket.
 */
export function workerWakeCredentialFromProtocols(header: string | null) {
  const candidates = (header ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(workerWakeSubprotocolPrefix));
  if (candidates.length !== 1) return null;
  const token = candidates[0].slice(workerWakeSubprotocolPrefix.length);
  if (!/^briar_worker_[A-Za-z0-9_-]+$/u.test(token)) return null;
  return { protocol: candidates[0], token };
}
