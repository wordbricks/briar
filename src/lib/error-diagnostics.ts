import { APP_VERSION } from "./app-version";

export type ErrorDiagnosticContext = {
  code?: string | null;
  durationMs?: number;
  method?: string;
  path?: string;
  scope?: string;
  status?: number;
};

type CapturedDiagnostics = {
  details: string;
  occurrenceKey: string;
};

const diagnosticsByMessage = new Map<string, CapturedDiagnostics>();
const maxRememberedDiagnostics = 30;
let nextOccurrenceId = 1;
const safeRouteSegments = new Set([
  "agents",
  "agent-sessions",
  "attachments",
  "channels",
  "cost-estimate",
  "dashboard",
  "delta",
  "evidence",
  "events",
  "health",
  "inbox",
  "invitations",
  "messages",
  "organizations",
  "projects",
  "read-states",
  "runs",
  "sessions",
  "status-tray",
  "transcript",
  "usage",
]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function redactPathSegment(segment: string) {
  if (!segment) return segment;
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return "<redacted>";
  }
  if (
    safeRouteSegments.has(decoded) ||
    /^\d+$/u.test(decoded) ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(decoded)
  ) {
    return segment;
  }
  return "<redacted>";
}

export function sanitizedRequestPath(path: string) {
  try {
    const url = new URL(path, "https://briar.invalid");
    const pathname = url.pathname
      .split("/")
      .map(redactPathSegment)
      .join("/");
    const queryKeys = [...url.searchParams.keys()];
    return queryKeys.length > 0
      ? `${pathname}?${queryKeys.map((key) => `${key}=<redacted>`).join("&")}`
      : pathname;
  } catch {
    return "<unavailable>";
  }
}

function environmentLines() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return [];
  }
  return [
    `Page: ${window.location.href}`,
    `Online: ${navigator.onLine}`,
    `User agent: ${navigator.userAgent}`,
  ];
}

function formatDiagnostics(
  error: unknown,
  occurredAt: string,
  context: ErrorDiagnosticContext,
) {
  const name = error instanceof Error ? error.name : typeof error;
  const stack = error instanceof Error ? error.stack?.trim() : null;
  return [
    "Briar error diagnostics",
    `Occurred at: ${occurredAt}`,
    `App version: ${APP_VERSION}`,
    `Message: ${errorMessage(error)}`,
    `Error type: ${name}`,
    context.scope ? `Scope: ${context.scope}` : null,
    context.method ? `Request method: ${context.method}` : null,
    context.path ? `Request path: ${sanitizedRequestPath(context.path)}` : null,
    context.status !== undefined ? `HTTP status: ${context.status}` : null,
    context.code ? `Error code: ${context.code}` : null,
    context.durationMs !== undefined
      ? `Duration: ${Math.max(0, Math.round(context.durationMs))}ms`
      : null,
    ...environmentLines(),
    stack ? `Stack:\n${stack}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function captureErrorDiagnostics(
  error: unknown,
  context: ErrorDiagnosticContext = {},
) {
  const message = errorMessage(error).trim();
  if (!message) return;
  diagnosticsByMessage.delete(message);
  diagnosticsByMessage.set(
    message,
    {
      details: formatDiagnostics(error, new Date().toISOString(), context),
      occurrenceKey: `error:${nextOccurrenceId++}`,
    },
  );
  while (diagnosticsByMessage.size > maxRememberedDiagnostics) {
    const oldest = diagnosticsByMessage.keys().next().value;
    if (oldest === undefined) break;
    diagnosticsByMessage.delete(oldest);
  }
}

export function errorDiagnosticsForMessage(message: string) {
  const trimmed = message.trim();
  return diagnosticsByMessage.get(trimmed)?.details ?? formatDiagnostics(
    new Error(trimmed),
    new Date().toISOString(),
    { scope: "application" },
  );
}

export function errorDiagnosticOccurrenceKey(message: string) {
  return diagnosticsByMessage.get(message.trim())?.occurrenceKey ?? null;
}
