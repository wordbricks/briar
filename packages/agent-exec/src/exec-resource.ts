import type {
  ExecClientMessage,
  ExecServerMessage,
} from "@briar/contracts/gen/agent/v1/exec_pb";

export interface ExecutorOptions {
  readonly execId?: string;
  readonly signal?: AbortSignal;
  readonly displayIndex?: number;
}

export interface Executor<Args, Result> {
  execute(args: Args, options?: ExecutorOptions): Promise<Result>;
}

export interface ControlledExecutorOptions {
  readonly execId?: string;
  readonly signal?: AbortSignal;
  readonly displayIndex?: number;
}

export interface ControlledExecutor<Args, Result> {
  execute(args: Args, options: ControlledExecutorOptions): Promise<Result>;
}

export interface RemoteExecManager {
  createExecInstance(
    createMessage: (id: number) => ExecServerMessage,
    options?: { readonly signal?: AbortSignal },
  ): AsyncIterable<ExecClientMessage>;
}

export class ExecResultMissingError extends Error {
  constructor() {
    super("The box exec stream ended without a result");
    this.name = "ExecResultMissingError";
  }
}

const drain = async (iterator: AsyncIterator<ExecClientMessage>): Promise<void> => {
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
    }
  } catch {
    // The result has already reached the caller. Stream shutdown is detached.
  }
};

export class ExecutorResource<Args, Result> implements Executor<Args, Result> {
  constructor(
    private readonly execManager: RemoteExecManager,
    private readonly serializeArgs: (
      id: number,
      args: Args,
    ) => ExecServerMessage,
    private readonly deserializeResult: (
      message: ExecClientMessage,
    ) => Result | undefined,
  ) {}

  async execute(args: Args, options: ExecutorOptions = {}): Promise<Result> {
    const stream = this.execManager.createExecInstance(
      (id) => {
        const message = this.serializeArgs(id, args);
        message.execId = options.execId ?? "";
        return message;
      },
      { signal: options.signal },
    );
    const iterator = stream[Symbol.asyncIterator]();

    for (;;) {
      const next = await iterator.next();
      if (next.done) throw new ExecResultMissingError();
      const result = this.deserializeResult(next.value);
      if (result === undefined) continue;
      void drain(iterator);
      return result;
    }
  }
}
