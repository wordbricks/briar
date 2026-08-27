/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import { createReactTestRoot } from "./react";

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
