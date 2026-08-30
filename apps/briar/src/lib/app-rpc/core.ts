import { Code, ConnectError, type Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  ValidationErrorDetailSchema,
} from "@briar/contracts/gen/briar/types/v1/error_pb";
import { briarApiUrl } from "../api-config";
import { ApiError } from "../api/errors";

export const appTransport: Transport | undefined = briarApiUrl
  ? createConnectTransport({ baseUrl: briarApiUrl })
  : undefined;

export const appCallOptions = (token: string, signal?: AbortSignal) => ({
  headers: { Authorization: `Bearer ${token}` },
  signal,
});

const statusForConnectCode = (code: Code): number => {
  switch (code) {
    case Code.InvalidArgument:
      return 400;
    case Code.Unauthenticated:
      return 401;
    case Code.PermissionDenied:
      return 403;
    case Code.NotFound:
      return 404;
    case Code.AlreadyExists:
    case Code.Aborted:
      return 409;
    case Code.FailedPrecondition:
    case Code.OutOfRange:
      return 410;
    case Code.ResourceExhausted:
      return 429;
    case Code.Unavailable:
      return 503;
    case Code.DeadlineExceeded:
      return 504;
    default:
      return 500;
  }
};

export const apiErrorFromConnect = (error: ConnectError): ApiError => {
  const validationIssues = error
    .findDetails(ValidationErrorDetailSchema)
    .flatMap((detail) => detail.violations)
    .map((violation) => ({
      path: violation.path ? [violation.path] : [],
      rule: violation.rule,
      message: violation.message,
    }));
  return new ApiError(
    statusForConnectCode(error.code),
    error.rawMessage || error.message,
    undefined,
    validationIssues.length > 0 ? validationIssues : undefined,
  );
};

export async function appRpc<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ConnectError) throw apiErrorFromConnect(error);
    throw error;
  }
}
