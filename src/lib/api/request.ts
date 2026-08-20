import { briarApiUrl } from "../api-config";
import { captureErrorDiagnostics } from "../error-diagnostics";
import { ApiError } from "./errors";

export async function request<T>(
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  if (!briarApiUrl) throw new Error("Briar API URL이 설정되지 않았습니다.");
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const method = (init?.method ?? "GET").toUpperCase();
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
    const body = await response.json().catch(() => null);
    const error = new ApiError(
      response.status,
      body?.message ??
        body?.error_description ??
        body?.error ??
        `Briar API 요청 실패 (${response.status})`,
      body?.code,
      Array.isArray(body?.issues) ? body.issues : undefined,
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
  if (response.status === 204) return undefined as T;
  try {
    return await response.json() as T;
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
