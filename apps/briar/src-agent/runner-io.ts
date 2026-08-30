import { sizeDelimitedDecodeStream } from "@bufbuild/protobuf/wire";
import { ParentToRunnerSchema } from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import * as Result from "effect/Result";
import {
  decodeSidecarRunRequest,
  encodeSidecarRunnerOutput,
  type SidecarRunnerOutput,
} from "./sidecar-protocol";
import { decodeRunnerRequest, type RunnerRequest } from "./runner-request";

type PendingApproval = {
  abort?: () => void;
  signal?: AbortSignal;
  resolve: (approved: boolean) => void;
};

type RunnerInput = AsyncIterable<Uint8Array> & {
  destroy?: () => void;
};

export type RunnerIoOptions = {
  closeError: string;
  input?: RunnerInput;
  onClose?: () => void;
  output?: Pick<NodeJS.WritableStream, "write">;
  terminate?: (error: Error) => void;
};

const maxSidecarFrameBytes = 16 * 1024 * 1024;

/**
 * Owns the size-delimited protobuf control channel shared by the bundled
 * agent runners. Stdout contains frames only; diagnostics belong on stderr.
 */
export function createRunnerIo<Output extends SidecarRunnerOutput>({
  closeError,
  input = process.stdin,
  onClose,
  output = process.stdout,
  terminate = () => process.exit(1),
}: RunnerIoOptions) {
  let resolveRequest: ((request: RunnerRequest) => void) | undefined;
  let rejectRequest: ((error: Error) => void) | undefined;
  const request = new Promise<RunnerRequest>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  const approvals = new Map<string, PendingApproval>();
  let closed = false;
  let locallyClosed = false;
  let runReceived = false;
  let terminalEmitted = false;
  let protocolFailed = false;

  function settleApproval(id: string, approved: boolean) {
    const pending = approvals.get(id);
    if (!pending) return;
    approvals.delete(id);
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener("abort", pending.abort);
    }
    pending.resolve(approved);
  }

  function settleClosed() {
    if (closed) return;
    closed = true;
    rejectRequest?.(new Error(closeError));
    rejectRequest = undefined;
    resolveRequest = undefined;
    for (const id of approvals.keys()) settleApproval(id, false);
    onClose?.();
  }

  function failProtocol(caught: unknown): never {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    if (!protocolFailed) {
      protocolFailed = true;
      rejectRequest?.(error);
      process.stderr.write(`[briar.runner] ${error.message}\n`);
      input.destroy?.();
      settleClosed();
      terminate(error);
    }
    throw error;
  }

  void (async () => {
    try {
      for await (const message of sizeDelimitedDecodeStream(
        ParentToRunnerSchema,
        input,
        { readMaxBytes: maxSidecarFrameBytes },
      )) {
        if (message.payload.case === "approvalResponse") {
          if (!runReceived) {
            failProtocol(
              new Error("An approval response cannot precede the run request."),
            );
          }
          if (!approvals.has(message.payload.value.id)) {
            failProtocol(new Error(
              `Unknown sidecar approval response id: ${message.payload.value.id}`,
            ));
          }
          settleApproval(
            message.payload.value.id,
            message.payload.value.approved,
          );
          continue;
        }
        if (message.payload.case !== "run") {
          throw new Error("Sidecar input frame does not contain a payload.");
        }
        if (runReceived) {
          throw new Error("The sidecar parent sent more than one run request.");
        }
        runReceived = true;
        const decoded = decodeRunnerRequest(decodeSidecarRunRequest(message));
        if (Result.isFailure(decoded)) {
          throw decoded.failure;
        }
        resolveRequest?.(decoded.success);
        resolveRequest = undefined;
        rejectRequest = undefined;
      }
      if (!locallyClosed && !terminalEmitted) {
        failProtocol(new Error("Sidecar input closed before terminal output."));
      }
    } catch (caught) {
      if (!locallyClosed && !protocolFailed) {
        try {
          failProtocol(caught);
        } catch {
          // The channel is already closed and the runner termination hook ran.
        }
      }
    } finally {
      settleClosed();
    }
  })();

  function emit(value: Output) {
    if (closed) {
      throw new Error("Cannot emit a sidecar frame after the channel closed.");
    }
    if (terminalEmitted) {
      return failProtocol(
        new Error("Cannot emit a sidecar frame after terminal output."),
      );
    }
    output.write(encodeSidecarRunnerOutput(value));
    if (
      value.type === "result" ||
      value.type === "blocked" ||
      value.type === "error"
    ) {
      terminalEmitted = true;
    }
  }

  function waitForApproval(id: string, signal?: AbortSignal) {
    if (closed) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      const pending: PendingApproval = { resolve };
      if (signal) {
        pending.signal = signal;
        pending.abort = () => settleApproval(id, false);
      }
      approvals.set(id, pending);
      if (signal?.aborted) {
        settleApproval(id, false);
      } else if (signal && pending.abort) {
        signal.addEventListener("abort", pending.abort, { once: true });
      }
    });
  }

  return {
    close: () => {
      locallyClosed = true;
      input.destroy?.();
      settleClosed();
    },
    emit,
    request,
    waitForApproval,
  };
}
