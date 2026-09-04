import { describe, expect, it } from "vitest";

import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";

import {
  actionError,
  actionErrorMessage,
  actionIsWaiting,
  actionPendingAtom,
  defineAction,
  defineActionFamily,
  defineTaskAction,
  resetAction,
  runAction,
  runTask,
} from "./actions";
import { createTestRegistry, type AtomRegistry } from "./registry";

/** A promise whose settlement this test controls. */
const deferred = <A>() => {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

/** Every value the atom took, in order. */
const record = <A>(registry: AtomRegistry, atom: Atom.Atom<A>) => {
  const seen: A[] = [];
  const unsubscribe = registry.subscribe(atom, (value) => seen.push(value), {
    immediate: true,
  });
  return { seen, unsubscribe };
};

const tagsOf = (results: readonly AsyncResult.AsyncResult<unknown, Error>[]) =>
  results.map((result) => `${result._tag}${result.waiting ? "/waiting" : ""}`);

describe("defineAction", () => {
  it("walks Initial → waiting → Success and resolves with the value", async () => {
    const action = defineAction<number, string>("test/double", async (arg) =>
      String(arg * 2),
    );
    const registry = createTestRegistry();
    const { seen, unsubscribe } = record(registry, action);

    await expect(runAction(registry, action, 21)).resolves.toBe("42");

    expect(tagsOf(seen)).toEqual(["Initial", "Initial/waiting", "Success"]);
    expect(AsyncResult.getOrElse(seen[2]!, () => null)).toBe("42");
    unsubscribe();
  });

  it("rejects with the very error the body threw and keeps it as the failure", async () => {
    const thrown = new Error("서버가 거절했습니다.");
    const action = defineAction<void, never>("test/fails", () =>
      Promise.reject(thrown),
    );
    const registry = createTestRegistry();

    await expect(runAction(registry, action, undefined)).rejects.toBe(thrown);

    const result = registry.get(action);
    expect(AsyncResult.isFailure(result)).toBe(true);
    expect(actionError(result)).toBe(thrown);
    expect(actionErrorMessage(result)).toBe("서버가 거절했습니다.");
  });

  it("turns a synchronous throw into the same failure", async () => {
    const action = defineAction<void, never>("test/throwsSync", () => {
      throw new Error("동기 실패");
    });
    const registry = createTestRegistry();

    await expect(runAction(registry, action, undefined)).rejects.toThrow(
      "동기 실패",
    );
    expect(actionErrorMessage(registry.get(action))).toBe("동기 실패");
  });

  it("wraps a non-Error rejection so callers still get a message", async () => {
    const action = defineAction<void, never>("test/rejectsString", () =>
      Promise.reject("문자열 실패"),
    );
    const registry = createTestRegistry();

    await expect(runAction(registry, action, undefined)).rejects.toThrow(
      "문자열 실패",
    );
  });

  it("reads the registry it was started from without subscribing to it", async () => {
    const source = Atom.make(1).pipe(Atom.keepAlive);
    const action = defineAction<void, number>(
      "test/reads",
      async (_arg, { registry }) => registry.get(source),
    );
    const registry = createTestRegistry();
    const { seen, unsubscribe } = record(registry, action);

    await expect(runAction(registry, action, undefined)).resolves.toBe(1);
    registry.set(source, 2);

    // A write the action merely read must not re-run it.
    expect(tagsOf(seen)).toEqual(["Initial", "Initial/waiting", "Success"]);
    unsubscribe();
  });

  it("lets the body write other atoms before its first await", async () => {
    // Demo branches patch the store and return without ever awaiting, so the
    // first thing many of these bodies do is a registry write. It has to land
    // even though the run starts inside the action atom's own build.
    const target = Atom.make("before").pipe(Atom.keepAlive);
    const action = defineAction<string, string>(
      "test/writes",
      async (arg, { registry }) => {
        registry.set(target, arg);
        return registry.get(target);
      },
    );
    const registry = createTestRegistry();
    const { seen, unsubscribe } = record(registry, target);

    await expect(runAction(registry, action, "after")).resolves.toBe("after");

    expect(seen).toEqual(["before", "after"]);
    unsubscribe();
  });

  it("keeps the previous failure on screen while the retry runs", async () => {
    const attempts: ReturnType<typeof deferred<string>>[] = [];
    const action = defineAction<void, string>("test/retry", () => {
      const next = deferred<string>();
      attempts.push(next);
      return next.promise;
    });
    const registry = createTestRegistry();
    const unsubscribe = registry.mount(action);

    const first = runAction(registry, action, undefined);
    attempts[0]!.reject(new Error("첫 시도 실패"));
    await expect(first).rejects.toThrow("첫 시도 실패");
    expect(actionErrorMessage(registry.get(action))).toBe("첫 시도 실패");

    const second = runAction(registry, action, undefined);
    // Still a Failure, but waiting — so the "what went wrong just now" reading
    // is empty while the retry is in flight.
    expect(AsyncResult.isFailure(registry.get(action))).toBe(true);
    expect(actionIsWaiting(registry.get(action))).toBe(true);
    expect(actionErrorMessage(registry.get(action))).toBeNull();

    attempts[1]!.resolve("복구됨");
    await expect(second).resolves.toBe("복구됨");
    expect(actionErrorMessage(registry.get(action))).toBeNull();
    unsubscribe();
  });

  it("goes back to Initial when it is reset", async () => {
    const action = defineAction<void, string>("test/reset", async () => "값");
    const registry = createTestRegistry();

    await runAction(registry, action, undefined);
    expect(AsyncResult.isSuccess(registry.get(action))).toBe(true);

    resetAction(registry, action);
    expect(AsyncResult.isInitial(registry.get(action))).toBe(true);
    expect(actionIsWaiting(registry.get(action))).toBe(false);
  });

  it("reports an interrupt as no failure of its own", async () => {
    const gate = deferred<string>();
    const action = defineAction<void, string>("test/interrupt", () => gate.promise);
    const registry = createTestRegistry();
    const unsubscribe = registry.mount(action);

    const run = runAction(registry, action, undefined);
    expect(actionIsWaiting(registry.get(action))).toBe(true);

    registry.set(action, Atom.Interrupt);
    const result = registry.get(action);
    expect(AsyncResult.isFailure(result)).toBe(true);
    // An interrupt is not a failure of the work, so it reads as no error even
    // though the caller's promise is rejected.
    expect(actionError(result)).toBeNull();
    await expect(run).rejects.toThrow("All fibers interrupted");

    gate.resolve("무시됨");
    unsubscribe();
  });

  it("exposes the pending flag as an atom", async () => {
    const gate = deferred<string>();
    const action = defineAction<void, string>("test/flag", () => gate.promise);
    const pending = actionPendingAtom(action, "test/flag/pending");
    const registry = createTestRegistry();
    const { seen, unsubscribe } = record(registry, pending);

    const run = runAction(registry, action, undefined);
    gate.resolve("끝");
    await run;

    expect(seen).toEqual([false, true, false]);
    unsubscribe();
  });
});

describe("defineActionFamily", () => {
  it("keeps one key's pending state out of another's", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const family = defineActionFamily<void, string>("test/perKey", (key) => {
      const gate = deferred<string>();
      gates.set(key, gate);
      return gate.promise;
    });
    const registry = createTestRegistry();
    const a = record(registry, actionPendingAtom(family("a"), "test/perKey/a"));
    const b = record(registry, actionPendingAtom(family("b"), "test/perKey/b"));

    const run = runAction(registry, family("a"), undefined);
    gates.get("a")!.resolve("a 완료");
    await expect(run).resolves.toBe("a 완료");

    expect(a.seen).toEqual([false, true, false]);
    expect(b.seen).toEqual([false]);
    a.unsubscribe();
    b.unsubscribe();
  });

  it("returns the same atom for the same key", () => {
    const family = defineActionFamily<void, string>(
      "test/stable",
      async (key) => key,
    );
    expect(family("run-1")).toBe(family("run-1"));
    expect(family("run-1")).not.toBe(family("run-2"));
  });
});

