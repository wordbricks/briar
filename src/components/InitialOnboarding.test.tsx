/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InitialOnboarding } from "./InitialOnboarding";

vi.mock("../lib/initial-onboarding", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../lib/initial-onboarding")>();
  return {
    ...original,
    inspectOnboardingPrerequisites: vi.fn().mockResolvedValue({
      codex: { installed: true, version: "codex-cli 1.0.0" },
      velen: { installed: true, version: "velen 1.0.0" },
    }),
    installOnboardingPrerequisite: vi.fn(),
    markInitialOnboardingComplete: vi.fn(),
  };
});

describe("InitialOnboarding", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("starts with a welcome screen and advances to prerequisite checks", async () => {
    await act(async () => root.render(
      <InitialOnboarding onComplete={() => undefined} />,
    ));
    expect(container.textContent).toContain("Briar에 오신 것을 환영해요.");
    expect(container.querySelector(".brand")).toBeNull();
    expect(container.querySelector(".initial-onboarding-header")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".initial-welcome-copy button",
      )?.click();
    });

    expect(container.textContent).toContain("먼저, 작업 환경을 준비할게요.");
    expect(container.textContent).toContain("codex-cli 1.0.0");
    expect(container.textContent).toContain("velen 1.0.0");
  });

  it("continues only after both prerequisites are installed", async () => {
    const onComplete = vi.fn();
    await act(async () => root.render(
      <InitialOnboarding onComplete={onComplete} />,
    ));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".initial-welcome-copy button",
      )?.click();
    });

    const continueButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Google 로그인으로 계속"));
    expect(continueButton?.disabled).toBe(false);

    await act(async () => continueButton?.click());
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
