/** @vitest-environment jsdom */

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { createReactTestRoot } from "../test/react";
import { createRenderCounter } from "../test/render-count";
import {
  actionIsWaiting,
  defineActionFamily,
  useAction,
  type ActionAtom,
} from "./actions";
import { createTestRegistry } from "./registry";

/*
  `useAction` from a component.

  The point of the hook is that a button gets both halves of a flow from one
  subscription — the runner and the request state — and that the state it
  subscribes to belongs to *its* row. The render counts below are the assertion:
  starting one row's work must not commit the other row.
*/

const deferred = <A,>() => {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

describe("useAction", () => {
  it("runs the action, rejects with the original error and disables only its own row", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const family = defineActionFamily<void, string>("test/row", (key) => {
      const gate = deferred<string>();
      gates.set(key, gate);
      return gate.promise;
    });
    const counter = createRenderCounter();
    const registry = createTestRegistry();
    const runners = new Map<string, (arg: void) => Promise<string>>();

    function Row({ id }: { readonly id: string }) {
      const [run, result] = useAction(family(id));
      runners.set(id, run);
      counter.useRenderCount(id);
      return (
        <button data-testid={id} disabled={actionIsWaiting(result)} type="button">
          {id}
        </button>
      );
    }

    const testRoot = createReactTestRoot();
    await testRoot.render(
      <RegistryContext.Provider value={registry}>
        <Row id="run-1" />
        <Row id="run-2" />
      </RegistryContext.Provider>,
    );
    counter.expectRenderCounts({ "run-1": 1, "run-2": 1 });

    const buttonOf = (id: string) =>
      testRoot.container.querySelector<HTMLButtonElement>(
        `[data-testid="${id}"]`,
      )!;

    let settled: Promise<string> | undefined;
    await act(async () => {
      settled = runners.get("run-1")!();
    });
    expect(buttonOf("run-1").disabled).toBe(true);
    expect(buttonOf("run-2").disabled).toBe(false);
    // The row that is not running was not committed again.
    counter.expectRenderCounts({ "run-1": 2, "run-2": 1 });

    const thrown = new Error("행이 거절했습니다.");
    await act(async () => {
      gates.get("run-1")!.reject(thrown);
      await expect(settled).rejects.toBe(thrown);
    });
    expect(buttonOf("run-1").disabled).toBe(false);
    counter.expectRenderCounts({ "run-1": 3, "run-2": 1 });

    await testRoot.cleanup();
  });

  it("resolves with the value the work returned", async () => {
    const action: ActionAtom<number, string> = defineActionFamily<
      number,
      string
    >("test/value", async (key, arg) => `${key}:${arg}`)("a");
    const registry = createTestRegistry();
    let run: ((arg: number) => Promise<string>) | undefined;

    function Caller() {
      const [start] = useAction(action);
      run = start;
      return null;
    }

    const testRoot = createReactTestRoot();
    await testRoot.render(
      <RegistryContext.Provider value={registry}>
        <Caller />
      </RegistryContext.Provider>,
    );

    await act(async () => {
      await expect(run!(3)).resolves.toBe("a:3");
    });

    await testRoot.cleanup();
  });

  it("keeps a reader of one key from waking when another key runs", async () => {
    const family = defineActionFamily<void, string>(
      "test/isolated",
      async (key) => key,
    );
    const counter = createRenderCounter();
    const registry = createTestRegistry();

    function Watcher({ id }: { readonly id: string }) {
      const result = useAtomValue(family(id));
      counter.useRenderCount(`watch:${id}`);
      return <span>{actionIsWaiting(result) ? "…" : ""}</span>;
    }

    const testRoot = createReactTestRoot();
    await testRoot.render(
      <RegistryContext.Provider value={registry}>
        <Watcher id="a" />
        <Watcher id="b" />
      </RegistryContext.Provider>,
    );
    counter.reset();

    await act(async () => {
      registry.set(family("a"), undefined);
      await Promise.resolve();
    });

    expect(counter.count("watch:b")).toBe(0);
    expect(counter.count("watch:a")).toBeGreaterThan(0);

    await testRoot.cleanup();
  });
});
