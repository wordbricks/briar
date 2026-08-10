export class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

const isLegacyCostRecordsRejection = (error: unknown) => {
  if (!(error instanceof HttpRequestError) || error.status !== 400) {
    return false;
  }
  if (!error.body || typeof error.body !== "object") return false;
  const issues = (error.body as Record<string, unknown>).issues;
  if (!Array.isArray(issues)) return false;
  return issues.some((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const issue = candidate as Record<string, unknown>;
    return (
      issue.code === "unrecognized_keys" &&
      Array.isArray(issue.keys) &&
      issue.keys.length === 1 &&
      issue.keys[0] === "costRecords" &&
      Array.isArray(issue.path) &&
      issue.path.length === 0
    );
  });
};

export async function uploadExecutionMetricsWithCostCompatibility<T>(input: {
  payload: Record<string, unknown>;
  send: (payload: Record<string, unknown>) => Promise<T>;
  logCompatibilityFallback?: (message: string) => void;
}): Promise<T> {
  try {
    return await input.send(input.payload);
  } catch (error) {
    const costRecords = input.payload.costRecords;
    if (
      !Array.isArray(costRecords) ||
      costRecords.length === 0 ||
      !isLegacyCostRecordsRejection(error)
    ) {
      throw error;
    }

    const { costRecords: _omitted, ...legacyPayload } = input.payload;
    const detail = error instanceof Error ? error.message : String(error);
    (input.logCompatibilityFallback ?? console.error)(
      `cost upload compatibility fallback: retrying execution metrics without costRecords after ${detail}`,
    );
    return input.send(legacyPayload);
  }
}
