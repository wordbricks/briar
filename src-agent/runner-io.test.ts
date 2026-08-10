import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createRunnerIo } from "./runner-io";

type TestRequest = { type: "run"; message: string };
type TestOutput = { type: "result"; message: string };

function testIo(onClose = vi.fn()) {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    written += chunk;
  });
  const io = createRunnerIo<TestRequest, TestOutput>({
    closeError: "input closed",
    input,
    onClose,
    output,
  });
  return { input, io, onClose, written: () => written };
}

async function beginRun(input: PassThrough, request: Promise<TestRequest>) {
  input.write(`${JSON.stringify({ type: "run", message: "Fix it" })}\n`);
  await request;
}

describe("runner JSON-lines I/O", () => {
  it("accepts the first run request and emits one JSON object per line", async () => {
    const { input, io, written } = testIo();
    input.write(`${JSON.stringify({ type: "run", message: "Fix it" })}\n`);

    await expect(io.request).resolves.toEqual({
      type: "run",
      message: "Fix it",
    });
    io.emit({ type: "result", message: "done" });
    expect(written()).toBe('{"type":"result","message":"done"}\n');
    io.close();
  });

  it("routes approval responses and ignores unknown approval ids", async () => {
    const { input, io } = testIo();
    await beginRun(input, io.request);
    const approval = io.waitForApproval("approval-1");
    input.write(
      `${JSON.stringify({
        type: "approvalResponse",
        id: "unknown",
        approved: false,
      })}\n`,
    );
    input.write(
      `${JSON.stringify({
        type: "approvalResponse",
        id: "approval-1",
        approved: true,
      })}\n`,
    );

    await expect(approval).resolves.toBe(true);
    io.close();
  });

  it("denies pending approvals and rejects a missing run when input closes", async () => {
    const first = testIo();
    const pendingApproval = first.io.waitForApproval("approval-1");
    first.input.end();

    await expect(first.io.request).rejects.toThrow("input closed");
    await expect(pendingApproval).resolves.toBe(false);
    expect(first.onClose).toHaveBeenCalledOnce();
  });

  it("rejects malformed JSON before the run request", async () => {
    const { input, io } = testIo();
    input.write("{not-json}\n");

    await expect(io.request).rejects.toBeInstanceOf(SyntaxError);
    io.close();
  });

  it("denies an approval when its abort signal fires", async () => {
    const { input, io } = testIo();
    await beginRun(input, io.request);
    const controller = new AbortController();
    const approval = io.waitForApproval("approval-1", controller.signal);
    controller.abort();

    await expect(approval).resolves.toBe(false);
    io.close();
  });
});
