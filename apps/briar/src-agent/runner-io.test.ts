import { create } from "@bufbuild/protobuf";
import { sizeDelimitedDecodeStream, sizeDelimitedEncode } from "@bufbuild/protobuf/wire";
import { CONTRACTS_DESCRIPTOR_FINGERPRINT } from "@briar/contracts/descriptor-fingerprint";
import {
  ApprovalPolicy,
  JsonSchemaSchema,
  ParentToRunnerSchema,
  RunRequestSchema,
  RunnerToParentSchema,
  SandboxMode,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import { AgentEventDirection } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createRunnerIo } from "./runner-io";
import {
  encodeSidecarApprovalResponse,
  encodeSidecarRunRequest,
} from "./sidecar-protocol";
import type { RunnerRequest } from "./runner-request";

const runRequest = create(RunRequestSchema, {
  message: "Fix it",
  workspaceRoot: "/repo",
  outputSchema: create(JsonSchemaSchema, {
    value: { case: "object", value: { type: "object" } },
  }),
  approvalPolicy: ApprovalPolicy.ON_REQUEST,
  sandboxMode: SandboxMode.WORKSPACE_WRITE,
  networkAccess: true,
  providerBinaryPath: "/bin/codex",
  protocolFingerprint: CONTRACTS_DESCRIPTOR_FINGERPRINT,
});

async function firstFrame(bytes: Uint8Array) {
  async function* source() {
    yield bytes;
  }
  for await (const message of sizeDelimitedDecodeStream(
    RunnerToParentSchema,
    source(),
  )) {
    return message;
  }
  throw new Error("missing frame");
}

function testIo(onClose = vi.fn()) {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: Buffer[] = [];
  const terminate = vi.fn();
  output.on("data", (chunk: Buffer) => written.push(chunk));
  const io = createRunnerIo({
    closeError: "input closed",
    input,
    onClose,
    output,
    terminate,
  });
  return {
    input,
    io,
    onClose,
    terminate,
    written: () => Buffer.concat(written),
  };
}

async function beginRun(
  input: PassThrough,
  request: Promise<RunnerRequest>,
) {
  input.write(encodeSidecarRunRequest(runRequest));
  return request;
}

describe("runner protobuf I/O", () => {
  it("decodes fragmented input and emits a size-delimited result frame", async () => {
    const { input, io, written } = testIo();
    const frame = encodeSidecarRunRequest(runRequest);
    input.write(frame.subarray(0, 3));
    input.write(frame.subarray(3));

    await expect(io.request).resolves.toMatchObject({
      message: "Fix it",
      workspaceRoot: "/repo",
      approvalPolicy: "on-request",
      sandboxMode: "workspaceWrite",
      outputSchema: { type: "object" },
      providerBinaryPath: "/bin/codex",
    });
    io.emit.result({ sessionId: "session-1", message: "done" });
    await expect(firstFrame(written())).resolves.toMatchObject({
      payload: {
        case: "result",
        value: { sessionId: "session-1", message: "done" },
      },
    });
    io.close();
  });

  it("routes approval frames and denies pending approvals when input closes", async () => {
    const { input, io } = testIo();
    await beginRun(input, io.request);
    const cancelledSignal = new AbortController();
    const cancelled = io.waitForApproval(
      "approval-cancelled",
      cancelledSignal.signal,
    );
    const approved = io.waitForApproval("approval-approved");
    input.write(encodeSidecarApprovalResponse("approval-approved", true));
    await expect(approved).resolves.toBe(true);
    cancelledSignal.abort();
    await expect(cancelled).resolves.toBe(false);

    const deniedOnClose = io.waitForApproval("approval-closed");
    io.emit.result({ sessionId: "session-1", message: "done" });
    io.close();
    await expect(deniedOnClose).resolves.toBe(false);
  });

  it("rejects a runner built from a different descriptor image", async () => {
    const { input, io } = testIo();
    const validFrame = encodeSidecarRunRequest(runRequest);
    async function* source() {
      yield validFrame;
    }
    let requestMessage;
    for await (const message of sizeDelimitedDecodeStream(
      ParentToRunnerSchema,
      source(),
    )) {
      requestMessage = message;
      break;
    }
    if (!requestMessage || requestMessage.payload.case !== "run") {
      throw new Error("missing run request");
    }
    requestMessage.payload.value.protocolFingerprint = new Uint8Array(32);
    input.write(sizeDelimitedEncode(
      ParentToRunnerSchema,
      requestMessage,
    ));

    await expect(io.request).rejects.toThrow("fingerprint");
    io.close();
  });

  it("rejects an unspecified provider policy before execution", async () => {
    const { input, io } = testIo();
    input.write(encodeSidecarRunRequest(create(RunRequestSchema, {
      ...runRequest,
      approvalPolicy: ApprovalPolicy.UNSPECIFIED,
    })));

    await expect(io.request).rejects.toThrow("approval policy");
    io.close();
  });

  it("treats unknown approvals and EOF before terminal output as fatal", async () => {
    const unknown = testIo();
    await beginRun(unknown.input, unknown.io.request);
    unknown.input.write(encodeSidecarApprovalResponse("unknown", true));
    await vi.waitFor(() => expect(unknown.terminate).toHaveBeenCalledOnce());
    expect(unknown.onClose).toHaveBeenCalledOnce();

    const earlyEof = testIo();
    await beginRun(earlyEof.input, earlyEof.io.request);
    earlyEof.input.end();
    await vi.waitFor(() => expect(earlyEof.terminate).toHaveBeenCalledOnce());
    expect(earlyEof.onClose).toHaveBeenCalledOnce();
  });

  it("treats duplicate runs and corrupted framing as fatal", async () => {
    const duplicate = testIo();
    await beginRun(duplicate.input, duplicate.io.request);
    duplicate.input.write(encodeSidecarRunRequest(runRequest));
    await vi.waitFor(() => expect(duplicate.terminate).toHaveBeenCalledOnce());
    expect(duplicate.input.destroyed).toBe(true);

    const corrupted = testIo();
    corrupted.input.end(new Uint8Array(11).fill(0xff));
    await expect(corrupted.io.request).rejects.toThrow();
    await vi.waitFor(() => expect(corrupted.terminate).toHaveBeenCalledOnce());
    expect(corrupted.input.destroyed).toBe(true);
  });

  it("rejects every frame after terminal output", async () => {
    const { input, io, terminate } = testIo();
    await beginRun(input, io.request);
    io.emit.result({ sessionId: "session-1", message: "done" });

    expect(() => io.emit.event({
      direction: AgentEventDirection.SERVER,
      raw: { jsonrpc: "2.0" },
    })).toThrow("after terminal output");
    expect(terminate).toHaveBeenCalledOnce();
  });
});
