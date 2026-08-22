import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";
import {
  decodeJsonRpcMessageJsonOption,
  decodeJsonRpcMessageJsonResult,
} from "./json-rpc-message";

describe("JSON-RPC message codec", () => {
  it("decodes requests, responses, and notifications", () => {
    for (const message of [
      {},
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 0, result: null },
      { jsonrpc: "2.0", id: "", result: null },
      { jsonrpc: "2.0", id: "request-1", result: { ready: true } },
      { jsonrpc: "2.0", id: 2, result: {}, error: null },
      { jsonrpc: "2.0", method: "session/update", params: { text: "hi" } },
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32_000, message: "Failed", data: { retry: false } },
      },
    ]) {
      expect(
        Option.getOrNull(
          decodeJsonRpcMessageJsonOption(JSON.stringify(message)),
        ),
      ).toEqual(message);
    }
  });

  it("preserves provider extensions and their original property order", () => {
    const message = {
      jsonrpc: "2.0",
      method: "session/update",
      params: { text: "hi", providerExtension: { sequence: 1 } },
      error: {
        providerCode: "retryable",
        code: -32_000,
        message: "Failed",
      },
      providerTraceId: "trace-1",
    };
    const decoded = Option.getOrNull(
      decodeJsonRpcMessageJsonOption(JSON.stringify(message)),
    );

    expect(decoded).toEqual(message);
    expect(Object.keys(decoded ?? {})).toEqual(Object.keys(message));
    expect(Object.keys(decoded?.error ?? {})).toEqual(
      Object.keys(message.error),
    );
  });

  it("keeps opaque params, results, and error data at the protocol boundary", () => {
    const message = {
      params: ["provider", { nested: true }],
      result: false,
      error: { data: [1, null, "three"] },
    };

    expect(
      Option.getOrNull(
        decodeJsonRpcMessageJsonOption(JSON.stringify(message)),
      ),
    ).toEqual(message);
  });

  it("rejects malformed JSON and invalid JSON-RPC field types", () => {
    for (const input of [
      "{not-json}",
      JSON.stringify([]),
      JSON.stringify({ id: true }),
      JSON.stringify({ method: 42 }),
      JSON.stringify({ error: { code: "failed" } }),
    ]) {
      expect(Result.isFailure(decodeJsonRpcMessageJsonResult(input))).toBe(
        true,
      );
    }
  });
});
