import { EventEmitter } from "node:events";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  type OpenCodeStartupProcess,
  waitForOpenCodeServerUrl,
} from "./opencode-server-startup";

class StartupProcess extends EventEmitter implements OpenCodeStartupProcess {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
}

const startWaiting = (child: StartupProcess) => {
  const result = Effect.runPromise(waitForOpenCodeServerUrl(child));
  return Promise.resolve().then(() => result);
};

const expectTemporaryListenersRemoved = (child: StartupProcess) => {
  expect(child.listenerCount("close")).toBe(0);
  expect(child.stdout.listenerCount("data")).toBe(0);
  expect(child.stderr.listenerCount("data")).toBe(0);
};

describe("OpenCode server startup", () => {
  it("finds a chunked stdout URL and releases temporary listeners", async () => {
    const child = new StartupProcess();
    const result = startWaiting(child);

    child.stdout.emit("data", "booting\nopencode server list");
    child.stdout.emit("data", "ening on http://127.0.0.1:4321\n");

    await expect(result).resolves.toBe("http://127.0.0.1:4321");
    expectTemporaryListenersRemoved(child);
    expect(child.listenerCount("error")).toBe(1);

    // Preserve the old one-shot post-start guard for ChildProcess error events.
    expect(() => child.emit("error", new Error("late process error")))
      .not.toThrow();
    expect(child.listenerCount("error")).toBe(0);
  });

  it("accepts the server URL from stderr", async () => {
    const child = new StartupProcess();
    const result = startWaiting(child);

    child.stderr.emit(
      "data",
      Buffer.from(
        "opencode server listening on https://127.0.0.1:8443\n",
      ),
    );

    await expect(result).resolves.toBe("https://127.0.0.1:8443");
    expectTemporaryListenersRemoved(child);
  });

  it("preserves process error identity and releases listeners", async () => {
    const child = new StartupProcess();
    const result = startWaiting(child);
    const error = new Error("spawn failed");

    child.emit("error", error);

    await expect(result).rejects.toBe(error);
    expectTemporaryListenersRemoved(child);
    expect(child.listenerCount("error")).toBe(0);
  });

  it("reports early process exit with accumulated output", async () => {
    const child = new StartupProcess();
    const result = startWaiting(child);

    child.stdout.emit("data", "first line\n");
    child.stderr.emit("data", "last line\n");
    child.emit("close", 17);

    await expect(result).rejects.toThrow(
      "OpenCode server exited before startup (code 17).\nfirst line\nlast line\n",
    );
    expectTemporaryListenersRemoved(child);
  });

  it("uses the Effect clock for timeout and interruption cleanup", async () => {
    const child = new StartupProcess();
    const program = Effect.gen(function*() {
      const fiber = yield* waitForOpenCodeServerUrl(child).pipe(
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* Effect.sync(() => child.stdout.emit("data", "still booting\n"));
      yield* TestClock.adjust(30_000);
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer()));

    await expect(Effect.runPromise(program)).rejects.toThrow(
      "Timed out waiting for OpenCode server startup.\nstill booting\n",
    );
    expectTemporaryListenersRemoved(child);
    expect(child.listenerCount("error")).toBe(1);
  });

  it("releases listeners when the waiting fiber is interrupted", async () => {
    const child = new StartupProcess();
    const waiting = waitForOpenCodeServerUrl(child);
    expect(child.listenerCount("error")).toBe(0);
    expectTemporaryListenersRemoved(child);

    await Effect.runPromise(
      Effect.gen(function*() {
        const fiber = yield* waiting.pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
      }),
    );

    expectTemporaryListenersRemoved(child);
    expect(child.listenerCount("error")).toBe(1);
  });
});
