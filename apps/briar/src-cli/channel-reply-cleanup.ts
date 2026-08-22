export type ChannelReplyCleanupOperation = {
  label: string;
  run: () => Promise<void>;
};

/**
 * Channel context can contain private images and organization data. Retry each
 * independent cleanup and fail the claim if any residue still cannot be
 * removed; callers must not turn that condition into a successful completion.
 */
export async function cleanupChannelReplyResources(
  operations: ChannelReplyCleanupOperation[],
  attempts = 3,
) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Channel reply cleanup attempts must be a positive integer");
  }
  const failures: Error[] = [];
  for (const operation of operations) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await operation.run();
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError !== undefined) {
      failures.push(
        new Error(`Failed to clean ${operation.label}`, { cause: lastError }),
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Channel context and workspace cleanup failed",
    );
  }
}
