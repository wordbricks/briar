import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { runD1 } from "./d1-runtime";
import { createSqlQueryCache } from "./sql-query-cache";
import {
  WorkerUpdateHandoffWorkType,
  type WorkerUpdateHandoffContext,
  type WorkerUpdateRequest,
} from "./worker-update-model";

const UpdateRequestRow = Schema.Struct({
  id: Schema.String,
  target_version: Schema.String,
  status: Schema.Literals(["requested", "completed", "cancelled"]),
  requested_at: Schema.String,
  handoff_state: Schema.Literals(["idle", "draining", "ready", "failed"]),
  handoff_started_at: Schema.NullOr(Schema.String),
  handoff_completed_at: Schema.NullOr(Schema.String),
  handoff_error: Schema.NullOr(Schema.String),
});

const HandoffRow = Schema.Struct({
  update_request_id: Schema.String,
  work_type: WorkerUpdateHandoffWorkType,
  work_id: Schema.String,
  run_id: Schema.NullOr(Schema.String),
  metadata_json: Schema.String,
  created_at: Schema.String,
});

const HandoffMetadata = Schema.fromJsonString(Schema.Struct({
  conversationId: Schema.optional(Schema.Unknown),
  workspacePath: Schema.optional(Schema.Unknown),
}));
const decodeHandoffMetadata = Schema.decodeUnknownOption(HandoffMetadata);

const DeviceRequest = Schema.Struct({ deviceId: Schema.String });
const DeviceUpdateRequest = Schema.Struct({
  deviceId: Schema.String,
  requestId: Schema.String,
});
const HandoffRequest = Schema.Struct({
  deviceId: Schema.String,
  workType: WorkerUpdateHandoffWorkType,
  workId: Schema.String,
});
const ExistingHandoffRequest = Schema.Struct({
  requestId: Schema.String,
  workType: WorkerUpdateHandoffWorkType,
  workId: Schema.String,
  claimTokenHash: Schema.String,
});
const ReadyUpdateRequest = Schema.Struct({
  requestId: Schema.String,
  deviceId: Schema.String,
  organizationId: Schema.String,
});

const updateRequestJson = (
  row: typeof UpdateRequestRow.Type,
): WorkerUpdateRequest => ({
  id: row.id,
  targetVersion: row.target_version,
  status: row.status,
  requestedAt: row.requested_at,
  handoffState: row.handoff_state,
  handoffStartedAt: row.handoff_started_at,
  handoffCompletedAt: row.handoff_completed_at,
  handoffError: row.handoff_error,
});

const makeWorkerUpdateQueries = (sql: SqlClient.SqlClient) => {
  const updateRequestSelection = sql`
    select id, target_version, status, requested_at,
           handoff_state, handoff_started_at, handoff_completed_at,
           handoff_error
    from briar_execution_worker_update_requests
  `;

  const findPendingUpdate = SqlSchema.findOneOption({
    Request: DeviceRequest,
    Result: UpdateRequestRow,
    execute: ({ deviceId }) => sql`
      ${updateRequestSelection}
      where device_id = ${deviceId} and status = 'requested'
      order by requested_at desc limit 1
    `,
  });

  const findUpdateById = SqlSchema.findOneOption({
    Request: DeviceUpdateRequest,
    Result: UpdateRequestRow,
    execute: ({ deviceId, requestId }) => sql`
      ${updateRequestSelection}
      where id = ${requestId} and device_id = ${deviceId}
    `,
  });

  const findLatestUpdate = SqlSchema.findOneOption({
    Request: DeviceRequest,
    Result: UpdateRequestRow,
    execute: ({ deviceId }) => sql`
      ${updateRequestSelection}
      where device_id = ${deviceId}
      order by requested_at desc limit 1
    `,
  });

  const findLatestHandoff = SqlSchema.findOneOption({
    Request: HandoffRequest,
    Result: HandoffRow,
    execute: ({ deviceId, workType, workId }) => sql`
      select update_request_id, work_type, work_id, run_id,
             metadata_json, created_at
      from briar_execution_worker_update_handoffs
      where device_id = ${deviceId} and work_type = ${workType}
        and work_id = ${workId} and status = 'handed_off'
      order by updated_at desc, id desc limit 1
    `,
  });

  const findExistingHandoff = SqlSchema.findOneOption({
    Request: ExistingHandoffRequest,
    Result: Schema.Struct({ handed_off: Schema.Int }),
    execute: ({ requestId, workType, workId, claimTokenHash }) => sql`
      select 1 as handed_off
      from briar_execution_worker_update_handoffs
      where update_request_id = ${requestId} and work_type = ${workType}
        and work_id = ${workId} and claim_token_hash = ${claimTokenHash}
      limit 1
    `,
  });

  const findReadyUpdate = SqlSchema.findOneOption({
    Request: ReadyUpdateRequest,
    Result: Schema.Struct({
      handoff_state: Schema.Literals(["draining", "ready"]),
    }),
    execute: ({ requestId, deviceId, organizationId }) => sql`
      select handoff_state
      from briar_execution_worker_update_requests
      where id = ${requestId} and device_id = ${deviceId}
        and organization_id = ${organizationId} and status = 'requested'
        and handoff_state in ('draining', 'ready')
    `,
  });

  return {
    findExistingHandoff,
    findLatestHandoff,
    findLatestUpdate,
    findPendingUpdate,
    findReadyUpdate,
    findUpdateById,
  };
};
const workerUpdateQueries = createSqlQueryCache(makeWorkerUpdateQueries);

