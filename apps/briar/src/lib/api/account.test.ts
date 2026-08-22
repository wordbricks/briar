import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ApiResponseDecodeError,
  apiErrorIssueMessages,
  deleteAccount,
  loadSession,
  updateAccountProfile,
} from "../api";
import {
  errorDiagnosticOccurrenceKey,
  errorDiagnosticsForMessage,
} from "../error-diagnostics";
import { loadSessionEffect, SessionUserSchema } from "./account";

const user = {
  id: "user-1",
  username: "jay_dev",
  name: "Jay Kim",
  email: "jay@example.com",
  image: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Account API", () => {
  it("decodes a session response and sends the standard request headers", async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({ user }), {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadSession("token")).resolves.toEqual(user);

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer token");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("rejects a session response that does not match the account schema", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        user: { ...user, email: 42 },
      }), {
        headers: { "Content-Type": "application/json" },
      })
    ));

    const error = await loadSession("token").catch((cause) => cause);

    expect(error).toBeInstanceOf(ApiResponseDecodeError);
    expect(error).toMatchObject({
      _tag: "ApiResponseDecodeError",
      path: "/me",
      cause: { _tag: "SchemaError" },
    });
  });

  it("keeps the legacy optional account field semantics", () => {
    const input = { ...user, username: undefined, image: undefined };

    expect(Schema.decodeUnknownSync(SessionUserSchema)(input)).toEqual(input);
  });

  it("aborts fetch when the Effect fiber is interrupted", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal ?? undefined;
      requestSignal?.addEventListener(
        "abort",
        () => reject(requestSignal?.reason),
        { once: true },
      );
    })));

    const fiber = Effect.runFork(loadSessionEffect("token"));
    await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(requestSignal?.aborted).toBe(true);
  });

  it("preserves a transport failure at the Promise facade", async () => {
    const error = new TypeError("account-session-transport-failed");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw error;
    }));

    await expect(loadSession("token")).rejects.toBe(error);

    expect(errorDiagnosticOccurrenceKey(error.message)).not.toBeNull();
    const details = errorDiagnosticsForMessage(error.message);
    expect(details).toContain("Scope: api_request");
    expect(details).toContain("Request method: GET");
    expect(details).toContain("Request path: /<redacted>");
  });

  it("preserves a JSON parse failure at the Promise facade", async () => {
    const error = new SyntaxError("account-session-json-failed");
    const response = new Response("{}", {
      headers: { "Content-Type": "application/json" },
    });
    vi.spyOn(response, "json").mockRejectedValue(error);
    vi.stubGlobal("fetch", vi.fn(async () => response));

    await expect(loadSession("token")).rejects.toBe(error);

    const details = errorDiagnosticsForMessage(error.message);
    expect(details).toContain("Scope: api_response_parse");
    expect(details).toContain("Request method: GET");
    expect(details).toContain("Request path: /<redacted>");
  });

  it("updates the signed-in account profile", async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({ user }), {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateAccountProfile("token", {
      username: "jay_dev",
      name: "Jay Kim",
      image: null,
    })).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/me"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          username: "jay_dev",
          name: "Jay Kim",
          image: null,
        }),
      }),
    );
  });

  it("deletes the signed-in account with an email confirmation", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteAccount("token", "jay@example.com"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/me"),
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ confirmation: "jay@example.com" }),
      }),
    );
  });

  it("preserves the tagged HTTP error for authentication decisions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    ));

    const error = await loadSession("expired-token").catch((cause) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: "ApiError",
      _tag: "ApiError",
      status: 401,
      message: "Unauthorized",
    });
  });

  it("preserves and formats structured API validation issues", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        message: "Invalid project workflow",
        code: "INVALID_PROJECT_WORKFLOW",
        issues: [
          "version 2 execution.checkpoints is required",
          {
            path: ["workflow", "completion", "requiredStages"],
            message: "Required",
          },
        ],
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    ));

    const error = await loadSession("token").catch((cause) => cause);
    expect(error).toMatchObject({
      name: "ApiError",
      _tag: "ApiError",
      status: 400,
      code: "INVALID_PROJECT_WORKFLOW",
      issues: expect.any(Array),
    });
    expect(apiErrorIssueMessages(error)).toEqual([
      "version 2 execution.checkpoints is required",
      "workflow.completion.requiredStages: Required",
    ]);
  });
});
