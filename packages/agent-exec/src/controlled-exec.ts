import { create } from "@bufbuild/protobuf";
import {
  ExecClientControlMessageSchema,
  type ExecClientControlMessage,
  ExecClientHeartbeatSchema,
  type ExecClientMessage,
  ExecClientStreamCloseSchema,
  ExecClientThrowSchema,
  type ExecServerMessage,
} from "@briar/contracts/gen/agent/v1/exec_pb";
import {
  ExecStreamElementSchema,
  type ExecStreamElement,
} from "@briar/contracts/gen/agent/v1/exec_service_pb";
import type { ControlledExecutor } from "./exec-resource";
import type { RegisteredControlledResource } from "./resource-provider";

export const EXEC_HEARTBEAT_INTERVAL_MS = 3_000;

export interface ControlledExecHandler {
  handle(
    message: ExecServerMessage,
    options?: ControlledExecOptions,
  ): Promise<ExecClientMessage> | undefined;
}

export interface ControlledExecOptions {
  readonly signal?: AbortSignal;
  readonly displayIndex?: number;
}

export class SimpleControlledExecHandler<Args, Result> implements ControlledExecHandler {
  constructor(
    private readonly executor: ControlledExecutor<Args, Result>,
    private readonly deserializeArgs: (
      message: ExecServerMessage,
    ) => { readonly id: number; readonly args: Args } | undefined,
    private readonly serializeResult: (
      id: number,
      result: Result,
    ) => ExecClientMessage,
  ) {}

  handle(
    message: ExecServerMessage,
    options: ControlledExecOptions = {},
  ): Promise<ExecClientMessage> | undefined {
    const decoded = this.deserializeArgs(message);
    if (decoded === undefined) return undefined;

    return (async () => {
      const startedAt = performance.now();
      const result = await this.executor.execute(decoded.args, {
        execId: message.execId || undefined,
        signal: options.signal,
        displayIndex: options.displayIndex,
      });
      const response = this.serializeResult(decoded.id, result);
      response.execId = message.execId;
      response.localExecutionTimeMs = Math.round(
        Math.max(0, performance.now() - startedAt),
      );
      return response;
    })();
  }
}

interface ControlledResourceRegistry {
  entries(): Array<
    readonly [RegisteredControlledResource<SimpleControlledExecManager>, unknown]
  >;
}

type ExecutionOutcome =
  | { readonly type: "result"; readonly value: ExecClientMessage }
  | { readonly type: "error"; readonly error: unknown };

const resultElement = (message: ExecClientMessage): ExecStreamElement =>
  create(ExecStreamElementSchema, {
    element: { case: "execClientMessage", value: message },
  });

const controlElement = (
  message: ExecClientControlMessage,
): ExecStreamElement => create(ExecStreamElementSchema, {
  element: { case: "execClientControlMessage", value: message },
});

const heartbeatElement = (id: number): ExecStreamElement => controlElement(
  create(ExecClientControlMessageSchema, {
    message: {
      case: "heartbeat",
      value: create(ExecClientHeartbeatSchema, { id }),
    },
  }),
);

const streamCloseElement = (id: number): ExecStreamElement => controlElement(
  create(ExecClientControlMessageSchema, {
    message: {
      case: "streamClose",
      value: create(ExecClientStreamCloseSchema, { id }),
    },
  }),
);

const errorCode = (error: unknown): string | undefined => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "EXEC_ABORTED";
  }
  return undefined;
};

const throwElement = (id: number, error: unknown): ExecStreamElement =>
  controlElement(create(ExecClientControlMessageSchema, {
    message: {
      case: "throw",
      value: create(ExecClientThrowSchema, {
        id,
        error: error instanceof Error ? error.message : "Unknown exec error",
        errorCode: errorCode(error),
      }),
    },
  }));

interface HeartbeatTimer {
  readonly promise: Promise<"heartbeat">;
  readonly cancel: () => void;
}

const heartbeatTimer = (milliseconds: number): HeartbeatTimer => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    promise: new Promise((resolve) => {
      timer = setTimeout(() => resolve("heartbeat"), milliseconds);
    }),
    cancel: () => clearTimeout(timer),
  };
};

export class SimpleControlledExecManager {
  private readonly handlers: ControlledExecHandler[] = [];

  constructor(
    private readonly heartbeatIntervalMs = EXEC_HEARTBEAT_INTERVAL_MS,
  ) {}

  register(handler: ControlledExecHandler): void {
    this.handlers.push(handler);
  }

  async *handle(
    message: ExecServerMessage,
    options: ControlledExecOptions = {},
  ): AsyncIterable<ExecStreamElement> {
    const execution = this.handlers
      .map((handler) => handler.handle(message, options))
      .find((candidate) => candidate !== undefined);
    if (execution === undefined) {
      yield throwElement(
        message.id,
        new Error(`No handler for exec message ${message.message.case ?? "unknown"}`),
      );
      return;
    }

    const outcome = execution.then<ExecutionOutcome, ExecutionOutcome>(
      (value) => ({ type: "result", value }),
      (error: unknown) => ({ type: "error", error }),
    );
    const aborted = options.signal === undefined
      ? undefined
      : new Promise<ExecutionOutcome>((resolve) => {
          const onAbort = () => resolve({ type: "error", error: options.signal?.reason });
          if (options.signal?.aborted === true) onAbort();
          else options.signal?.addEventListener("abort", onAbort, { once: true });
        });

    for (;;) {
      const timer = heartbeatTimer(this.heartbeatIntervalMs);
      const settled = await Promise.race(
        aborted === undefined ? [outcome, timer.promise] : [outcome, aborted, timer.promise],
      );
      timer.cancel();
      if (settled === "heartbeat") {
        yield heartbeatElement(message.id);
        continue;
      }
      if (settled.type === "error") {
        yield throwElement(message.id, settled.error);
        return;
      }
      yield resultElement(settled.value);
      yield streamCloseElement(message.id);
      return;
    }
  }

  static fromResources(
    resources: ControlledResourceRegistry,
    heartbeatIntervalMs = EXEC_HEARTBEAT_INTERVAL_MS,
  ): SimpleControlledExecManager {
    const manager = new SimpleControlledExecManager(heartbeatIntervalMs);
    for (const [resource, implementation] of resources.entries()) {
      resource.registerControlledImplementation(implementation, manager);
    }
    return manager;
  }
}