const pendingExecutionWorkerUpdateEffect = Effect.fn(
  "pendingExecutionWorkerUpdateEffect",
)(function*(deviceId: string) {
  const sql = yield* SqlClient.SqlClient;
  return Option.map(
    yield* workerUpdateQueries(sql).findPendingUpdate({ deviceId }),
    updateRequestJson,
  ).pipe(Option.getOrNull);
});

const executionWorkerUpdateRequestEffect = Effect.fn(
  "executionWorkerUpdateRequestEffect",
)(function*(request: {
  deviceId: string;
  requestId?: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  const queries = workerUpdateQueries(sql);
  const row = request.requestId === undefined
    ? yield* queries.findLatestUpdate({ deviceId: request.deviceId })
    : yield* queries.findUpdateById({
        deviceId: request.deviceId,
        requestId: request.requestId,
      });
  return Option.map(
    row,
    updateRequestJson,
  ).pipe(Option.getOrNull);
});

const executionWorkerHandoffExistsEffect = Effect.fn(
  "executionWorkerHandoffExistsEffect",
)(function*(request: typeof ExistingHandoffRequest.Type) {
  const sql = yield* SqlClient.SqlClient;
  return Option.isSome(
    yield* workerUpdateQueries(sql).findExistingHandoff(request),
  );
});

const executionWorkerUpdateIsReadyEffect = Effect.fn(
  "executionWorkerUpdateIsReadyEffect",
)(function*(request: typeof ReadyUpdateRequest.Type) {
  const sql = yield* SqlClient.SqlClient;
  return Option.isSome(
    yield* workerUpdateQueries(sql).findReadyUpdate(request),
  );
});

const latestExecutionWorkerUpdateHandoffEffect = Effect.fn(
  "latestExecutionWorkerUpdateHandoffEffect",
)(function*(request: typeof HandoffRequest.Type) {
  const sql = yield* SqlClient.SqlClient;
  const row = yield* workerUpdateQueries(sql).findLatestHandoff(request);
  return Option.map(row, (value): WorkerUpdateHandoffContext => {
    const metadata = Option.getOrElse(
      decodeHandoffMetadata(value.metadata_json),
      () => ({ conversationId: undefined, workspacePath: undefined }),
    );
    return {
      requestId: value.update_request_id,
      workType: value.work_type,
      workId: value.work_id,
      runId: value.run_id,
      conversationId: Predicate.isString(metadata.conversationId)
        ? metadata.conversationId
        : null,
      workspacePath: Predicate.isString(metadata.workspacePath)
        ? metadata.workspacePath
        : null,
      createdAt: value.created_at,
    };
  }).pipe(Option.getOrNull);
});

export const pendingExecutionWorkerUpdate = (
  db: D1Database,
  deviceId: string,
): Promise<WorkerUpdateRequest | null> =>
  runD1(db, pendingExecutionWorkerUpdateEffect(deviceId));

export const executionWorkerUpdateRequest = (
  db: D1Database,
  request: { deviceId: string; requestId?: string },
): Promise<WorkerUpdateRequest | null> =>
  runD1(db, executionWorkerUpdateRequestEffect(request));

export const executionWorkerHandoffExists = (
  db: D1Database,
  request: typeof ExistingHandoffRequest.Type,
): Promise<boolean> => runD1(db, executionWorkerHandoffExistsEffect(request));

export const executionWorkerUpdateIsReady = (
  db: D1Database,
  request: typeof ReadyUpdateRequest.Type,
): Promise<boolean> => runD1(db, executionWorkerUpdateIsReadyEffect(request));

export const latestExecutionWorkerUpdateHandoff = (
  db: D1Database,
  request: typeof HandoffRequest.Type,
): Promise<WorkerUpdateHandoffContext | null> =>
  runD1(db, latestExecutionWorkerUpdateHandoffEffect(request));
