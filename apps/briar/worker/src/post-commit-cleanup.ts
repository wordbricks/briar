type PostCommitCleanupOperation =
  | "account_delete"
  | "channel_delete"
  | "channel_message_delete"
  | "issue_delete"
  | "project_delete"
  | "slack_uninstall";

type PostCommitCleanupTask = {
  queue: "archive" | "slack";
  run: () => Promise<unknown>;
};

type PostCommitCleanupInput = {
  context?: ExecutionContext;
  operation: PostCommitCleanupOperation;
  observedAt: string;
  tasks: readonly PostCommitCleanupTask[];
};

const cleanupResultCounts = (result: unknown) => {
  if (!result || typeof result !== "object") return {};
  const allowed = new Set([
    "deadLettered",
    "deferred",
    "deleted",
    "failed",
    "revoked",
  ]);
  return Object.fromEntries(
    Object.entries(result).filter(
      ([key, value]) =>
        allowed.has(key) && typeof value === "number" && Number.isFinite(value),
    ),
  );
};

const logPostCommitCleanup = (input: {
  operation: PostCommitCleanupOperation;
  observedAt: string;
  queue: PostCommitCleanupTask["queue"];
  result?: unknown;
  rejection?: unknown;
}) => {
  try {
    if (input.rejection !== undefined) {
      console.error(JSON.stringify({
        message: "Post-commit cleanup task rejected",
        operation: input.operation,
        queue: input.queue,
        observedAt: input.observedAt,
        errorType: input.rejection instanceof Error
          ? input.rejection.name
          : "UnknownError",
      }));
      return;
    }
    const result = cleanupResultCounts(input.result);
    const hasQueuedFailures = (result.failed ?? 0) > 0 ||
      (result.deadLettered ?? 0) > 0;
    const record = JSON.stringify({
      message: hasQueuedFailures
        ? "Post-commit cleanup completed with queued failures"
        : "Post-commit cleanup completed",
      operation: input.operation,
      queue: input.queue,
      observedAt: input.observedAt,
      result,
    });
    if (hasQueuedFailures) console.error(record);
    else console.log(record);
  } catch {
    // Logging must never turn durable deletion into a failed HTTP response or
    // make the already-guarded cleanup promise reject.
  }
};

/**
 * External cleanup runs only after its D1 deletion/outbox transaction commits.
 * The returned promise is observability-only: callers must not await it before
 * returning the successful deletion response.
 */
export function schedulePostCommitCleanup(input: PostCommitCleanupInput) {
  const guarded = Promise.all(
    input.tasks.map(async (task) => {
      try {
        const result = await task.run();
        logPostCommitCleanup({
          operation: input.operation,
          observedAt: input.observedAt,
          queue: task.queue,
          result,
        });
      } catch (rejection) {
        logPostCommitCleanup({
          operation: input.operation,
          observedAt: input.observedAt,
          queue: task.queue,
          rejection,
        });
      }
    }),
  ).then(() => undefined);

  if (input.context) {
    try {
      input.context.waitUntil(guarded);
    } catch (rejection) {
      // A test context or a late runtime context may reject registration. The
      // task is already rejection-handled and can still make best-effort
      // progress without changing the committed deletion response.
      logPostCommitCleanup({
        operation: input.operation,
        observedAt: input.observedAt,
        queue: input.tasks[0]?.queue ?? "archive",
        rejection,
      });
      void guarded;
    }
  } else {
    void guarded;
  }
  return guarded;
}

export function responseWithPostCommitCleanup(
  response: Response,
  input: PostCommitCleanupInput,
) {
  void schedulePostCommitCleanup(input);
  return response;
}
