import {
  Code,
  ConnectError,
  type Interceptor,
} from "@connectrpc/connect";
import {
  ValidationErrorDetailSchema,
} from "@briar/contracts/gen/briar/types/v1/error_pb";
import * as SchemaIssue from "effect/SchemaIssue";
import { agentSkillConflictMessage } from "./agent-skills";
import { HttpError } from "./http-response";
import { RequestDecodeError } from "./request-schema";
import { ProjectWorkflowInputError } from "./run-request-contract";
import { TranscriptLimitError, WorkerConflictError } from "./workers";

const formatSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1();

const connectCodeFromHttpStatus = (status: number): Code => {
  switch (status) {
    case 400:
    case 411:
    case 422:
      return Code.InvalidArgument;
    case 401:
      return Code.Unauthenticated;
    case 403:
      return Code.PermissionDenied;
    case 404:
      return Code.NotFound;
    case 409:
    case 428:
      return Code.FailedPrecondition;
    case 410:
      return Code.OutOfRange;
    case 413:
    case 429:
      return Code.ResourceExhausted;
    case 501:
      return Code.Unimplemented;
    case 503:
      return Code.Unavailable;
    default:
      return Code.Internal;
  }
};

export const toConnectError = (error: unknown): ConnectError => {
  if (error instanceof ConnectError) return error;
  if (error instanceof RequestDecodeError) {
    const violations = formatSchemaIssue(error.cause.issue).issues.map(
      (issue) => ({
        path: (issue.path ?? []).map(String).join("."),
        rule: "schema",
        message: issue.message,
      }),
    );
    return new ConnectError(
      "Invalid request",
      Code.InvalidArgument,
      undefined,
      [{
        desc: ValidationErrorDetailSchema,
        value: { violations },
      }],
      error,
    );
  }
  if (error instanceof ProjectWorkflowInputError) {
    return new ConnectError(
      error.message,
      Code.InvalidArgument,
      undefined,
      undefined,
      error,
    );
  }
  if (error instanceof TranscriptLimitError) {
    return new ConnectError(
      error.message,
      Code.ResourceExhausted,
      undefined,
      undefined,
      error,
    );
  }
  if (error instanceof WorkerConflictError) {
    return new ConnectError(
      error.message,
      Code.FailedPrecondition,
      undefined,
      undefined,
      error,
    );
  }
  const skillConflict = agentSkillConflictMessage(error);
  if (skillConflict) {
    return new ConnectError(
      skillConflict,
      Code.FailedPrecondition,
      undefined,
      undefined,
      error,
    );
  }
  if (error instanceof HttpError) {
    return new ConnectError(
      error.message,
      connectCodeFromHttpStatus(error.status),
      undefined,
      undefined,
      error,
    );
  }
  return new ConnectError(
    "Internal server error",
    Code.Internal,
    undefined,
    undefined,
    error,
  );
};

export const connectErrorInterceptor: Interceptor =
  (next) => async (request) => {
    try {
      return await next(request);
    } catch (error) {
      throw toConnectError(error);
    }
  };

export async function withConnectErrors<A>(operation: () => Promise<A>) {
  try {
    return await operation();
  } catch (error) {
    throw toConnectError(error);
  }
}
