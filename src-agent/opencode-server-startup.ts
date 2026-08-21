import * as Effect from "effect/Effect";

import { parseOpenCodeServerUrl } from "./opencode-runner-lib";

type StartupChunk = Buffer | string;

export interface OpenCodeStartupStream {
  on(event: "data", listener: (chunk: StartupChunk) => void): unknown;
  off(event: "data", listener: (chunk: StartupChunk) => void): unknown;
}

export interface OpenCodeStartupProcess {
  readonly stdout: OpenCodeStartupStream;
  readonly stderr: OpenCodeStartupStream;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  off(event: "close", listener: (code: number | null) => void): unknown;
}

const ignoreFirstRuntimeProcessError = () => {};

/**
 * Wait for OpenCode's startup URL while owning every temporary process
 * listener. The error guard preserves ChildProcess's previous post-start
 * behavior: the old one-shot startup listener absorbed the first late error.
 */
export const waitForOpenCodeServerUrl = Effect.fnUntraced(function*(
  child: OpenCodeStartupProcess,
  timeout: number = 30_000,
) {
  let output = "";

  return yield* Effect.callback<string, Error>((resume) => {
    let active = true;

    const onError = (error: Error) => settle(Effect.fail(error));
    const onClose = (code: number | null) =>
      settle(
        Effect.fail(
          // Preserve the native process error contract used by this callback.
          // @effect-diagnostics-next-line globalErrorInEffectFailure:off
          new Error(
            `OpenCode server exited before startup${code === null ? "" : ` (code ${code})`}.\n${output}`,
          ),
        ),
      );
    const inspect = (chunk: StartupChunk) => {
      output += chunk.toString();
      const url = parseOpenCodeServerUrl(output);
      if (url) settle(Effect.succeed(url));
    };
    const cleanup = () => {
      if (!active) return;
      active = false;
      child.off("error", onError);
      child.off("close", onClose);
      child.stdout.off("data", inspect);
      child.stderr.off("data", inspect);
    };
    const settle = (result: Effect.Effect<string, Error>) => {
      if (!active) return;
      cleanup();
      resume(result);
    };

    child.once("error", ignoreFirstRuntimeProcessError);
    child.once("error", onError);
    child.once("close", onClose);
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);

    return Effect.sync(cleanup);
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(
          // This boundary intentionally rejects with a native Error for callers.
          // @effect-diagnostics-next-line globalErrorInEffectFailure:off
          new Error(`Timed out waiting for OpenCode server startup.\n${output}`),
        ),
    }),
  );
});
