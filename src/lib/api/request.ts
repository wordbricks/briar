import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { briarApiUrl } from "../api-config";
import { captureErrorDiagnostics } from "../error-diagnostics";
import {
  ApiError,
  ApiRequestError,
  ApiResponseDecodeError,
} from "./errors";

const ApiErrorPayload = Schema.Struct({
  message: Schema.optionalKey(Schema.Unknown),
  error_description: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
  code: Schema.optionalKey(Schema.Unknown),
  issues: Schema.optionalKey(Schema.Unknown),
});

type ApiErrorPayload = typeof ApiErrorPayload.Type;

const emptyApiErrorPayload: ApiErrorPayload = {};
const decodeApiErrorPayload = Schema.decodeUnknownOption(ApiErrorPayload);
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeIssues = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

const methodFor = (init?: RequestInit) =>
  (init?.method ?? "GET").toUpperCase();

async function requestUnknown(
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<unknown> {
  if (!briarApiUrl) throw new Error("Briar API URL이 설정되지 않았습니다.");
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const method = methodFor(init);
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(`${briarApiUrl}${path}`, {
      ...init,
      headers,
    });
  } catch (caught) {
    captureErrorDiagnostics(caught, {
      durationMs: performance.now() - startedAt,
      method,
      path,
      scope: "api_request",
    });
    throw caught;
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const payload = Option.getOrElse(
      decodeApiErrorPayload(body),
      () => emptyApiErrorPayload,
    );
    const message = Option.getOrUndefined(Option.firstSomeOf([
      decodeString(payload.message),
      decodeString(payload.error_description),
      decodeString(payload.error),
    ]));
    const error = new ApiError(
      response.status,
      message ?? `Briar API 요청 실패 (${response.status})`,
      Option.getOrUndefined(decodeString(payload.code)),
      Option.getOrUndefined(decodeIssues(payload.issues)),
    );
    captureErrorDiagnostics(error, {
      code: error.code,
      durationMs: performance.now() - startedAt,
      method,
      path,
      scope: "api_request",
      status: response.status,
    });
    throw error;
  }
  if (response.status === 204) return undefined;
  try {
    const body: unknown = await response.json();
    return body;
  } catch (caught) {
    captureErrorDiagnostics(caught, {
      durationMs: performance.now() - startedAt,
      method,
      path,
      scope: "api_response_parse",
      status: response.status,
    });
    throw caught;
  }
}

export async function request<T>(
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  const body = await requestUnknown(path, token, init);
  return body as T;
}

const requestUnknownEffect = Effect.fnUntraced(function*(
  path: string,
  token: string | null,
  init?: RequestInit,
) {
  return yield* Effect.tryPromise({
    try: (signal) => requestUnknown(path, token, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, signal])
        : signal,
    }),
    catch: (cause) => cause instanceof ApiError
      ? cause
      : new ApiRequestError(methodFor(init), path, cause),
  });
});

export const requestDecodedEffect = Effect.fn("requestDecodedEffect")(
  function*<S extends Schema.Constraint>(
    schema: S,
    path: string,
    token: string | null,
    init?: RequestInit,
  ) {
    const body = yield* requestUnknownEffect(path, token, init);
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError((cause) => new ApiResponseDecodeError(path, cause)),
    );
  },
);

export const requestVoidEffect = Effect.fn("requestVoidEffect")(
  function*(
    path: string,
    token: string | null,
    init?: RequestInit,
  ) {
    yield* requestUnknownEffect(path, token, init);
  },
);

export async function runApiPromise<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  try {
    return await Effect.runPromise(effect);
  } catch (error) {
    if (error instanceof ApiRequestError) throw error.cause;
    throw error;
  }
}
