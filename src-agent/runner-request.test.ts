import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { decodeAgyRunnerRequest } from "./agy-runner-lib";
import { decodeClaudeRunnerRequest } from "./claude-runner-lib";
import { decodeCodexRunnerRequest } from "./codex-runner-lib";
import { decodeCursorRunnerRequest } from "./cursor-runner-lib";
import { decodeGrokRunnerRequest } from "./grok-runner-lib";
import { decodeOpenCodeRunnerRequest } from "./opencode-runner-lib";

const baseRequest = {
  type: "run",
  message: "Inspect the repository",
  workspaceRoot: "/repo",
  conversationId: null,
  instructions: "Follow repository instructions",
  outputSchema: { type: "object", additionalProperties: false },
  model: null,
  effort: "high",
  approvalPolicy: "on-request",
  sandboxMode: "workspaceWrite",
  networkAccess: true,
  attachments: [{
    type: "image",
    path: "/tmp/screenshot.png",
    name: "screenshot.png",
    mimeType: "image/png",
    imageHash: "future-extension",
  }],
  requestTraceId: "trace-1",
} as const;

type RequestDecoder = (
  input: unknown,
) => Result.Result<unknown, Schema.SchemaError>;

const isUnknownArray = Schema.is(Schema.Array(Schema.Unknown));

const variants: ReadonlyArray<{
  name: string;
  decode: RequestDecoder;
  fields: Record<string, unknown>;
}> = [
  {
    name: "Claude",
    decode: decodeClaudeRunnerRequest,
    fields: {
      claudeBinary: "/bin/claude",
      additionalDirectories: ["/tmp/worktree"],
    },
  },
  {
    name: "Codex",
    decode: decodeCodexRunnerRequest,
    fields: { codexBinary: "/bin/codex", externalTools: false },
  },
  {
    name: "Cursor",
    decode: decodeCursorRunnerRequest,
    fields: { cursorBinary: "/bin/cursor-agent" },
  },
  {
    name: "Grok",
    decode: decodeGrokRunnerRequest,
    fields: { grokBinary: "/bin/grok" },
  },
  {
    name: "Antigravity",
    decode: decodeAgyRunnerRequest,
    fields: { agyBinary: "/bin/agy" },
  },
  {
    name: "OpenCode",
    decode: decodeOpenCodeRunnerRequest,
    fields: { opencodeBinary: "/bin/opencode" },
  },
];

describe("runner request schemas", () => {
  it("decodes all provider requests while preserving extensions", () => {
    for (const variant of variants) {
      const input = { ...baseRequest, ...variant.fields };
      const decoded = variant.decode(input);

      expect(Result.isSuccess(decoded), variant.name).toBe(true);
      if (Result.isSuccess(decoded)) {
        expect(decoded.success).toEqual(input);
        expect(Predicate.isReadonlyObject(decoded.success)).toBe(true);
        if (!Predicate.isReadonlyObject(decoded.success)) continue;

        expect(Object.keys(decoded.success)).toEqual(Object.keys(input));
        const attachments = decoded.success.attachments;
        expect(isUnknownArray(attachments)).toBe(true);
        if (!isUnknownArray(attachments)) continue;

        const attachment = attachments[0];
        expect(Predicate.isReadonlyObject(attachment)).toBe(true);
        if (Predicate.isReadonlyObject(attachment)) {
          expect(attachment.imageHash).toBe("future-extension");
        }
      }
    }
  });

  it("keeps the existing output schema variants", () => {
    for (const outputSchema of [
      undefined,
      null,
      true,
      false,
      { type: "string" },
    ]) {
      const decoded = decodeCodexRunnerRequest({
        ...baseRequest,
        outputSchema,
        codexBinary: "/bin/codex",
      });
      expect(Result.isSuccess(decoded)).toBe(true);
    }
  });

  it("rejects malformed common fields and attachments", () => {
    for (const input of [
      { ...baseRequest, message: 42, codexBinary: "/bin/codex" },
      { ...baseRequest, networkAccess: "yes", codexBinary: "/bin/codex" },
      { ...baseRequest, outputSchema: [], codexBinary: "/bin/codex" },
      { ...baseRequest, outputSchema: "object", codexBinary: "/bin/codex" },
      {
        ...baseRequest,
        attachments: [{
          type: "image",
          path: 42,
          name: "screenshot.png",
          mimeType: "image/png",
        }],
        codexBinary: "/bin/codex",
      },
    ]) {
      expect(Result.isFailure(decodeCodexRunnerRequest(input))).toBe(true);
    }
  });

  it("validates provider-specific request fields", () => {
    expect(Result.isFailure(decodeCodexRunnerRequest(baseRequest))).toBe(true);
    expect(Result.isFailure(decodeClaudeRunnerRequest({
      ...baseRequest,
      claudeBinary: "/bin/claude",
      additionalDirectories: [42],
    }))).toBe(true);
    expect(Result.isSuccess(decodeAgyRunnerRequest({
      ...baseRequest,
      effort: "provider-defined-effort",
      agyBinary: "/bin/agy",
    }))).toBe(true);
  });
});
