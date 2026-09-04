/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import { createReactTestRoot, settle } from "./react";

describe("createReactTestRoot", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  it("renders into a detached container and cleans it up", async () => {
    const view = createReactTestRoot();

    await view.render(<span>first</span>);
    expect(view.container.textContent).toBe("first");
    expect(view.container.parentElement).toBeNull();

    await view.cleanup();
    expect(view.container.textContent).toBe("");
  });

  it("preserves document attachment and makes cleanup idempotent", async () => {
    const view = createReactTestRoot({ attachToDocument: true });

    await view.render(<button>before</button>);
    await view.render(<button>after</button>);
    expect(document.body.contains(view.container)).toBe(true);
    expect(view.container.textContent).toBe("after");

    await view.unmount();
    await view.cleanup();
    expect(document.body.contains(view.container)).toBe(false);
  });
});

/*
  The behaviour these lock in is the one whose absence made the app suite flake:
  the helpers this replaced polled a fixed number of event-loop turns and then
  returned whether or not the condition ever held. On a loaded machine the turn
  budget ran out first, the wait returned anyway, and the test failed further
  down on an assertion that said nothing about what had actually not happened.
*/
describe("settle", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  it("returns as soon as the condition holds", async () => {
    let turns = 0;
    await settle(() => (turns += 1) > 2);
    expect(turns).toBe(3);
  });

  it("waits for a condition that only becomes true later", async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 20);
    await settle(() => ready);
    expect(ready).toBe(true);
  });

  it("throws with the description instead of giving up quietly", async () => {
    await expect(
      settle(() => false, {
        description: "the page to load",
        timeoutMs: 50,
      }),
    ).rejects.toThrow("Timed out after 50ms waiting for the page to load.");
  });

  it("spends wall-clock rather than a turn count before failing", async () => {
    const started = Date.now();
    await expect(
      settle(() => false, { timeoutMs: 120 }),
    ).rejects.toThrow(/Timed out/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(120);
  });
});
