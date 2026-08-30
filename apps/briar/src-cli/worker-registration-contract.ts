import * as Schema from "effect/Schema";

const Uuid = Schema.String.check(Schema.isUUID());

export const WorkerRegistration = Schema.Struct({
  organizationId: Uuid,
  deviceId: Uuid,
  worker: Schema.Struct({
    id: Schema.NonEmptyString,
    label: Schema.NonEmptyString,
    state: Schema.Literals(["online", "stale", "disabled"]),
    maxConcurrentSessions: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(16),
    ),
    lastHeartbeatAt: Schema.String,
  }),
  workerToken: Schema.String.check(Schema.isStartsWith("briar_worker_")),
});
export type WorkerRegistration = typeof WorkerRegistration.Type;
export const decodeWorkerRegistration = Schema.decodeUnknownSync(
  WorkerRegistration,
);

export const WorkerBinding = Schema.Struct({
  organizationId: WorkerRegistration.fields.organizationId,
  deviceId: WorkerRegistration.fields.deviceId,
  worker: WorkerRegistration.fields.worker,
});
export const decodeWorkerBinding = Schema.decodeUnknownSync(WorkerBinding);
