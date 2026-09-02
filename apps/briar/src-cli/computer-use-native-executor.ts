import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { create } from "@bufbuild/protobuf";
import {
  ComputerUseErrorSchema,
  ComputerUseResultSchema,
  ComputerUseSuccessSchema,
  MouseButton,
  ScrollDirection,
  type ComputerUseAction,
  type ComputerUseArgs,
  type ComputerUseResult,
} from "@briar/contracts/gen/agent/v1/computer_use_tool_pb";
import type { ControlledComputerUseExecutor } from "@briar/agent-exec";
import * as Schema from "effect/Schema";

export const defaultComputerUseExecutorPath =
  "/opt/briar/libexec/briar-computer-executor.py";
export const defaultComputerUseScreenshotDirectory =
  "/var/lib/briar-computer-use/screenshots";
const COMPUTER_USE_PROCESS_OUTPUT_LIMIT = 24 * 1024 * 1024;

type NativeComputerAction =
  | { readonly type: "mouse_move"; readonly x: number; readonly y: number }
  | {
      readonly type: "click";
      readonly x?: number;
      readonly y?: number;
      readonly button: string;
      readonly count: number;
      readonly modifierKeys?: string;
    }
  | { readonly type: "mouse_down"; readonly button: string }
  | { readonly type: "mouse_up"; readonly button: string }
  | {
      readonly type: "drag";
      readonly path: ReadonlyArray<{ readonly x: number; readonly y: number }>;
      readonly button: string;
      readonly modifierKeys?: string;
    }
  | {
      readonly type: "scroll";
      readonly x?: number;
      readonly y?: number;
      readonly direction: string;
      readonly amount: number;
      readonly modifierKeys?: string;
    }
  | { readonly type: "type"; readonly text: string }
  | { readonly type: "key"; readonly key: string; readonly holdDurationMs?: number }
  | { readonly type: "wait"; readonly durationMs: number }
  | { readonly type: "screenshot" }
  | { readonly type: "cursor_position" };

export interface NativeComputerUseRequest {
  readonly displayIndex: number;
  readonly toolCallId: string;
  readonly screenshotDirectory: string;
  readonly bindUnmappedCharacters: boolean;
  readonly actions: readonly NativeComputerAction[];
}

const CoordinateOutput = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
});

const NativeComputerUseOutput = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    actionCount: Schema.Int,
    durationMs: Schema.Int,
    screenshot: Schema.optional(Schema.String),
    screenshotPath: Schema.optional(Schema.String),
    log: Schema.optional(Schema.String),
    cursorPosition: Schema.optional(CoordinateOutput),
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
    actionCount: Schema.Int,
    durationMs: Schema.Int,
    screenshot: Schema.optional(Schema.String),
    screenshotPath: Schema.optional(Schema.String),
    log: Schema.optional(Schema.String),
  }),
]);

type NativeComputerUseOutput = typeof NativeComputerUseOutput.Type;
const decodeNativeComputerUseOutput = Schema.decodeUnknownSync(
  NativeComputerUseOutput,
  { onExcessProperty: "error" },
);

const mouseButtonName = (button: MouseButton): string => {
  switch (button) {
    case MouseButton.LEFT: return "left";
    case MouseButton.RIGHT: return "right";
    case MouseButton.MIDDLE: return "middle";
    case MouseButton.BACK: return "back";
    case MouseButton.FORWARD: return "forward";
    case MouseButton.UNSPECIFIED: return "left";
  }
};

const scrollDirectionName = (direction: ScrollDirection): string => {
  switch (direction) {
    case ScrollDirection.UP: return "up";
    case ScrollDirection.DOWN: return "down";
    case ScrollDirection.LEFT: return "left";
    case ScrollDirection.RIGHT: return "right";
    case ScrollDirection.UNSPECIFIED: return "down";
  }
};

const requireCoordinate = (
  coordinate: { readonly x: number; readonly y: number } | undefined,
  action: string,
): { readonly x: number; readonly y: number } => {
  if (coordinate === undefined) throw new Error(`${action} requires a coordinate`);
  return coordinate;
};

export const toNativeComputerAction = (
  action: ComputerUseAction,
): NativeComputerAction => {
  switch (action.action.case) {
    case "mouseMove": {
      const point = requireCoordinate(action.action.value.coordinate, "mouse_move");
      return { type: "mouse_move", ...point };
    }
    case "click": {
      const value = action.action.value;
      return {
        type: "click",
        x: value.coordinate?.x,
        y: value.coordinate?.y,
        button: mouseButtonName(value.button),
        count: value.count,
        modifierKeys: value.modifierKeys,
      };
    }
    case "mouseDown":
      return { type: "mouse_down", button: mouseButtonName(action.action.value.button) };
    case "mouseUp":
      return { type: "mouse_up", button: mouseButtonName(action.action.value.button) };
    case "drag":
      return {
        type: "drag",
        path: action.action.value.path.map(({ x, y }) => ({ x, y })),
        button: mouseButtonName(action.action.value.button),
        modifierKeys: action.action.value.modifierKeys,
      };
    case "scroll":
      return {
        type: "scroll",
        x: action.action.value.coordinate?.x,
        y: action.action.value.coordinate?.y,
        direction: scrollDirectionName(action.action.value.direction),
        amount: action.action.value.amount,
        modifierKeys: action.action.value.modifierKeys,
      };
    case "type":
      return { type: "type", text: action.action.value.text };
    case "key":
      return {
        type: "key",
        key: action.action.value.key,
        holdDurationMs: action.action.value.holdDurationMs,
      };
    case "wait":
      return { type: "wait", durationMs: action.action.value.durationMs };
    case "screenshot":
      return { type: "screenshot" };
    case "cursorPosition":
      return { type: "cursor_position" };
    case undefined:
      throw new Error("Computer Use action is missing");
  }
};

