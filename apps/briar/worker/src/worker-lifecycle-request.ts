import { HttpError } from "./http-response";
import type { WorkerHardDeleteReason } from "./worker-lifecycle-repository";

const WORKER_LIFECYCLE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u;

export function workerLifecycleRequestId(
  request: Request,
  expectedRequestId: string,
) {
  const provided = request.headers.get("Idempotency-Key")?.trim();
  if (!WORKER_LIFECYCLE_REQUEST_ID.test(expectedRequestId)) {
    throw new HttpError(400, "Worker lifecycle target is invalid");
  }
  if (!provided) return `worker-lifecycle-legacy:${crypto.randomUUID()}`;
  if (
    !WORKER_LIFECYCLE_REQUEST_ID.test(provided) ||
    provided !== expectedRequestId
  ) {
    throw new HttpError(
      400,
      "Idempotency-Key must match the Worker lifecycle target",
    );
  }
  return provided;
}

export function projectWorkerDeleteReason(
  request: Request,
): Extract<WorkerHardDeleteReason, "explicit_user_unlink" | "managed_deprovision"> {
  const provided = request.headers.get("X-Briar-Worker-Lifecycle-Reason");
  if (!provided || provided === "explicit_user_unlink") {
    return "explicit_user_unlink";
  }
  if (provided === "managed_deprovision") return provided;
  throw new HttpError(400, "Worker lifecycle reason is invalid");
}
