import * as Data from "effect/Data";
import * as Predicate from "effect/Predicate";
import type { SchemaError } from "effect/Schema";

export class ApiError extends Data.TaggedError("ApiError")<{
  readonly status: number;
  readonly message: string;
  readonly code?: string;
  readonly issues?: readonly unknown[];
}> {
  constructor(
    status: number,
    message: string,
    code?: string,
    issues?: readonly unknown[],
  ) {
    super({ status, message, code, issues });
  }
}

export class ApiResponseDecodeError extends Data.TaggedError(
  "ApiResponseDecodeError",
)<{
  readonly path: string;
  readonly cause: SchemaError;
  readonly message: string;
}> {
  constructor(path: string, cause: SchemaError) {
    super({
      path,
      cause,
      message: `Briar API ${path} 응답 형식이 올바르지 않습니다: ${cause.message}`,
    });
  }
}

function findApiError(error: unknown): ApiError | undefined {
  const visited = new Set<object>();
  let current = error;

  while (Predicate.isObject(current) && !visited.has(current)) {
    if (current instanceof ApiError) return current;
    visited.add(current);
    if (!Predicate.hasProperty(current, "cause")) return undefined;
    current = current.cause;
  }

  return undefined;
}

export function isApiErrorStatus(error: unknown, status: number) {
  return findApiError(error)?.status === status;
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
    if (Predicate.isString(issue)) return [issue];
    if (
      !Predicate.hasProperty(issue, "message") ||
      !Predicate.isString(issue.message)
    ) return [];
    const candidatePath = Predicate.hasProperty(issue, "path")
      ? issue.path
      : undefined;
    const path = Array.isArray(candidatePath)
      ? candidatePath
          .filter((part) =>
            Predicate.isString(part) || Predicate.isNumber(part)
          )
          .join(".")
      : "";
    return [path ? `${path}: ${issue.message}` : issue.message];
  });
}
