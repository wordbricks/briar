import * as Schema from "effect/Schema";
import { decodeRequestSync } from "./request-schema";

const WORKER_LIFECYCLE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u;

export const WorkerLifecycleRequestId = Schema.String.check(
  Schema.isPattern(WORKER_LIFECYCLE_REQUEST_ID),
);

export const decodeWorkerLifecycleRequestId = decodeRequestSync(
  WorkerLifecycleRequestId,
);
