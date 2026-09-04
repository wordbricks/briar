/** @vitest-environment jsdom */

import { act, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { createReactTestRoot } from "./react";
import { createRenderCounter } from "./render-count";

describe("createRenderCounter", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  it("counts renders of a tracked component and of a render callback", async () => {
    const view = createReactTestRoot();
    const renders = createRenderCounter();

    function Label({ text }: { text: string }) {
      renders.useRenderCount("label");
      return <span>{text}</span>;
    }
    const TrackedLabel = renders.track("wrapper", Label);

    await view.render(<TrackedLabel text="first" />);
    renders.expectRenderCounts({ label: 1, wrapper: 1 });

    await view.render(<TrackedLabel text="second" />);
    expect(view.container.textContent).toBe("second");
    renders.expectRenderCounts({ label: 2, wrapper: 2 });

    expect(renders.record("callback", "returned")).toBe("returned");
    expect(renders.count("callback")).toBe(1);
    expect(renders.count("never-rendered")).toBe(0);

    await view.cleanup();
  });

  it("sees a render a subscription pushed into a component, unlike track", async () => {
    const view = createReactTestRoot();
    const renders = createRenderCounter();
    let publish = (_text: string) => undefined as void;

    // Stands in for a component that subscribes to a store: nothing above it
    // renders when the value changes, only the component itself.
    function Subscriber() {
      const [text, setText] = useState("first");
      publish = setText;
      return <span>{text}</span>;
    }
    const TrackedSubscriber = renders.track("tracked", Subscriber);

    await view.render(
      renders.profile("profiled", <TrackedSubscriber />),
    );
    renders.reset();

    await act(async () => {
      publish("second");
    });

    expect(view.container.textContent).toBe("second");
    // The wrapper never saw it; the profiler did.
    renders.expectRenderCounts({ profiled: 1 });

    await view.cleanup();
  });

  it("forgets every counter on reset", () => {
    const renders = createRenderCounter();

    renders.useRenderCount("shell");
    renders.record("detail", null);
    renders.expectRenderCounts({ detail: 1, shell: 1 });

    renders.reset();
    renders.expectRenderCounts({});
    expect(renders.count("shell")).toBe(0);
  });
});
