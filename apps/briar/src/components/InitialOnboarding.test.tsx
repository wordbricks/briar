/** @vitest-environment jsdom */

import { act } from "react";
import type { Root } from "react-dom/client";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InitialOnboarding } from "./InitialOnboarding";

const createProps = () => ({
  error: null,
  loading: false,
  loginCode: null,
  onCancelLogin: vi.fn(),
  onLogin: vi.fn(),
});

describe("InitialOnboarding", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("starts email verification from the primary second-step action", async () => {
    const props = createProps();
    await renderReactTestRoot(root, <InitialOnboarding {...props} />);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("main section button")?.click();
    });

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>("button")[0]?.click();
    });

    expect(props.onLogin).toHaveBeenCalledOnce();
    expect(props.onLogin).toHaveBeenCalledWith("email");
  });

  it("cancels an in-progress login before returning to the introduction", async () => {
    const props = {
      ...createProps(),
      loading: true,
      loginCode: "RZEHG4T5",
    };
    await renderReactTestRoot(root, <InitialOnboarding {...props} />);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("main section button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("main > section > button")?.click();
    });

    expect(props.onCancelLogin).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Briar에 오신 것을 환영해요.");
  });
});
