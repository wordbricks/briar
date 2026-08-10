import { createInterface } from "node:readline";

type RunRequest = { type: "run" };

type ApprovalResponse = {
  type: "approvalResponse";
  id: string;
  approved: boolean;
};

type PendingApproval = {
  abort?: () => void;
  signal?: AbortSignal;
  resolve: (approved: boolean) => void;
};

export type RunnerIoOptions = {
  closeError: string;
  input?: NodeJS.ReadableStream;
  onClose?: () => void;
  output?: Pick<NodeJS.WritableStream, "write">;
};

/**
 * Owns the JSON-lines control channel shared by the bundled agent runners.
 * Exactly one run request is accepted; approval responses remain available
 * until the input closes, at which point every pending approval is denied.
 */
export function createRunnerIo<Request extends RunRequest, Output>({
  closeError,
  input = process.stdin,
  onClose,
  output = process.stdout,
}: RunnerIoOptions) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let resolveRequest: ((request: Request) => void) | undefined;
  let rejectRequest: ((error: Error) => void) | undefined;
  const request = new Promise<Request>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  const approvals = new Map<string, PendingApproval>();

  function settleApproval(id: string, approved: boolean) {
    const pending = approvals.get(id);
    if (!pending) return;
    approvals.delete(id);
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener("abort", pending.abort);
    }
    pending.resolve(approved);
  }

  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line) as Request | ApprovalResponse;
      if (message.type === "run") {
        resolveRequest?.(message);
        resolveRequest = undefined;
        rejectRequest = undefined;
        return;
      }
      if (message.type === "approvalResponse") {
        settleApproval(message.id, message.approved);
      }
    } catch (caught) {
      rejectRequest?.(
        caught instanceof Error ? caught : new Error(String(caught)),
      );
    }
  });

  lines.on("close", () => {
    rejectRequest?.(new Error(closeError));
    rejectRequest = undefined;
    resolveRequest = undefined;
    for (const id of approvals.keys()) settleApproval(id, false);
    onClose?.();
  });

  function emit(value: Output) {
    output.write(`${JSON.stringify(value)}\n`);
  }

  function waitForApproval(id: string, signal?: AbortSignal) {
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
    close: () => lines.close(),
    emit,
    request,
    waitForApproval,
  };
}
