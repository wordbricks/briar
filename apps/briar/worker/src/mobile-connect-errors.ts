import { Code, ConnectError } from "@connectrpc/connect";
import { HttpError } from "./http-response";
import { RequestDecodeError } from "./request-schema";

const connectCodeFromHttpStatus = (status: number): Code => {
  switch (status) {
    case 400:
      return Code.InvalidArgument;
    case 401:
      return Code.Unauthenticated;
    case 403:
      return Code.PermissionDenied;
    case 404:
      return Code.NotFound;
    case 409:
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
    return new ConnectError(
      error.message,
      Code.InvalidArgument,
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

export async function withConnectErrors<A>(operation: () => Promise<A>) {
  try {
    return await operation();
  } catch (error) {
    throw toConnectError(error);
  }
}
