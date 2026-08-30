import { Code, ConnectError, type Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { briarApiUrl } from "../api-config";
import { ApiError } from "../api/errors";

export const mobileTransport: Transport | undefined = briarApiUrl
  ? createConnectTransport({ baseUrl: briarApiUrl })
  : undefined;

export const requireMobileTransport = (): Transport => {
  if (!mobileTransport) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return mobileTransport;
};

export const mobileCallOptions = (token: string, signal?: AbortSignal) => ({
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

export const apiErrorFromConnect = (error: ConnectError): ApiError =>
  new ApiError(
    statusForConnectCode(error.code),
    error.rawMessage || error.message,
  );

export async function mobileRpc<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ConnectError) throw apiErrorFromConnect(error);
    throw error;
  }
}
