export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly issues?: readonly unknown[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiErrorStatus(error: unknown, status: number) {
  return error instanceof ApiError && error.status === status;
}

export function errorWithMessage(error: unknown, message: string) {
  if (error instanceof ApiError) {
    return new ApiError(error.status, message, error.code, error.issues);
  }
  if (error instanceof Error && error.message === message) return error;
  return new Error(message);
}

export function apiErrorIssueMessages(error: unknown) {
  if (!(error instanceof ApiError) || !error.issues) return [];
  return error.issues.flatMap((issue) => {
    if (typeof issue === "string") return [issue];
    if (!issue || typeof issue !== "object") return [];
    const candidate = issue as { message?: unknown; path?: unknown };
    if (typeof candidate.message !== "string") return [];
    const path = Array.isArray(candidate.path)
      ? candidate.path
          .filter((part) =>
            typeof part === "string" || typeof part === "number"
          )
          .join(".")
      : "";
    return [path ? `${path}: ${candidate.message}` : candidate.message];
  });
}
