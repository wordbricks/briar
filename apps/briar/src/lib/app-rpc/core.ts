import {
  type CallOptions,
  Code,
  ConnectError,
  createContextKey,
  createContextValues,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  ApplicationErrorDetailSchema,
  ValidationErrorDetailSchema,
} from "@briar/contracts/gen/briar/types/v1/error_pb";
import { briarApiUrl } from "../api-config";
import { ApiError } from "../api/errors";

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
    case Code.FailedPrecondition:
      return 409;
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
  const applicationCode = error
    .findDetails(ApplicationErrorDetailSchema)
    .at(0)?.code;
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
    applicationCode || undefined,
    validationIssues.length > 0 ? validationIssues : undefined,
  );
};

const bearerTokenContextKey = createContextKey<string | undefined>(undefined, {
  description: "Briar bearer token",
});

const appClientInterceptor: Interceptor = (next) => async (request) => {
  const token = request.contextValues.get(bearerTokenContextKey);
  if (token) request.header.set("authorization", `Bearer ${token}`);

  try {
    return await next(request);
  } catch (error) {
    if (error instanceof ConnectError) throw apiErrorFromConnect(error);
    throw error;
  }
};

export const appTransport: Transport | undefined = briarApiUrl
  ? createConnectTransport({
    baseUrl: briarApiUrl,
    interceptors: [appClientInterceptor],
  })
  : undefined;

export const appCallOptions = (
  token: string,
  signal?: AbortSignal,
): CallOptions => ({
  contextValues: createContextValues().set(bearerTokenContextKey, token),
  signal,
});
