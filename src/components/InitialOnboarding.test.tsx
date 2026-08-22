/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });


  it("starts email verification from the primary second-step action", async () => {
    const props = createProps();
    await act(async () => root.render(<InitialOnboarding {...props} />));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".initial-welcome-copy button")
        ?.click();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".email-button")?.click();
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
    await act(async () => root.render(<InitialOnboarding {...props} />));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".initial-welcome-copy button")
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".initial-login-back")
        ?.click();
    });

    expect(props.onCancelLogin).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Briar에 오신 것을 환영해요.");
  });
});