export interface NativeComputerUseProcessRunner {
  run(request: NativeComputerUseRequest, signal?: AbortSignal): Promise<unknown>;
}

const appendLimited = (
  current: Buffer,
  chunk: Buffer,
  limit: number,
): Buffer => {
  if (current.byteLength + chunk.byteLength > limit) {
    throw new Error("Computer Use executor output exceeded its limit");
  }
  return Buffer.concat([current, chunk]);
};

export class PythonComputerUseProcessRunner implements NativeComputerUseProcessRunner {
  constructor(readonly executablePath = defaultComputerUseExecutorPath) {
    if (!isAbsolute(executablePath)) {
      throw new Error("Computer Use executor path must be absolute");
    }
  }

  run(request: NativeComputerUseRequest, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn("/usr/bin/python3", [this.executablePath], {
        env: {
          ...process.env,
          DISPLAY: `:${request.displayIndex}`,
          XAUTHORITY: process.env.XAUTHORITY ?? "/home/briar/.Xauthority",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let settled = false;
      let outputError: unknown;
      let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
      const terminate = () => {
        if (!child.kill("SIGTERM") || forceKillTimer) return;
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
        forceKillTimer.unref?.();
      };
      const clearForceKill = () => {
        if (forceKillTimer) clearTimeout(forceKillTimer);
        forceKillTimer = null;
      };
      const abort = () => terminate();
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        try {
          stdout = appendLimited(stdout, chunk, COMPUTER_USE_PROCESS_OUTPUT_LIMIT);
        } catch (error) {
          outputError = error;
          terminate();
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        try {
          stderr = appendLimited(stderr, chunk, 64 * 1024);
        } catch (error) {
          outputError = error;
          terminate();
        }
      });
      child.stdin.once("error", (error) => {
        if (settled || signal?.aborted === true) return;
        outputError ??= error;
        terminate();
      });
      child.once("error", (error) => {
        settled = true;
        clearForceKill();
        signal?.removeEventListener("abort", abort);
        reject(error);
      });
      child.once("exit", (code, exitSignal) => {
        if (settled) return;
        settled = true;
        clearForceKill();
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted === true) {
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          return;
        }
        if (outputError !== undefined) {
          reject(outputError);
          return;
        }
        if (code !== 0) {
          reject(new Error(
            `Computer Use executor exited ${code ?? exitSignal ?? "unknown"}: ${
              stderr.toString("utf8").trim() || "no diagnostic"
            }`,
          ));
          return;
        }
        try {
          resolve(JSON.parse(stdout.toString("utf8")) as unknown);
        } catch (error) {
          reject(new Error("Computer Use executor returned invalid JSON", { cause: error }));
        }
      });
      child.stdin.end(`${JSON.stringify(request)}\n`);
      if (signal?.aborted === true) terminate();
    });
  }
}

const toComputerUseResult = (output: NativeComputerUseOutput): ComputerUseResult =>
  output.success
    ? create(ComputerUseResultSchema, {
        result: {
          case: "success",
          value: create(ComputerUseSuccessSchema, {
            actionCount: output.actionCount,
            durationMs: output.durationMs,
            screenshot: output.screenshot,
            screenshotPath: output.screenshotPath,
            log: output.log,
            cursorPosition: output.cursorPosition,
          }),
        },
      })
    : create(ComputerUseResultSchema, {
        result: {
          case: "error",
          value: create(ComputerUseErrorSchema, {
            error: output.error,
            actionCount: output.actionCount,
            durationMs: output.durationMs,
            screenshot: output.screenshot,
            screenshotPath: output.screenshotPath,
            log: output.log,
          }),
        },
      });

export class NativeComputerUseExecutor implements ControlledComputerUseExecutor {
  constructor(
    private readonly runner: NativeComputerUseProcessRunner =
      new PythonComputerUseProcessRunner(),
    private readonly screenshotDirectory = defaultComputerUseScreenshotDirectory,
  ) {
    if (!isAbsolute(screenshotDirectory)) {
      throw new Error("Computer Use screenshot directory must be absolute");
    }
  }

  async execute(
    args: ComputerUseArgs,
    options: { readonly signal?: AbortSignal; readonly displayIndex?: number },
  ): Promise<ComputerUseResult> {
    const displayIndex = options.displayIndex;
    if (!Number.isInteger(displayIndex) || displayIndex === undefined || displayIndex < 2) {
      throw new Error("Computer Use execution requires a display index");
    }
    const output = await this.runner.run({
      displayIndex,
      toolCallId: args.toolCallId,
      screenshotDirectory: this.screenshotDirectory,
      bindUnmappedCharacters: args.bindUnmappedCharacters ?? false,
      actions: args.actions.map(toNativeComputerAction),
    }, options.signal);
    return toComputerUseResult(decodeNativeComputerUseOutput(output));
  }
}
