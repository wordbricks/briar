import { describe, expect, it } from "vitest";

import {
  captureErrorDiagnostics,
  errorDiagnosticOccurrenceKey,
  errorDiagnosticsForMessage,
  sanitizedRequestPath,
} from "./error-diagnostics";

describe("error diagnostics", () => {
  it("keeps route context while redacting query values and token-like segments", () => {
    expect(
      sanitizedRequestPath(
        "/projects/22222222-2222-4222-8222-222222222222/dashboard/delta?cursor=338677",
      ),
    ).toBe(
      "/projects/22222222-2222-4222-8222-222222222222/dashboard/delta?cursor=<redacted>",
    );
    expect(
      sanitizedRequestPath(
        "/invitations/super-secret-token-that-must-not-be-copied?next=private",
      ),
    ).toBe("/invitations/<redacted>?next=<redacted>");
  });

  it("formats captured request details for copying", () => {
    const error = new Error("diagnostic-test-load-failed");
    captureErrorDiagnostics(error, {
      durationMs: 125.4,
      method: "GET",
      path: "/projects/project-1/dashboard",
      scope: "api_request",
      status: 503,
    });

    const details = errorDiagnosticsForMessage(error.message);
    expect(details).toContain("Briar error diagnostics");
    expect(details).toContain("Message: diagnostic-test-load-failed");
    expect(details).toContain("Scope: api_request");
    expect(details).toContain("Request method: GET");
    expect(details).toContain("Request path: /projects/<redacted>/dashboard");
    expect(details).toContain("HTTP status: 503");
    expect(details).toContain("Duration: 125ms");
  });

  it("assigns a new occurrence key when the same error happens again", () => {
    const error = new Error("repeated-diagnostic-error");
    captureErrorDiagnostics(error, { scope: "first" });
    const firstKey = errorDiagnosticOccurrenceKey(error.message);
    captureErrorDiagnostics(error, { scope: "second" });

    expect(firstKey).not.toBeNull();
    expect(errorDiagnosticOccurrenceKey(error.message)).not.toBe(firstKey);
    expect(errorDiagnosticsForMessage(error.message)).toContain("Scope: second");
  });
});