describe("defineTaskAction", () => {
  it("names the target while the work runs and forgets it when it settles", async () => {
    const action = defineTaskAction("test/task");
    const registry = createTestRegistry();
    const { seen, unsubscribe } = record(registry, action.pendingTarget);
    const gate = deferred<number>();

    const run = runTask(registry, action, "run-1", () => gate.promise);
    expect(registry.get(action.pendingTarget)).toBe("run-1");
    gate.resolve(7);

    await expect(run).resolves.toBe(7);
    expect(seen).toEqual([null, "run-1", null]);
    unsubscribe();
  });

  it("carries the work's rejection through unchanged", async () => {
    const action = defineTaskAction("test/taskFails");
    const registry = createTestRegistry();
    const thrown = new Error("작업 실패");

    await expect(
      runTask(registry, action, "run-1", () => Promise.reject(thrown)),
    ).rejects.toBe(thrown);
    expect(registry.get(action.pendingTarget)).toBeNull();
    expect(actionErrorMessage(registry.get(action.result))).toBe("작업 실패");
  });

  it("lets a later run replace an earlier one, as the flag it replaces did", async () => {
    const action = defineTaskAction("test/taskReplace");
    const registry = createTestRegistry();
    const unsubscribe = registry.mount(action.result);
    const first = deferred<string>();
    const second = deferred<string>();

    // One run of a flow at a time: the hand written marker was overwritten by
    // the second call and the first one finishing did not clear it, so the
    // second run is the one both callers end on.
    const earlier = runTask(registry, action, "run-1", () => first.promise);
    const later = runTask(registry, action, "run-2", () => second.promise);
    expect(registry.get(action.pendingTarget)).toBe("run-2");

    second.resolve("완료");
    await expect(later).resolves.toBe("완료");
    await expect(earlier).resolves.toBe("완료");
    expect(registry.get(action.pendingTarget)).toBeNull();

    first.resolve("늦게 도착");
    unsubscribe();
  });
});
